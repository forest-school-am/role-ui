use axum::{
    async_trait,
    extract::{FromRequestParts, Request, State},
    http::{header::HeaderMap, request::Parts},
    middleware::Next,
    response::Response,
};
use moka::future::Cache;
use sha2::{Digest, Sha256};

use crate::{error::AppError, AppState};
use crate::routes::api_models::User;
// ---------------------------------------------------------------------------
// Authenticated user — placed in request extensions by the extractor
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub uuid: String,
    pub username: String,
    pub pk: i64,
}

// ---------------------------------------------------------------------------
// Cache key helpers
// ---------------------------------------------------------------------------

fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// Cache constructors (called once at startup)
// ---------------------------------------------------------------------------

pub fn build_token_cache() -> Cache<String, String> {
    Cache::builder()
        .time_to_live(std::time::Duration::from_secs(60))
        .max_capacity(10_000)
        .build()
}

// ---------------------------------------------------------------------------
// Shared validation logic
// ---------------------------------------------------------------------------

async fn resolve_authenticated_user(
    headers: &HeaderMap,
    state: &AppState,
) -> Result<User, AppError> {
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;

    let key = token_hash(token);

    if let Some(user) = state.token_cache.get(&key).await {
        return Ok(state.authentik_state.user_by_username(&user).await?);
    }

    let username = state.authentik_client.validate_user_token(token).await
        .map_err(|e| { tracing::warn!("token validation failed: {e}"); e })?;
    let user = state.authentik_state.user_by_username(&username).await;

    if let Ok(user) = user {
        state.token_cache.insert(key, username).await;
        Ok(user)
    } else {
        tracing::warn!("token valid for '{}' but user not found in state; triggering refresh", username);
        let _ = state.tx.send(()).await;
        Err(AppError::Unauthorized)
    }

}

// ---------------------------------------------------------------------------
// Global auth middleware — applied at the router level
// ---------------------------------------------------------------------------

pub async fn auth_middleware(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let user = resolve_authenticated_user(request.headers(), &state).await?;
    request.extensions_mut().insert(user);
    Ok(next.run(request).await)
}

// ---------------------------------------------------------------------------
// FromRequestParts — handlers that need the caller identity use this extractor
// ---------------------------------------------------------------------------
