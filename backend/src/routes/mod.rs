pub mod groups;
mod helpers;
pub mod search;
pub mod users;
pub mod api_models;

use axum::{middleware, Router};

use crate::{auth::auth_middleware, AppState};

pub fn router(state: AppState) -> Router {
    return Router::new()
        .nest(
            "/api",
            Router::new()
                .merge(users::router())
                // .merge(groups::router())
                .merge(search::router()),
        )
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            auth_middleware,
        ))
        .with_state(state);
}
