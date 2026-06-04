pub mod groups;
pub mod search;
pub mod users;

use axum::Router;

use crate::AppState;

pub fn router(state: AppState) -> Router {
    Router::new()
        .merge(users::router())
        .merge(groups::router())
        .merge(search::router())
        .with_state(state)
}
