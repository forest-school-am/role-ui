use axum::{
    extract::{Query, State},
    routing::{get, patch, post, put},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use std::collections::HashMap;

use crate::{
    audit,
    error::AppError,
    routes::helpers::{FreshCache, PathParams, PathParamsUsername, SuperuserAccess, UserFromPath, WriteLock},
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
            .route("/me/attributes", patch(patch_my_attributes))
            .route("/me/name", put(set_display_name))
            .route(
                formatcp!("/:{}", PathParams::Username.to_static_str()),
                get(get_user),
            )
            .route(
                formatcp!("/:{}/toggle-freeze", PathParams::Username.to_static_str()),
                post(toggle_name_freeze),
            ),
    )
}

#[derive(Deserialize)]
struct UsersQuery {
    search: Option<String>,
}

async fn get_me(
    _fresh: FreshCache,
    State(state): State<AppState>,
    caller: User,
) -> Result<Json<User>, AppError> {
    Ok(Json(state.authentik_state.user_by_username(&caller.username).await?))
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
// Display name
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SetDisplayNameBody {
    name: String,
}

/// PUT /api/users/me/name
/// Changes the caller's display name exactly once. Superusers bypass the
/// one-time limit. After a successful change the `name_frozen` flag is set so
/// subsequent calls are rejected until a superuser resets it.
async fn set_display_name(
    _fresh: FreshCache,
    State(state): State<AppState>,
    caller: User,
    _write_lock: WriteLock,
    Json(SetDisplayNameBody { name }): Json<SetDisplayNameBody>,
) -> Result<Json<()>, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }

    let frozen = caller.attrs.forest_school.as_ref().map_or(false, |f| f.name_frozen);
    if frozen && !caller.is_superuser {
        return Err(AppError::Forbidden(
            "display name has already been changed".to_string(),
        ));
    }

    state.authentik_client.patch_user_name(caller.pk, name.clone()).await?;

    // Mark as frozen (skip if already set to avoid a redundant write).
    if !frozen {
        let mut ua = caller.attrs.clone();
        ua.forest_school.get_or_insert_with(Default::default).name_frozen = true;
        state.authentik_client.patch_user_attributes(caller.pk, ua.into_raw()
            .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;
    }

    audit::log(&caller, "set_display_name", "", Some(&caller.username), "ok", Some(&name));
    Ok(Json(()))
}

/// POST /api/users/:username/toggle-freeze
/// Superuser-only. Toggles the `name_frozen` flag.
async fn toggle_name_freeze(
    _fresh: FreshCache,
    State(state): State<AppState>,
    SuperuserAccess { caller }: SuperuserAccess,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUsername>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    let currently_frozen = target.attrs.forest_school.as_ref().map_or(false, |f| f.name_frozen);
    let new_value = !currently_frozen;

    let mut ua = target.attrs.clone();
    ua.forest_school.get_or_insert_with(Default::default).name_frozen = new_value;
    state.authentik_client.patch_user_attributes(target.pk, ua.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    let action = if new_value { "freeze_display_name" } else { "unfreeze_display_name" };
    audit::log(&caller, action, "", Some(&target.username), "ok", None);
    Ok(Json(()))
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
    let mut ua = caller.attrs.clone();
    ua.forest_school.get_or_insert_with(Default::default).user_defined = body.attributes;

    state.authentik_client.patch_user_attributes(caller.pk, ua.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "patch_user_attributes", "", Some(&caller.username), "ok", None);
    Ok(Json(()))
}
