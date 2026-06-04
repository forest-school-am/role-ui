use std::path::PathBuf;
use std::sync::Arc;

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
mod models;
mod routes;

use auth::{build_token_cache, AuthenticatedUser};
use authentik::AuthentikClient;
use config::Config;

// ---------------------------------------------------------------------------
// AppState — shared across all handlers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AppState {
    pub authentik: Arc<AuthentikClient>,
    /// token_hash → AuthenticatedUser (60-second TTL)
    pub token_cache: Arc<Cache<String, AuthenticatedUser>>,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env file if present (ignore error if it doesn't exist).
    let _ = dotenvy::dotenv();

    // Initialise tracing (respects RUST_LOG env var).
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "authentik_role_ui_backend=debug,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    // Load configuration from environment.
    let config = Config::from_env()?;
    let port = config.backend_port;
    let static_dir = config.static_dir.clone();

    // Build the authentik API client.
    let authentik = Arc::new(AuthentikClient::new(
        config.authentik_base_url.clone(),
        config.authentik_api_token.clone(),
    ));

    // Build shared state.
    let state = AppState {
        authentik,
        token_cache: Arc::new(build_token_cache()),
    };

    // Build the SPA static file service.
    tracing::info!("serving static files from {:?}", static_dir);
    let index_html: PathBuf = static_dir.join("index.html");

    // Build the axum router.
    // ServeDir handles real asset files; the fallback closure returns index.html with
    // HTTP 200 for all other paths so React Router can handle client-side navigation.
    let app = Router::new()
        .merge(routes::router(state))
        .nest_service("/assets", ServeDir::new(static_dir.join("assets")))
        .fallback(move || {
            let path = index_html.clone();
            async move {
                match tokio::fs::read(&path).await {
                    Ok(bytes) => (
                        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
                        bytes,
                    )
                        .into_response(),
                    Err(_) => axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                }
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
