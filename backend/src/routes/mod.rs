pub mod groups;
pub mod users;

use axum::Router;

use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(users::router())
        .merge(groups::router())
        .with_state(state)
}
