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

pub fn build_token_cache() -> Cache<String, AuthenticatedUser> {
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
) -> Result<AuthenticatedUser, AppError> {
    let auth_header = headers
        .get("Authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or(AppError::Unauthorized)?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or(AppError::Unauthorized)?;

    let key = token_hash(token);

    if let Some(user) = state.token_cache.get(&key).await {
        return Ok(user);
    }

    let uuid = state.authentik.validate_user_token(token).await?;
    let auth_user = state.authentik.get_user_by_uuid(&uuid).await?;

    let user = AuthenticatedUser {
        uuid,
        username: auth_user.username,
        pk: auth_user.pk,
    };

    state.token_cache.insert(key, user.clone()).await;
    Ok(user)
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

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        _state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        // Middleware already validated and inserted the user — reuse it.
        return match parts.extensions.get::<AuthenticatedUser>() {
            Some(user) => Ok(user.clone()),
            None => Err(AppError::Unauthorized),
        };
    }
}
