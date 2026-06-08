use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use const_format::formatcp;
use enum_map::{Enum, EnumMap};
use serde::Deserialize;

use crate::{
    error::AppError,
    routes::helpers::{PathParams, PathParamsUsername, UserFromPath},
    AppState,
};
use crate::routes::api_models::{User, UserLink};
use regex::Regex;

pub fn router() -> Router<AppState> {
    Router::new().nest(
        "/users",
        Router::new()
            .route("/", get(search_users))
            .route("/me", get(get_me))
            .route(
                formatcp!("/:{}", PathParams::Username.to_static_str()),
                get(get_user),
            ),
    )
}

#[derive(Deserialize)]
struct UsersQuery {
    search: Option<String>,
}

/// Build a full User response for an authentik user.

async fn get_me(
    State(state): State<AppState>,
    caller: User,
) -> Result<Json<User>, AppError> {
    let user = state.authentik_state.user_by_username(&caller.username).await?;
    Ok(Json(user))
}

/// GET /api/users/:username — full profile for a user by username.
async fn get_user(
    State(state): State<AppState>,
    UserFromPath {
        user, ..
    }: UserFromPath<PathParamsUsername>,
) -> Result<Json<User>, AppError> {
    let user = state.authentik_state.user_by_username(&user.username).await?;
    Ok(Json(user))
}

/// GET /api/users?search=term — search users by term, returns Vec<UserSummary>.
/// If search is absent or empty, returns an empty array.
async fn search_users(
    State(state): State<AppState>,
    Query(params): Query<UsersQuery>,
) -> Result<Json<Vec<UserLink>>, AppError> {
    let term = match params.search.as_deref() {
        Some(t) if !t.trim().is_empty() => t.trim().to_owned(),
        _ => return Ok(Json(vec![])),
    };
    let term = Regex::new(&term)
        .unwrap_or(
            Regex::new(&regex::escape(&term))
                .map_err(|e| AppError::BadRequest(format!("Could not search for `{}`", term)))?
        );

    Ok(Json(state.authentik_state.search_users_to_links(&term).await))
}
