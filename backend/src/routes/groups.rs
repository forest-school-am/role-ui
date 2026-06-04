use axum::{
    extract::{Path, Query, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet};

use crate::{
    audit,
    auth::AuthenticatedUser,
    authentik::{is_leader_of_any_parent, resolve_role, AuthentikGroup, AuthentikUser},
    error::AppError,
    models::{GroupDetail, GroupMember, GroupRole, GroupSummary, MutationSuccess},
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/groups", get(list_groups))
        .route("/api/groups/:group_pk", get(get_group))
        .route("/api/groups/:group_pk/members", post(add_member))
        .route(
            "/api/groups/:group_pk/members/:user_pk",
            delete(remove_member),
        )
        .route("/api/groups/:group_pk/managers", post(add_manager))
        .route(
            "/api/groups/:group_pk/managers/:user_pk",
            delete(remove_manager),
        )
        .route("/api/groups/:group_pk/leader", put(set_leader))
        .route("/api/groups/:group_pk/subgroups", post(create_subgroup))
}

// ---------------------------------------------------------------------------
// Query param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GroupsQuery {
    include_members: Option<bool>,
}

#[derive(Deserialize)]
struct AddMemberBody {
    user_pk: i64,
}

#[derive(Deserialize)]
struct AddManagerBody {
    user_pk: i64,
}

#[derive(Deserialize)]
struct SetLeaderBody {
    user_pk: i64,
}

#[derive(Deserialize)]
struct CreateSubgroupBody {
    name: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Convert an AuthentikUser to a GroupMember output model.
fn to_group_member(u: &AuthentikUser) -> GroupMember {
    GroupMember {
        pk: u.pk,
        uuid: u.uuid.clone(),
        username: u.username.clone(),
        name: u.name.clone(),
        email: u.email.clone(),
        is_active: u.is_active,
    }
}

/// Filter predicate for our org groups (exclude authentik system groups).
fn is_org_group(group: &AuthentikGroup) -> bool {
    !group.name.starts_with("authentik")
}

/// Build a GroupSummary from an AuthentikGroup.
fn to_group_summary(group: &AuthentikGroup) -> GroupSummary {
    let attrs = group
        .attributes
        .as_ref()
        .cloned()
        .unwrap_or_else(|| json!({}));

    let leader_uuid = attrs
        .get("leader")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let manager_uuids: Vec<String> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str())
                .map(|s| s.to_string())
                .collect()
        })
        .unwrap_or_default();

    GroupSummary {
        pk: group.pk.clone(),
        name: group.name.clone(),
        is_superuser: group.is_superuser,
        parent_pks: group.parents.clone(),
        leader_uuid,
        manager_uuids,
        member_count: group.users.len(),
    }
}

/// Partition a list of users into leader/managers/members based on group attributes.
fn partition_members(
    group: &AuthentikGroup,
    users: &[AuthentikUser],
) -> (Option<GroupMember>, Vec<GroupMember>, Vec<GroupMember>) {
    let attrs = group
        .attributes
        .as_ref()
        .cloned()
        .unwrap_or_else(|| json!({}));

    let leader_uuid: Option<&str> = attrs.get("leader").and_then(|v| v.as_str());

    let manager_uuids: HashSet<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let mut leader: Option<GroupMember> = None;
    let mut managers: Vec<GroupMember> = Vec::new();
    let mut members: Vec<GroupMember> = Vec::new();

    for user in users {
        let member = to_group_member(user);
        if leader_uuid == Some(user.uuid.as_str()) {
            leader = Some(member);
        } else if manager_uuids.contains(user.uuid.as_str()) {
            managers.push(member);
        } else {
            members.push(member);
        }
    }

    managers.sort_by(|a, b| a.name.cmp(&b.name));
    members.sort_by(|a, b| a.name.cmp(&b.name));

    (leader, managers, members)
}

/// Build a GroupDetail from a group + its fetched users.
fn to_group_detail(group: &AuthentikGroup, users: &[AuthentikUser]) -> GroupDetail {
    let (leader, managers, members) = partition_members(group, users);

    GroupDetail {
        pk: group.pk.clone(),
        name: group.name.clone(),
        is_superuser: group.is_superuser,
        parent_pks: group.parents.clone(),
        leader,
        managers,
        members,
    }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/groups — list all groups (supports ?include_members=true).
async fn list_groups(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Query(params): Query<GroupsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let all_groups = state.authentik.get_groups_all().await?;

    let org_groups: Vec<&AuthentikGroup> = all_groups.iter().filter(|g| is_org_group(g)).collect();

    if params.include_members.unwrap_or(false) {
        // Collect all unique user PKs across all org groups.
        let all_pks: Vec<i64> = {
            let mut seen: HashSet<i64> = HashSet::new();
            let mut pks = Vec::new();
            for group in &org_groups {
                for &pk in &group.users {
                    if seen.insert(pk) {
                        pks.push(pk);
                    }
                }
            }
            pks
        };

        // Batch-fetch all users once.
        let fetched_users = state.authentik.get_users_by_pks(&all_pks).await?;

        // Build a map from PK to user for O(1) lookup.
        let user_map: HashMap<i64, &AuthentikUser> =
            fetched_users.iter().map(|u| (u.pk, u)).collect();

        // For each group, gather its users and build GroupDetail.
        let group_details: Vec<GroupDetail> = org_groups
            .iter()
            .map(|group| {
                let group_users: Vec<&AuthentikUser> = group
                    .users
                    .iter()
                    .filter_map(|pk| user_map.get(pk).copied())
                    .collect();
                to_group_detail(group, &group_users.iter().copied().cloned().collect::<Vec<_>>())
            })
            .collect();

        Ok(Json(json!({ "groups": group_details })))
    } else {
        let summaries: Vec<GroupSummary> = org_groups.iter().map(|g| to_group_summary(g)).collect();
        Ok(Json(json!({ "groups": summaries })))
    }
}

/// GET /api/groups/:group_pk — full group detail with members.
async fn get_group(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Path(group_pk): Path<String>,
) -> Result<Json<GroupDetail>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;
    let users = state.authentik.get_users_by_pks(&group.users).await?;
    let detail = to_group_detail(&group, &users);
    Ok(Json(detail))
}

/// POST /api/groups/:group_pk/members — add a user as a regular member.
async fn add_member(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path(group_pk): Path<String>,
    Json(body): Json<AddMemberBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let authorized = matches!(caller_role, GroupRole::Manager | GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !authorized {
        audit::log(
            &caller, "add_member", &group_pk, &group.name,
            Some(body.user_pk), "forbidden",
            Some("must be manager or leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be manager or leader of this group".to_string(),
        ));
    }

    // Idempotent: already a member — no audit, no change.
    if group.users.contains(&body.user_pk) {
        return Ok(Json(MutationSuccess::ok()));
    }

    // Verify target user exists.
    let _target = state.authentik.get_user_by_pk(body.user_pk).await.map_err(|e| {
        match e {
            AppError::NotFound(_) => AppError::NotFound("user not found".to_string()),
            other => other,
        }
    })?;

    state
        .authentik
        .add_user_to_group(&group_pk, body.user_pk)
        .await?;

    audit::log(
        &caller, "add_member", &group_pk, &group.name,
        Some(body.user_pk), "ok", None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /api/groups/:group_pk/members/:user_pk — remove a user from a group.
async fn remove_member(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path((group_pk, user_pk)): Path<(String, i64)>,
) -> Result<Json<MutationSuccess>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let is_authorized = matches!(caller_role, GroupRole::Manager | GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !is_authorized {
        audit::log(
            &caller, "remove_member", &group_pk, &group.name,
            Some(user_pk), "forbidden",
            Some("must be manager or leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be manager or leader of this group".to_string(),
        ));
    }

    // Idempotent: not in group — no audit, no change.
    if !group.users.contains(&user_pk) {
        return Ok(Json(MutationSuccess::ok()));
    }

    let target = state.authentik.get_user_by_pk(user_pk).await?;

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let leader_uuid: Option<&str> = attrs.get("leader").and_then(|v| v.as_str());
    let manager_uuids: Vec<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    let target_is_leader = leader_uuid == Some(target.uuid.as_str());
    let target_is_manager = manager_uuids.contains(&target.uuid.as_str());

    if matches!(caller_role, GroupRole::Manager) && target_is_manager {
        audit::log(
            &caller, "remove_member", &group_pk, &group.name,
            Some(user_pk), "forbidden",
            Some("managers cannot remove other managers"),
        );
        return Err(AppError::Forbidden(
            "managers cannot remove other managers".to_string(),
        ));
    }
    if matches!(caller_role, GroupRole::Manager) && target_is_leader {
        audit::log(
            &caller, "remove_member", &group_pk, &group.name,
            Some(user_pk), "forbidden",
            Some("managers cannot remove the group leader"),
        );
        return Err(AppError::Forbidden(
            "managers cannot remove the group leader".to_string(),
        ));
    }
    if matches!(caller_role, GroupRole::Leader) && target_is_leader && target.uuid == caller.uuid {
        audit::log(
            &caller, "remove_member", &group_pk, &group.name,
            Some(user_pk), "forbidden",
            Some("leader cannot remove themselves; reassign leadership first"),
        );
        return Err(AppError::Forbidden(
            "leader cannot remove themselves; reassign leadership first".to_string(),
        ));
    }

    // Build new users list and cleaned attributes — single atomic PATCH.
    let new_users: Vec<i64> = group.users.iter().filter(|&&pk| pk != user_pk).cloned().collect();

    let new_attrs = if target_is_leader || target_is_manager {
        let mut updated = attrs.clone();
        if target_is_leader {
            if let Some(obj) = updated.as_object_mut() {
                obj.remove("leader");
            }
        }
        if target_is_manager {
            let new_managers: Vec<serde_json::Value> = attrs
                .get("managers")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter(|v| v.as_str() != Some(target.uuid.as_str()))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            if let Some(obj) = updated.as_object_mut() {
                obj.insert("managers".to_string(), serde_json::Value::Array(new_managers));
            }
        }
        Some(updated)
    } else {
        None
    };

    let mut patch_body = json!({ "users": new_users });
    if let Some(cleaned_attrs) = new_attrs {
        if let Some(obj) = patch_body.as_object_mut() {
            obj.insert("attributes".to_string(), cleaned_attrs);
        }
    }
    state.authentik.patch_group(&group_pk, patch_body).await?;

    audit::log(
        &caller, "remove_member", &group_pk, &group.name,
        Some(user_pk), "ok", None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// POST /api/groups/:group_pk/managers — assign manager role to a member.
async fn add_manager(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path(group_pk): Path<String>,
    Json(body): Json<AddManagerBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let is_leader = matches!(caller_role, GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !is_leader {
        audit::log(
            &caller, "add_manager", &group_pk, &group.name,
            Some(body.user_pk), "forbidden",
            Some("must be leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be leader of this group".to_string(),
        ));
    }

    if !group.users.contains(&body.user_pk) {
        audit::log(
            &caller, "add_manager", &group_pk, &group.name,
            Some(body.user_pk), "bad_request",
            Some("user is not a member of this group"),
        );
        return Err(AppError::BadRequest(
            "user is not a member of this group".to_string(),
        ));
    }

    let target = state.authentik.get_user_by_pk(body.user_pk).await?;

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let leader_uuid: Option<&str> = attrs.get("leader").and_then(|v| v.as_str());
    let manager_uuids: Vec<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    if leader_uuid == Some(target.uuid.as_str()) {
        audit::log(
            &caller, "add_manager", &group_pk, &group.name,
            Some(body.user_pk), "bad_request",
            Some("user is already the leader"),
        );
        return Err(AppError::BadRequest(
            "user is already the leader".to_string(),
        ));
    }

    // Idempotent: already a manager — no audit, no change.
    if manager_uuids.contains(&target.uuid.as_str()) {
        return Ok(Json(MutationSuccess::ok()));
    }

    let mut new_attrs = attrs.clone();
    let mut new_managers: Vec<serde_json::Value> = manager_uuids
        .iter()
        .map(|s| serde_json::Value::String(s.to_string()))
        .collect();
    new_managers.push(serde_json::Value::String(target.uuid.clone()));

    if let Some(obj) = new_attrs.as_object_mut() {
        obj.insert("managers".to_string(), serde_json::Value::Array(new_managers));
    }

    state
        .authentik
        .patch_group(&group_pk, json!({ "attributes": new_attrs }))
        .await?;

    audit::log(
        &caller, "add_manager", &group_pk, &group.name,
        Some(body.user_pk), "ok", None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /api/groups/:group_pk/managers/:user_pk — remove manager role.
async fn remove_manager(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path((group_pk, user_pk)): Path<(String, i64)>,
) -> Result<Json<MutationSuccess>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let is_leader = matches!(caller_role, GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !is_leader {
        audit::log(
            &caller, "remove_manager", &group_pk, &group.name,
            Some(user_pk), "forbidden",
            Some("must be leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be leader of this group".to_string(),
        ));
    }

    let target = state.authentik.get_user_by_pk(user_pk).await?;

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let manager_uuids: Vec<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    // Idempotent: not a manager — no audit, no change.
    if !manager_uuids.contains(&target.uuid.as_str()) {
        return Ok(Json(MutationSuccess::ok()));
    }

    let new_managers: Vec<serde_json::Value> = manager_uuids
        .iter()
        .filter(|&&s| s != target.uuid.as_str())
        .map(|s| serde_json::Value::String(s.to_string()))
        .collect();

    let mut new_attrs = attrs.clone();
    if let Some(obj) = new_attrs.as_object_mut() {
        obj.insert("managers".to_string(), serde_json::Value::Array(new_managers));
    }

    state
        .authentik
        .patch_group(&group_pk, json!({ "attributes": new_attrs }))
        .await?;

    audit::log(
        &caller, "remove_manager", &group_pk, &group.name,
        Some(user_pk), "ok", None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// PUT /api/groups/:group_pk/leader — transfer leadership to a manager.
async fn set_leader(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path(group_pk): Path<String>,
    Json(body): Json<SetLeaderBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let is_leader = matches!(caller_role, GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !is_leader {
        audit::log(
            &caller, "set_leader", &group_pk, &group.name,
            Some(body.user_pk), "forbidden",
            Some("must be leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be leader of this group".to_string(),
        ));
    }

    let target = state.authentik.get_user_by_pk(body.user_pk).await?;

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let leader_uuid: Option<&str> = attrs.get("leader").and_then(|v| v.as_str());
    let manager_uuids: Vec<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    // Idempotent: already the leader — no audit, no change.
    if leader_uuid == Some(target.uuid.as_str()) {
        return Ok(Json(MutationSuccess::ok()));
    }

    if !manager_uuids.contains(&target.uuid.as_str()) {
        audit::log(
            &caller, "set_leader", &group_pk, &group.name,
            Some(body.user_pk), "bad_request",
            Some("user must be a manager before becoming leader"),
        );
        return Err(AppError::BadRequest(
            "user must be a manager before becoming leader".to_string(),
        ));
    }

    let new_managers: Vec<serde_json::Value> = manager_uuids
        .iter()
        .filter(|&&s| s != target.uuid.as_str())
        .map(|s| serde_json::Value::String(s.to_string()))
        .collect();

    let mut new_attrs = attrs.clone();
    if let Some(obj) = new_attrs.as_object_mut() {
        obj.insert(
            "leader".to_string(),
            serde_json::Value::String(target.uuid.clone()),
        );
        obj.insert("managers".to_string(), serde_json::Value::Array(new_managers));
    }

    state
        .authentik
        .patch_group(&group_pk, json!({ "attributes": new_attrs }))
        .await?;

    audit::log(
        &caller, "set_leader", &group_pk, &group.name,
        Some(body.user_pk), "ok", None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// POST /api/groups/:group_pk/subgroups — create a new child group.
async fn create_subgroup(
    State(state): State<AppState>,
    caller: AuthenticatedUser,
    Path(group_pk): Path<String>,
    Json(body): Json<CreateSubgroupBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let group = state.authentik.get_group(&group_pk).await?;

    let caller_role = resolve_role(&group, &caller.uuid, caller.pk);
    let is_leader = matches!(caller_role, GroupRole::Leader) || {
        let all_groups = state.authentik.get_groups_all().await?;
        is_leader_of_any_parent(&group, &all_groups, &caller.uuid, caller.pk)
    };

    if !is_leader {
        audit::log(
            &caller, "create_subgroup", &group_pk, &group.name,
            None, "forbidden",
            Some("must be leader of this group"),
        );
        return Err(AppError::Forbidden(
            "must be leader of this group".to_string(),
        ));
    }

    let name = body.name.trim().to_string();
    if name.is_empty() {
        audit::log(
            &caller, "create_subgroup", &group_pk, &group.name,
            None, "bad_request",
            Some("name is required"),
        );
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    if name.len() > 150 {
        audit::log(
            &caller, "create_subgroup", &group_pk, &group.name,
            None, "bad_request",
            Some("name must be 150 characters or fewer"),
        );
        return Err(AppError::BadRequest(
            "name must be 150 characters or fewer".to_string(),
        ));
    }

    let new_group = state
        .authentik
        .create_group(json!({
            "name": name,
            "parents": [group_pk],
        }))
        .await?;

    let new_pk = &new_group.pk;

    state
        .authentik
        .patch_group(
            new_pk,
            json!({
                "attributes": {
                    "leader": caller.uuid,
                    "managers": []
                }
            }),
        )
        .await?;

    state
        .authentik
        .add_user_to_group(new_pk, caller.pk)
        .await?;

    let detail = format!("created_group_pk={new_pk} created_group_name={name}");
    audit::log(
        &caller, "create_subgroup", &group_pk, &group.name,
        None, "ok",
        Some(&detail),
    );

    Ok(Json(json!({
        "pk": new_pk,
        "name": new_group.name,
        "leader_uuid": caller.uuid,
    })))
}
