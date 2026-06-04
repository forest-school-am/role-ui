use std::sync::Arc;

use axum::{
    async_trait,
    extract::FromRequestParts,
    http::request::Parts,
};
use moka::future::Cache;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::{authentik::AuthentikClient, error::AppError, AppState};

// ---------------------------------------------------------------------------
// Authenticated user — placed in request extensions by the extractor
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub uuid: String,
    pub email: String,
    pub username: String,
    pub pk: i64,
}

// ---------------------------------------------------------------------------
// OIDC userinfo response (partial — we only need a few fields)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct UserinfoResponse {
    /// Subject — authentik user UUID
    pub sub: String,
    pub email: Option<String>,
    pub preferred_username: Option<String>,
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

/// In-memory cache: user UUID → integer PK.  TTL 5 min.
pub fn build_uuid_pk_cache() -> Cache<String, i64> {
    Cache::builder()
        .time_to_live(std::time::Duration::from_secs(300))
        .max_capacity(10_000)
        .build()
}

// ---------------------------------------------------------------------------
// Token validation helpers
// ---------------------------------------------------------------------------

async fn validate_token(
    token: &str,
    base_url: &str,
    oidc_slug: &str,
    client: &reqwest::Client,
) -> Result<UserinfoResponse, AppError> {
    // In authentik 2025+, the userinfo endpoint is global (no slug in path).
    let _ = oidc_slug; // slug not used for URL, kept in config for OIDC client-side config
    let userinfo_url = format!(
        "{}/application/o/userinfo/",
        base_url.trim_end_matches('/')
    );

    let resp = client
        .get(&userinfo_url)
        .header("Authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| AppError::AuthentikError(format!("userinfo request failed: {e}")))?;

    if resp.status() == reqwest::StatusCode::UNAUTHORIZED
        || resp.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(AppError::Unauthorized);
    }

    if !resp.status().is_success() {
        return Err(AppError::AuthentikError(format!(
            "userinfo returned status {}",
            resp.status()
        )));
    }

    resp.json::<UserinfoResponse>()
        .await
        .map_err(|e| AppError::AuthentikError(format!("failed to decode userinfo: {e}")))
}

async fn resolve_pk(
    uuid: &str,
    authentik: &Arc<AuthentikClient>,
    uuid_pk_cache: &Arc<Cache<String, i64>>,
) -> Result<i64, AppError> {
    if let Some(pk) = uuid_pk_cache.get(uuid).await {
        return Ok(pk);
    }

    let user = authentik.get_user_by_uuid(uuid).await?;
    uuid_pk_cache.insert(uuid.to_string(), user.pk).await;
    Ok(user.pk)
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
        // Extract the Authorization header.
        let auth_header = parts
            .headers
            .get("Authorization")
            .and_then(|v| v.to_str().ok())
            .ok_or(AppError::Unauthorized)?;

        let token = auth_header
            .strip_prefix("Bearer ")
            .ok_or(AppError::Unauthorized)?;

        // Check the token cache first.
        let key = token_hash(token);

        if let Some(user) = state.token_cache.get(&key).await {
            return Ok(user);
        }

        // Call userinfo endpoint to validate the token and get claims.
        let info = validate_token(
            token,
            &state.config.authentik_base_url,
            &state.config.authentik_oidc_slug,
            &state.http_client,
        )
        .await?;

        // Resolve integer PK (cached separately with 5-min TTL).
        let pk = resolve_pk(&info.sub, &state.authentik, &state.uuid_pk_cache).await?;

        let user = AuthenticatedUser {
            uuid: info.sub,
            email: info.email.unwrap_or_default(),
            username: info.preferred_username.unwrap_or_default(),
            pk,
        };

        // Cache the result for 60 seconds.
        state.token_cache.insert(key, user.clone()).await;

        Ok(user)
    }
}
