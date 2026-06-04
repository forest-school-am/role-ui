use anyhow::{Context, Result};

#[derive(Debug, Clone)]
pub struct Config {
    pub authentik_base_url: String,
    pub authentik_api_token: String,
    pub backend_port: u16,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            authentik_base_url: std::env::var("AUTHENTIK_BASE_URL")
                .context("AUTHENTIK_BASE_URL must be set")?,
            authentik_api_token: std::env::var("AUTHENTIK_API_TOKEN")
                .context("AUTHENTIK_API_TOKEN must be set")?,
            backend_port: std::env::var("BACKEND_PORT")
                .context("BACKEND_PORT must be set")?
                .parse::<u16>()
                .context("BACKEND_PORT must be a valid port number")?,
        })
    }
}
