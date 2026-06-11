use anyhow::Context;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use axum::body::Body;
use axum::http::{header, HeaderMap, HeaderName, HeaderValue, Method, Request};
use axum::middleware::Next;
use axum::{response::{IntoResponse, Response}, Router};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use http_body_util::BodyExt;
use moka::future::Cache;
use sha2::{Digest, Sha256};
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

async fn log_server_errors(req: Request<Body>, next: Next) -> Response {
    let response = next.run(req).await;
    if response.status().is_server_error() {
        let status = response.status();
        let (parts, body) = response.into_parts();
        let bytes = body.collect().await.map(|c| c.to_bytes()).unwrap_or_default();
        tracing::error!(status = %status, body = %String::from_utf8_lossy(&bytes), "server error");
        Response::from_parts(parts, Body::from(bytes))
    } else {
        response
    }
}

mod audit;
mod auth;
mod authentik;
mod config;
mod error;
mod routes;
mod authentik_state;

use auth::build_token_cache;
use authentik::AuthentikClient;
use config::Config;
use crate::authentik_state::AuthentikStateWrapper;
use tokio::sync::{mpsc, Mutex};
use tokio::time::MissedTickBehavior;

#[derive(Clone)]
pub struct AppState {
    pub authentik_client: Arc<AuthentikClient>,
    pub token_cache: Arc<Cache<String, String>>,
    pub authentik_state: Arc<AuthentikStateWrapper>,
    pub tx: mpsc::Sender<()>,
    pub write_mutex: Arc<Mutex<()>>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present (ignore error if it doesn't exist).
    let _ = dotenvy::dotenv();

    // Initialise tracing (respects RUST_LOG env var).
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "server=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration from environment.
    let config = Config::from_env()?;
    match audit::init(&config.audit_log_path) {
        Ok(()) => tracing::info!(path = %config.audit_log_path.display(), "audit log opened"),
        Err(e) => tracing::warn!(path = %config.audit_log_path.display(), err = %e, "audit log unavailable — continuing without file audit log"),
    }
    let port = config.backend_port;
    let static_dir = config.static_dir.clone();

    // Build the authentik API client.
    let authentik_client = Arc::new(AuthentikClient::new(
        config.authentik_base_url.clone(),
        config.authentik_api_token.clone(),
    ));
    let (tx, mut rx) = mpsc::channel::<()>(100);

    let state_wrapper = Arc::new(AuthentikStateWrapper::new());
    let client_copy = authentik_client.clone();
    let state_wrapper_copy = state_wrapper.clone();

    tokio::spawn(async move {
        while rx.recv().await.is_some() {
            tracing::info!("Updating database");
            state_wrapper_copy.update(&client_copy).await.unwrap_or_else(|e| tracing::error!("{}", e));
        }
    });

    let tx_copy = tx.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_mins(5));
        interval.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            interval.tick().await;
            tx_copy.send(()).await.unwrap_or_else(|e| println!("{}", e));
        }
    });

    // Populate state before accepting connections so the first authenticated
    // request doesn't hit an empty cache and get a spurious 401.
    tracing::info!("loading initial authentik state…");
    state_wrapper.update(&authentik_client).await?;
    tracing::info!("initial authentik state loaded.");

    // Build shared state.
    let state = AppState {
        authentik_client,
        token_cache: Arc::new(build_token_cache()),
        authentik_state: state_wrapper,
        tx,
        write_mutex: Arc::new(Mutex::new(()))
    };

    // Build the SPA static file service.
    tracing::info!("serving static files from {:?}", static_dir);
    let index_html_path: PathBuf = static_dir.join("index.html");

    // Read index.html once and inject the runtime config so the frontend
    // doesn't need build-time env vars baked into the JS bundle.
    let raw_html = tokio::fs::read_to_string(&index_html_path)
        .await
        .context("failed to read index.html")?;
    let config_json = serde_json::json!({
        "authentikBaseUrl": config.authentik_base_url,
        "oidcClientId": config.oidc_client_id,
        "oidcRedirectUri": config.oidc_redirect_uri,
    });
    let script_content = format!("window.__CONFIG__={};", config_json);

    // Compute the SHA-256 hash of the script content for a hash-based CSP.
    // This avoids 'unsafe-inline' while still allowing this specific inline script.
    let script_hash = BASE64.encode(Sha256::digest(script_content.as_bytes()));
    let csp = format!(
        "default-src 'self'; \
         script-src 'self' 'sha256-{script_hash}'; \
         style-src 'self' 'unsafe-inline'; \
         connect-src 'self' {authentik_base_url}; \
         img-src 'self' data:; \
         object-src 'none'; \
         frame-ancestors 'none';",
        authentik_base_url = config.authentik_base_url,
    );
    let csp_hv = Arc::new(
        HeaderValue::from_str(&csp).context("CSP string is not a valid header value")?,
    );

    let injected_html = Arc::new(raw_html.replacen(
        "</head>",
        &format!("<script>{script_content}</script></head>"),
        1,
    ));

    // Build the axum router.
    // ServeDir handles real asset files; the fallback closure returns the
    // config-injected index.html for all other paths so React Router can
    // handle client-side navigation.
    let base_router = Router::new()
        .merge(routes::router(state))
        .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
        .fallback(move || {
            let html = injected_html.clone();
            let csp = csp_hv.clone();
            async move {
                let mut headers = HeaderMap::new();
                headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/html; charset=utf-8"));
                headers.insert(HeaderName::from_static("content-security-policy"), (*csp).clone());
                headers.insert(HeaderName::from_static("x-content-type-options"), HeaderValue::from_static("nosniff"));
                headers.insert(HeaderName::from_static("x-frame-options"), HeaderValue::from_static("DENY"));
                headers.insert(HeaderName::from_static("referrer-policy"), HeaderValue::from_static("strict-origin-when-cross-origin"));
                (headers, (*html).clone()).into_response()
            }
        });

    // Rate limiter: disabled in debug builds, active in release.
    #[cfg(debug_assertions)]
    let app = base_router;
    #[cfg(not(debug_assertions))]
    let app = {
        let governor_conf = Arc::new(
            GovernorConfigBuilder::default()
                .per_second(config.rps_limit)
                .burst_size(config.rps_burst_limit)
                .finish()
                .unwrap(),
        );
        base_router.layer(GovernorLayer { config: governor_conf })
    };

    let app = app
        .layer(axum::middleware::from_fn(log_server_errors))
        .layer({
            if config.cors_permissive {
                tracing::warn!("CORS_PERMISSIVE=true — all origins allowed; do not use in production");
                CorsLayer::permissive()
            } else {
                CorsLayer::new()
                    .allow_origin(
                        config.app_origin
                            .parse::<HeaderValue>()
                            .context("APP_ORIGIN is not a valid header value")?,
                    )
                    .allow_methods([
                        Method::GET,
                        Method::POST,
                        Method::PATCH,
                        Method::PUT,
                        Method::DELETE,
                    ])
                    .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION])
            }
        })
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service_with_connect_info::<std::net::SocketAddr>()).await?;

    Ok(())
}
