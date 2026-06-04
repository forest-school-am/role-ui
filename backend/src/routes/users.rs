use axum::{
    extract::{Path, State},
    routing::get,
    Json, Router,
};

use crate::{
    auth::AuthenticatedUser,
    authentik::resolve_role,
    error::AppError,
    models::{GroupMembership, User},
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/users/me", get(get_me))
        .route("/api/users/:user_uuid", get(get_user))
}

/// Build a full User response for an authentik user PK and UUID.
async fn build_user_response(
    state: &AppState,
    target_pk: i64,
    target_uuid: &str,
) -> Result<User, AppError> {
    // Fetch full user record and group memberships in parallel.
    let (auth_user, groups) = tokio::try_join!(
        state.authentik.get_user_by_pk(target_pk),
        state.authentik.get_groups_for_user(target_pk),
    )?;

    let telegram = auth_user
        .attributes
        .as_ref()
        .and_then(|a| a.get("telegram"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut group_memberships: Vec<GroupMembership> = groups
        .iter()
        .map(|group| {
            let role = resolve_role(group, target_uuid, target_pk);
            GroupMembership {
                group_pk: group.pk.clone(),
                group_name: group.name.clone(),
                role,
            }
        })
        .collect();

    // Sort alphabetically by group name.
    group_memberships.sort_by(|a, b| a.group_name.cmp(&b.group_name));

    Ok(User {
        pk: auth_user.pk,
        uuid: auth_user.uuid,
        username: auth_user.username,
        name: auth_user.name,
        email: auth_user.email,
        is_active: auth_user.is_active,
        telegram,
        groups: group_memberships,
    })
}

/// GET /api/users/me — returns the authenticated user's profile.
async fn get_me(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
) -> Result<Json<User>, AppError> {
    let user = build_user_response(&state, caller.pk, &caller.uuid).await?;
    Ok(Json(user))
}

/// GET /api/users/:user_uuid — returns any user's profile.
async fn get_user(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Path(user_uuid): Path<String>,
) -> Result<Json<User>, AppError> {
    let auth_user = state.authentik.get_user_by_uuid(&user_uuid).await?;
    let user = build_user_response(&state, auth_user.pk, &auth_user.uuid).await?;
    Ok(Json(user))
}
