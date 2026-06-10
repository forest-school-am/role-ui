pub mod groups;
mod helpers;
pub mod search;
pub mod users;
pub mod api_models;

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use axum::{extract::{Request, State}, middleware, middleware::Next, response::Response, Router};

use crate::{auth::auth_middleware, AppState};
use helpers::WriteFlag;

/// After a handler that held a WriteLock:
///   2xx → trigger a background cache refresh (dirty clears when refresh completes)
///   non-2xx → clear dirty immediately (no mutation reached authentik, cache still valid)
async fn invalidate_on_write(
    State(state): State<AppState>,
    mut req: Request,
    next: Next,
) -> Response {
    let flag = Arc::new(AtomicBool::new(false));
    req.extensions_mut().insert(WriteFlag(flag.clone()));
    let response = next.run(req).await;
    if flag.load(Ordering::Acquire) {
        let status = response.status().as_u16();
        if response.status().is_success() {
            tracing::debug!(status, "write succeeded — triggering cache refresh");
            let _ = state.tx.send(()).await;
        } else {
            tracing::debug!(status, "write failed — clearing dirty flag without refresh");
            state.authentik_state.clear_dirty();
        }
    }
    response
}

pub fn router(state: AppState) -> Router {
    return Router::new()
        .nest(
            "/api",
            Router::new()
                .merge(users::router())
                .merge(groups::router())
                .merge(search::router()),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            invalidate_on_write,
        ))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state);
}
