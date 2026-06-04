use axum::{
    async_trait,
    extract::FromRequestParts,
    http::request::Parts,
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

/// Hash a bearer token to use as a cache key.
/// We never store the raw token in memory longer than needed.
fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("{:x}", hasher.finalize())
}

// ---------------------------------------------------------------------------
// Cache constructors (called once at startup)
// ---------------------------------------------------------------------------

/// In-memory cache: token_hash → AuthenticatedUser.  TTL 60 s.
pub fn build_token_cache() -> Cache<String, AuthenticatedUser> {
    Cache::builder()
        .time_to_live(std::time::Duration::from_secs(60))
        .max_capacity(10_000)
        .build()
}

// ---------------------------------------------------------------------------
// FromRequestParts implementation
// ---------------------------------------------------------------------------

#[async_trait]
impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let auth_header = parts
            .headers
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

        // Validate token and resolve full user record via AuthentikClient.
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
}
