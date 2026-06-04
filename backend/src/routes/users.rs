use axum::{
    extract::{Path, Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;

use crate::{
    auth::AuthenticatedUser,
    authentik::{resolve_role, AuthentikUser},
    error::AppError,
    models::{GroupMembership, SocialAccount, SshKey, User, UserSummary},
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/users/me", get(get_me))
        .route("/api/users", get(search_users))
        .route("/api/users/:username", get(get_user))
}

// ---------------------------------------------------------------------------
// Query param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct UsersQuery {
    search: Option<String>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Build the social list for a user.
///
/// Order: email (from authentik's own field) first, then anything stored in
/// `attributes["social"]`.  Falls back to the legacy `attributes["telegram"]`
/// key so existing seed data keeps working without a migration.
fn build_social(auth_user: &AuthentikUser) -> Vec<SocialAccount> {
    let mut accounts: Vec<SocialAccount> = Vec::new();

    if !auth_user.email.is_empty() {
        accounts.push(SocialAccount {
            kind: "email".to_string(),
            address: auth_user.email.clone(),
        });
    }

    let attrs = auth_user.attributes.as_ref();

    // New format: attributes["social"] = [{type, address}, ...]
    if let Some(arr) = attrs
        .and_then(|a| a.get("social"))
        .and_then(|v| v.as_array())
    {
        for item in arr {
            let kind = item.get("type").and_then(|v| v.as_str());
            let address = item.get("address").and_then(|v| v.as_str());
            if let (Some(k), Some(a)) = (kind, address) {
                accounts.push(SocialAccount {
                    kind: k.to_string(),
                    address: a.to_string(),
                });
            }
        }
    } else if let Some(tg) = attrs
        .and_then(|a| a.get("telegram"))
        .and_then(|v| v.as_str())
    {
        // Legacy format fallback.
        accounts.push(SocialAccount {
            kind: "telegram".to_string(),
            address: tg.to_string(),
        });
    }

    accounts
}

/// Build the SSH key list from `attributes["ssh_keys"]`.
fn build_ssh(auth_user: &AuthentikUser) -> Vec<SshKey> {
    auth_user
        .attributes
        .as_ref()
        .and_then(|a| a.get("ssh_keys"))
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| {
                    let label = item.get("label")?.as_str()?.to_string();
                    let key = item.get("key")?.as_str()?.to_string();
                    Some(SshKey { label, key })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Build a full User response for an authentik user.
async fn build_user_response(
    state: &AppState,
    target_pk: i64,
    target_uuid: &str,
) -> Result<User, AppError> {
    let (auth_user, groups) = tokio::try_join!(
        state.authentik.get_user_by_pk(target_pk),
        state.authentik.get_groups_for_user(target_pk),
    )?;

    let social = build_social(&auth_user);
    let ssh = build_ssh(&auth_user);

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

    group_memberships.sort_by(|a, b| a.group_name.cmp(&b.group_name));

    Ok(User {
        pk: auth_user.pk,
        uuid: auth_user.uuid,
        username: auth_user.username,
        name: auth_user.name,
        is_active: auth_user.is_active,
        social,
        ssh,
        groups: group_memberships,
    })
}

/// Build a UserSummary from an AuthentikUser.
fn to_user_summary(auth_user: AuthentikUser) -> UserSummary {
    let social = build_social(&auth_user);
    UserSummary {
        pk: auth_user.pk,
        uuid: auth_user.uuid.clone(),
        username: auth_user.username.clone(),
        name: auth_user.name.clone(),
        social,
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn get_me(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
) -> Result<Json<User>, AppError> {
    let user = build_user_response(&state, caller.pk, &caller.uuid).await?;
    Ok(Json(user))
}

/// GET /api/users?search=term — search users by term, returns Vec<UserSummary>.
/// If search is absent or empty, returns empty array.
async fn search_users(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Query(params): Query<UsersQuery>,
) -> Result<Json<Vec<UserSummary>>, AppError> {
    let term = match params.search.as_deref() {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => return Ok(Json(vec![])),
    };

    let results = state.authentik.search_users(&term, 20).await?;
    let summaries: Vec<UserSummary> = results.into_iter().map(to_user_summary).collect();
    Ok(Json(summaries))
}

/// GET /api/users/:username — full profile for a user by username.
async fn get_user(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Path(username): Path<String>,
) -> Result<Json<User>, AppError> {
    let auth_user = state.authentik.get_user_by_username(&username).await?;
    let user = build_user_response(&state, auth_user.pk, &auth_user.uuid).await?;
    Ok(Json(user))
}
