use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub authentik_base_url: String,
    pub authentik_api_token: String,
    pub oidc_client_id: String,
    pub oidc_redirect_uri: String,
    /// Allowed CORS origin, e.g. "https://app.example.com".
    /// Defaults to the scheme+host+port of OIDC_REDIRECT_URI.
    /// Override with APP_ORIGIN if they differ.
    pub app_origin: String,
    /// Set CORS_PERMISSIVE=true in local dev to allow all origins.
    /// Must never be set in production.
    pub cors_permissive: bool,
    pub backend_port: u16,
    pub static_dir: std::path::PathBuf,
    pub audit_log_path: std::path::PathBuf,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let oidc_redirect_uri = std::env::var("OIDC_REDIRECT_URI")
            .context("OIDC_REDIRECT_URI must be set")?;
        let app_origin = std::env::var("APP_ORIGIN")
            .unwrap_or_else(|_| origin_from_redirect_uri(&oidc_redirect_uri));
        Ok(Self {
            authentik_base_url: std::env::var("AUTHENTIK_BASE_URL")
                .context("AUTHENTIK_BASE_URL must be set")?,
            authentik_api_token: std::env::var("AUTHENTIK_API_TOKEN")
                .context("AUTHENTIK_API_TOKEN must be set")?,
            oidc_client_id: std::env::var("OIDC_CLIENT_ID")
                .context("OIDC_CLIENT_ID must be set")?,
            oidc_redirect_uri,
            app_origin,
            cors_permissive: std::env::var("CORS_PERMISSIVE").as_deref() == Ok("true"),
            backend_port: std::env::var("BACKEND_PORT")
                .context("BACKEND_PORT must be set")?
                .parse::<u16>()
                .context("BACKEND_PORT must be a valid port number")?,
            static_dir: std::env::var("STATIC_DIR")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("../frontend/dist")),
            audit_log_path: std::env::var("AUDIT_LOG_PATH")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|_| std::path::PathBuf::from("audit.log")),
        })
    }
}

/// Strips the path from a URI to get its origin.
/// "https://app.example.com/callback" → "https://app.example.com"
fn origin_from_redirect_uri(uri: &str) -> String {
    let after_scheme = uri.find("://").map(|i| i + 3).unwrap_or(0);
    let rest = &uri[after_scheme..];
    let path_start = rest.find('/').unwrap_or(rest.len());
    uri[..after_scheme + path_start].to_string()
}
