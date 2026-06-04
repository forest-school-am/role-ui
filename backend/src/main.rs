use std::sync::Arc;

use axum::Router;
use moka::future::Cache;
use tower_http::cors::CorsLayer;
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod audit;
mod auth;
mod authentik;
mod config;
mod error;
mod models;
mod routes;

use auth::{AuthenticatedUser, build_token_cache, build_uuid_pk_cache};
use authentik::AuthentikClient;
use config::Config;

// ---------------------------------------------------------------------------
// AppState — shared across all handlers
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AppState {
    pub config: Arc<Config>,
    pub authentik: Arc<AuthentikClient>,
    pub http_client: reqwest::Client,
    /// Token hash → AuthenticatedUser (60-second TTL)
    pub token_cache: Arc<Cache<String, AuthenticatedUser>>,
    /// User UUID → integer PK (5-minute TTL)
    pub uuid_pk_cache: Arc<Cache<String, i64>>,
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

    // Build the authentik API client.
    let authentik = Arc::new(AuthentikClient::new(
        config.authentik_base_url.clone(),
        config.authentik_api_token.clone(),
    ));

    // Build shared state.
    let state = AppState {
        config: Arc::new(config),
        authentik,
        http_client: reqwest::Client::new(),
        token_cache: Arc::new(build_token_cache()),
        uuid_pk_cache: Arc::new(build_uuid_pk_cache()),
    };

    // Build the axum router.
    let app = Router::new()
        .merge(routes::router(state))
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
