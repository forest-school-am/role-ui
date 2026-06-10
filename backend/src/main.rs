use std::path::PathBuf;
use std::sync::{Arc};
use std::time::Duration;
use axum::{http::header, response::IntoResponse, Router};
use moka::future::Cache;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

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
    let injected_html = Arc::new(raw_html.replacen(
        "</head>",
        &format!("<script>window.__CONFIG__={};</script></head>", config_json),
        1,
    ));

    // Build the axum router.
    // ServeDir handles real asset files; the fallback closure returns the
    // config-injected index.html for all other paths so React Router can
    // handle client-side navigation.
    let app = Router::new()
        .merge(routes::router(state))
        .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
        .fallback(move || {
            let html = injected_html.clone();
            async move {
                (
                    [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                    (*html).clone(),
                )
                    .into_response()
            }
        })
        // CORS — allow all origins for local development.
        .layer(CorsLayer::permissive())
        // Request tracing.
        .layer(TraceLayer::new_for_http());

    let addr = format!("0.0.0.0:{port}");
    tracing::info!("listening on {addr}");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
