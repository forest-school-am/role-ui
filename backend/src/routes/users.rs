use axum::{
    extract::{Query, State},
    routing::{get, patch},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use std::collections::HashMap;

use crate::{
    audit,
    error::AppError,
    routes::helpers::{FreshCache, PathParams, PathParamsUsername, UserFromPath, WriteLock},
    AppState,
};
use crate::routes::api_models::{User, UserLink};
use authentik_forest_school_attributes::UserAttributes;
use regex::Regex;

pub fn router() -> Router<AppState> {
    Router::new().nest(
        "/users",
        Router::new()
            .route("/", get(search_users))
            .route("/me", get(get_me))
            .route("/me/attributes", patch(patch_my_attributes))
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

async fn get_me(
    _fresh: FreshCache,
    caller: User,
) -> Result<Json<User>, AppError> {
    Ok(Json(caller))
}

/// GET /api/users/:username — full profile for a user by username.
async fn get_user(
    _fresh: FreshCache,
    UserFromPath { user, .. }: UserFromPath<PathParamsUsername>,
) -> Result<Json<User>, AppError> {
    Ok(Json(user))
}

/// GET /api/users?search=term — search users by term, returns Vec<UserSummary>.
/// If search is absent or empty, returns an empty array.
async fn search_users(
    _fresh: FreshCache,
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
                .map_err(|_| AppError::BadRequest(format!("Could not search for `{}`", term)))?
        );

    Ok(Json(state.authentik_state.search_users_to_links(&term).await))
}

// ---------------------------------------------------------------------------
// User attributes
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PatchAttributesBody {
    attributes: HashMap<String, String>,
}

/// PATCH /api/users/me/attributes
/// Body: {"attributes": {"key": "value", ...}}
/// Replaces the caller's entire forest_school.user-defined map.
async fn patch_my_attributes(
    _fresh: FreshCache,
    State(state): State<AppState>,
    caller: User,
    _write_lock: WriteLock,
    Json(body): Json<PatchAttributesBody>,
) -> Result<Json<()>, AppError> {
    let user_pk = state.authentik_state.username_to_pk(&caller.username).await?;
    let compat = state.authentik_state.get_compat_user_by_username(&caller.username).await?;
    let mut ua = UserAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    ua.forest_school.get_or_insert_with(Default::default).user_defined = body.attributes;

    state.authentik_client.patch_user_attributes(user_pk as i32, ua.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "patch_user_attributes", "", Some(&caller.username), "ok", None);
    Ok(Json(()))
}
