use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("unauthorized")]
    Unauthorized,

    #[error("forbidden: {0}")]
    Forbidden(String),

    #[error("not found: {0}")]
    NotFound(String),

    #[error("bad request: {0}")]
    BadRequest(String),

    #[error("authentik error: {0}")]
    AuthentikError(String),

    #[error("internal error: {0}")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::Unauthorized => {
                tracing::debug!("401 unauthorized");
                (StatusCode::UNAUTHORIZED, "unauthorized".to_string())
            }
            AppError::Forbidden(msg) => {
                tracing::debug!(msg, "403 forbidden");
                (StatusCode::FORBIDDEN, msg.clone())
            }
            AppError::NotFound(msg) => {
                tracing::debug!(msg, "404 not found");
                (StatusCode::NOT_FOUND, msg.clone())
            }
            AppError::BadRequest(msg) => {
                tracing::warn!(msg, "400 bad request");
                (StatusCode::BAD_REQUEST, msg.clone())
            }
            AppError::AuthentikError(msg) => {
                tracing::error!(msg, "502 authentik error");
                (StatusCode::BAD_GATEWAY, msg.clone())
            }
            AppError::Internal(err) => {
                tracing::error!("500 internal error: {err:#}");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal server error".to_string(),
                )
            }
        };

        (status, Json(json!({ "error": message }))).into_response()
    }
}
