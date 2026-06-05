use axum::{
    extract::{Query, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};

use crate::{
    audit,
    auth::AuthenticatedUser,
    authentik::{AuthentikGroup, AuthentikUser},
    error::AppError,
    models::{GroupChild, GroupDetail, GroupMember, GroupRole, GroupSummary, MutationSuccess},
    routes::helpers::{
        GroupAccess, GroupFromPath, Leader, ManagerOrLeader, PathParams, PathParamsGroupName,
        PathParamsUserPK, UserFromPath,
    },
    AppState,
};

pub fn router() -> Router<AppState> {
    Router::new().nest(
        "/groups",
        Router::new().route("/", get(list_groups)).nest(
            formatcp!("/:{}", PathParams::GroupName.to_static_str()),
            Router::new()
                .route("/", get(get_group))
                .route("/", delete(disband_group))
                .route("/members", post(add_member))
                .route(
                    formatcp!("/members/:{}", PathParams::UserPK.to_static_str()),
                    delete(remove_member),
                )
                .route("/managers", post(add_manager))
                .route(
                    formatcp!("/managers/:{}", PathParams::UserPK.to_static_str()),
                    delete(remove_manager),
                )
                .route("/leader/resign", post(resign_leader))
                .route("/subgroups", post(create_child_group))
                .route("/children", post(attach_child_group))
                .route(
                    formatcp!("/children/:{}", PathParams::ChildGroupName.to_static_str()),
                    delete(detach_child_group),
                )
                .route("/color", put(set_group_color)),
        ),
    )
}

// ---------------------------------------------------------------------------
// Query param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct GroupsQuery {
    include_members: Option<bool>,
}

#[derive(Deserialize)]
struct UserPkBody {
    user_pk: i64,
}

#[derive(Deserialize)]
struct CreateSubgroupBody {
    name: String,
}

#[derive(Deserialize)]
struct AddChildGroupBody {
    group_name: String,
}

#[derive(Deserialize)]
struct ResignLeaderBody {
    successor_pk: i64,
}

#[derive(Deserialize)]
struct SetColorBody {
    color: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Resolve a group by its name.
async fn resolve_group(state: &AppState, name: &str) -> Result<AuthentikGroup, AppError> {
    state.authentik.get_group_by_name(name).await
}

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

    let (leader_uuid_str, manager_uuid_strs) = parse_role_attrs(&attrs);
    let leader_uuid = leader_uuid_str.map(|s| s.to_string());
    let manager_uuids: Vec<String> = manager_uuid_strs.iter().map(|s| s.to_string()).collect();

    let color = group
        .attributes
        .as_ref()
        .and_then(|a| a.get("color"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    GroupSummary {
        pk: group.pk.clone(),
        name: group.name.clone(),
        is_superuser: group.is_superuser,
        parent_pks: group.parents.clone(),
        leader_uuid,
        manager_uuids,
        member_count: group.users.len(),
        color,
        is_virtual: false,
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

    let (leader_uuid, manager_uuids_vec) = parse_role_attrs(&attrs);
    let manager_uuids: HashSet<&str> = manager_uuids_vec.into_iter().collect();

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

/// Build a GroupDetail from a group + its fetched users + its direct children.
fn to_group_detail(
    group: &AuthentikGroup,
    users: &[AuthentikUser],
    children: Vec<GroupChild>,
) -> GroupDetail {
    let (leader, managers, members) = partition_members(group, users);

    let color = group
        .attributes
        .as_ref()
        .and_then(|a| a.get("color"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    GroupDetail {
        pk: group.pk.clone(),
        name: group.name.clone(),
        is_superuser: group.is_superuser,
        parent_pks: group.parents.clone(),
        leader,
        managers,
        members,
        children,
        color,
        is_virtual: false,
    }
}

/// Extract leader UUID and manager UUIDs from a group's attributes JSON value.
fn parse_role_attrs(attrs: &serde_json::Value) -> (Option<&str>, Vec<&str>) {
    let leader = attrs.get("leader").and_then(|v| v.as_str());
    let managers = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();
    (leader, managers)
}

/// Check whether adding `child_pk` as a child of `parent_pk` would create a cycle.
/// A cycle exists if `child_pk` is reachable by traversing the parents of `parent_pk`
/// upward (BFS). Uses the `pk` field (UUID string) for comparison.
fn would_create_cycle(parent_pk: &str, child_pk: &str, all_groups: &[AuthentikGroup]) -> bool {
    // Build a map from group pk → its parents
    let parents_map: HashMap<&str, &Vec<String>> = all_groups
        .iter()
        .map(|g| (g.pk.as_str(), &g.parents))
        .collect();

    let mut visited: HashSet<&str> = HashSet::new();
    let mut queue: VecDeque<&str> = VecDeque::new();

    // Start BFS from the child's current parents
    if let Some(parents) = parents_map.get(child_pk) {
        for p in *parents {
            queue.push_back(p.as_str());
        }
    }

    while let Some(current) = queue.pop_front() {
        if current == parent_pk {
            return true;
        }
        if visited.insert(current) {
            if let Some(parents) = parents_map.get(current) {
                for p in *parents {
                    if !visited.contains(p.as_str()) {
                        queue.push_back(p.as_str());
                    }
                }
            }
        }
    }

    false
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET  — list all groups (supports ?include_members=true).
async fn list_groups(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Query(params): Query<GroupsQuery>,
) -> Result<Json<serde_json::Value>, AppError> {
    let all_groups = state.authentik.get_groups_all().await?;

    let org_groups: Vec<&AuthentikGroup> = all_groups.iter().filter(|g| is_org_group(g)).collect();

    // Fetch all real (non-service-account) users for virtual group synthesis.
    let all_real_users = state.authentik.get_all_real_users().await?;
    tracing::debug!(
        internal_plus_external = all_real_users.len(),
        "fetched real users for virtual group synthesis"
    );

    // Collect all user PKs that appear in any real org group.
    let assigned_pks: HashSet<i64> = org_groups
        .iter()
        .flat_map(|g| g.users.iter().copied())
        .collect();

    // Unassigned: active real users not in any org group.
    let unassigned_members: Vec<GroupMember> = {
        let mut v: Vec<GroupMember> = all_real_users
            .iter()
            .filter(|u| u.is_active && !assigned_pks.contains(&u.pk))
            .map(to_group_member)
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    };

    // Suspended: real users where is_active == false (regardless of group membership).
    let suspended_members: Vec<GroupMember> = {
        let mut v: Vec<GroupMember> = all_real_users
            .iter()
            .filter(|u| !u.is_active)
            .map(to_group_member)
            .collect();
        v.sort_by(|a, b| a.name.cmp(&b.name));
        v
    };

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
        let mut group_details: Vec<GroupDetail> = org_groups
            .iter()
            .map(|group| {
                let group_users: Vec<&AuthentikUser> = group
                    .users
                    .iter()
                    .filter_map(|pk| user_map.get(pk).copied())
                    .collect();
                to_group_detail(
                    group,
                    &group_users.iter().copied().cloned().collect::<Vec<_>>(),
                    Vec::new(),
                )
            })
            .collect();

        // Append virtual groups (only if non-empty).
        if !unassigned_members.is_empty() {
            group_details.push(GroupDetail {
                pk: "virtual:unassigned".to_string(),
                name: "Unassigned".to_string(),
                is_superuser: false,
                parent_pks: vec![],
                leader: None,
                managers: vec![],
                members: unassigned_members,
                children: vec![],
                color: Some("#e5e7eb".to_string()),
                is_virtual: true,
            });
        }
        if !suspended_members.is_empty() {
            group_details.push(GroupDetail {
                pk: "virtual:suspended".to_string(),
                name: "Suspended".to_string(),
                is_superuser: false,
                parent_pks: vec![],
                leader: None,
                managers: vec![],
                members: suspended_members,
                children: vec![],
                color: Some("#fecaca".to_string()),
                is_virtual: true,
            });
        }

        Ok(Json(json!({ "groups": group_details })))
    } else {
        let mut summaries: Vec<GroupSummary> =
            org_groups.iter().map(|g| to_group_summary(g)).collect();

        // Append virtual group summaries (only if non-empty).
        if !unassigned_members.is_empty() {
            summaries.push(GroupSummary {
                pk: "virtual:unassigned".to_string(),
                name: "Unassigned".to_string(),
                is_superuser: false,
                parent_pks: vec![],
                leader_uuid: None,
                manager_uuids: vec![],
                member_count: unassigned_members.len(),
                color: Some("#e5e7eb".to_string()),
                is_virtual: true,
            });
        }
        if !suspended_members.is_empty() {
            summaries.push(GroupSummary {
                pk: "virtual:suspended".to_string(),
                name: "Suspended".to_string(),
                is_superuser: false,
                parent_pks: vec![],
                leader_uuid: None,
                manager_uuids: vec![],
                member_count: suspended_members.len(),
                color: Some("#fecaca".to_string()),
                is_virtual: true,
            });
        }

        Ok(Json(json!({ "groups": summaries })))
    }
}

/// GET /:group_name — full group detail with members.
async fn get_group(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
) -> Result<Json<GroupDetail>, AppError> {
    let users = state.authentik.get_users_by_pks(&group.users).await?;

    // Fetch all groups to compute direct children of this group.
    let all_groups = state.authentik.get_groups_all().await?;
    let children: Vec<GroupChild> = all_groups
        .iter()
        .filter(|g| is_org_group(g) && g.parents.contains(&group.pk))
        .map(|g| GroupChild {
            pk: g.pk.clone(),
            name: g.name.clone(),
            is_virtual: false,
        })
        .collect();

    let detail = to_group_detail(&group, &users, children);
    Ok(Json(detail))
}

/// POST /:group_name/members — add a user as a regular member.
async fn add_member(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    Json(body): Json<UserPkBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Idempotent: already a member — no audit, no change.
    if group.users.contains(&body.user_pk) {
        return Ok(Json(MutationSuccess::ok()));
    }

    // Verify target user exists.
    let _target = state
        .authentik
        .get_user_by_pk(body.user_pk)
        .await
        .map_err(|e| match e {
            AppError::NotFound(_) => AppError::NotFound("user not found".to_string()),
            other => other,
        })?;

    state
        .authentik
        .add_user_to_group(&group.pk, body.user_pk)
        .await?;

    audit::log(
        &caller,
        "add_member",
        &group.pk,
        &group.name,
        Some(body.user_pk),
        "ok",
        None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /:group_name/members/:user_pk — remove a user from a group.
async fn remove_member(
    State(state): State<AppState>,
    GroupAccess {
        group,
        caller,
        role: caller_role,
        ..
    }: GroupAccess<ManagerOrLeader>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUserPK>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Idempotent: not in group — no audit, no change.
    if !group.users.contains(&target.pk) {
        return Ok(Json(MutationSuccess::ok()));
    }

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let (leader_uuid, manager_uuids) = parse_role_attrs(&attrs);

    // target is leader, forbid.
    if leader_uuid == Some(target.uuid.as_str()) {
        return Err(AppError::Forbidden(
            "removing leaders from a group is not allowed".to_string(),
        ));
    }

    // target is manager and caller is not leader
    let target_is_manager = manager_uuids.contains(&target.uuid.as_str());
    if target_is_manager && caller_role != GroupRole::Leader {
        return Err(AppError::Forbidden(
            "managers cannot remove other managers".to_string(),
        ));
    }

    // Build new users list and cleaned attributes — single atomic PATCH.
    let new_users: Vec<i64> = group
        .users
        .iter()
        .filter(|&&pk| pk != target.pk)
        .cloned()
        .collect();

    let new_attrs = if target_is_manager {
        let mut updated = attrs.clone();
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
            obj.insert(
                "managers".to_string(),
                serde_json::Value::Array(new_managers),
            );
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
    state.authentik.patch_group(&group.pk, patch_body).await?;

    audit::log(
        &caller,
        "remove_member",
        &group.pk,
        &group.name,
        Some(target.pk),
        "ok",
        None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// POST /:group_name/managers — assign manager role to a member.
async fn add_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<UserPkBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    if !group.users.contains(&body.user_pk) {
        audit::log(
            &caller,
            "add_manager",
            &group.pk,
            &group.name,
            Some(body.user_pk),
            "bad_request",
            Some("user is not a member of this group"),
        );
        return Err(AppError::BadRequest(
            "user is not a member of this group".to_string(),
        ));
    }

    let target = state.authentik.get_user_by_pk(body.user_pk).await?;

    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let (leader_uuid, manager_uuids) = parse_role_attrs(&attrs);

    if leader_uuid == Some(target.uuid.as_str()) {
        audit::log(
            &caller,
            "add_manager",
            &group.pk,
            &group.name,
            Some(body.user_pk),
            "bad_request",
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
        obj.insert(
            "managers".to_string(),
            serde_json::Value::Array(new_managers),
        );
    }

    state
        .authentik
        .patch_group(&group.pk, json!({ "attributes": new_attrs }))
        .await?;

    audit::log(
        &caller,
        "add_manager",
        &group.pk,
        &group.name,
        Some(body.user_pk),
        "ok",
        None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /:group_name/managers/:user_pk — remove manager role.
async fn remove_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUserPK>,
) -> Result<Json<MutationSuccess>, AppError> {
    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let (_leader_uuid, manager_uuids) = parse_role_attrs(&attrs);

    // No change.
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
        obj.insert(
            "managers".to_string(),
            serde_json::Value::Array(new_managers),
        );
    }

    state
        .authentik
        .patch_group(&group.pk, json!({ "attributes": new_attrs }))
        .await?;

    audit::log(
        &caller,
        "remove_manager",
        &group.pk,
        &group.name,
        Some(target.pk),
        "ok",
        None,
    );
    Ok(Json(MutationSuccess::ok()))
}

/// POST /:group_name/subgroups — create a new child group.
async fn create_child_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<CreateSubgroupBody>,
) -> Result<Json<serde_json::Value>, AppError> {
    let name = body.name.trim().to_string();
    if name.is_empty() {
        audit::log(
            &caller,
            "create_subgroup",
            &group.pk,
            &group.name,
            None,
            "bad_request",
            Some("name is required"),
        );
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    if name.len() > 150 {
        audit::log(
            &caller,
            "create_subgroup",
            &group.pk,
            &group.name,
            None,
            "bad_request",
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
            "parents": [group.pk],
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

    state.authentik.add_user_to_group(new_pk, caller.pk).await?;

    let detail = format!("created_group_pk={new_pk} created_group_name={name}");
    audit::log(
        &caller,
        "create_subgroup",
        &group.pk,
        &group.name,
        None,
        "ok",
        Some(&detail),
    );

    Ok(Json(json!({
        "pk": new_pk,
        "name": new_group.name,
        "leader_uuid": caller.uuid,
    })))
}

/// POST /:group_name/children — attach an existing group as a child.
/// Body: { "group_name": "ChildGroupName" }
async fn attach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    Json(body): Json<AddChildGroupBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Resolve child group.
    let child = resolve_group(&state, &body.group_name).await?;

    // 4. Self-reference check.
    if parent.pk == child.pk {
        audit::log(
            &caller,
            "add_child_group",
            &parent.pk,
            &parent.name,
            None,
            "bad_request",
            Some("a group cannot be its own child"),
        );
        return Err(AppError::BadRequest(
            "a group cannot be its own child".to_string(),
        ));
    }

    // 5. Cycle check: child must not be an ancestor of parent.
    let all_groups = state.authentik.get_groups_all().await?;
    if would_create_cycle(&child.pk, &parent.pk, &all_groups) {
        audit::log(
            &caller,
            "add_child_group",
            &parent.pk,
            &parent.name,
            None,
            "bad_request",
            Some("adding this child would create a cycle"),
        );
        return Err(AppError::BadRequest(
            "adding this child would create a cycle".to_string(),
        ));
    }

    // 6. Build new parents list for child (add parent.pk if not already present).
    if child.parents.contains(&parent.pk) {
        // Already a child — idempotent.
        return Ok(Json(MutationSuccess::ok()));
    }

    let mut new_parents = child.parents.clone();
    new_parents.push(parent.pk.clone());

    // 7. PATCH child group.
    state
        .authentik
        .patch_group(&child.pk, json!({ "parents": new_parents }))
        .await?;

    let detail = format!("child_pk={} child_name={}", child.pk, child.name);
    audit::log(
        &caller,
        "add_child_group",
        &parent.pk,
        &parent.name,
        None,
        "ok",
        Some(&detail),
    );

    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /:group_name/children/:child_group_name — detach a child group from its parent.
async fn detach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    GroupFromPath { group: child, .. }: GroupFromPath<PathParamsGroupName>,
) -> Result<Json<MutationSuccess>, AppError> {
    // 4. Verify child is actually a child of parent.
    if !child.parents.contains(&parent.pk) {
        return Err(AppError::BadRequest(
            "group is not a child of this group".to_string(),
        ));
    }

    // 5. Build new parents list: child's parents minus parent.pk.
    let new_parents: Vec<String> = child
        .parents
        .iter()
        .filter(|&pk| pk != &parent.pk)
        .cloned()
        .collect();

    // 6. PATCH child group to remove parent.
    state
        .authentik
        .patch_group(&child.pk, serde_json::json!({ "parents": new_parents }))
        .await?;

    // 7. Audit log.
    let detail = format!("child_pk={} child_name={}", child.pk, child.name);
    audit::log(
        &caller,
        "detach_child_group",
        &parent.pk,
        &parent.name,
        None,
        "ok",
        Some(&detail),
    );

    Ok(Json(MutationSuccess::ok()))
}

/// DELETE /:group_name — disband (permanently delete) a group.
/// Only the direct leader of the group may call this (no parent-inheritance fallback).
/// Blocked if the group has any subgroups.
async fn disband_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Block disbanding if group has subgroups.
    let all_groups = state.authentik.get_groups_all().await?;
    let has_subgroups = all_groups
        .iter()
        .filter(|g| is_org_group(g))
        .any(|g| g.parents.contains(&group.pk));
    if has_subgroups {
        audit::log(
            &caller,
            "disband_group",
            &group.pk,
            &group.name,
            None,
            "bad_request",
            Some("cannot disband a group that has subgroups — detach all subgroups first"),
        );
        return Err(AppError::BadRequest(
            "cannot disband a group that has subgroups — detach all subgroups first".to_string(),
        ));
    }

    // 4. Delete the group in authentik.
    state.authentik.delete_group(&group.pk).await?;

    // 5. Audit log.
    let detail = format!("group_pk={} group_name={}", group.pk, group.name);
    audit::log(
        &caller,
        "disband_group",
        &group.pk,
        &group.name,
        None,
        "ok",
        Some(&detail),
    );

    // 6. Return success.
    Ok(Json(MutationSuccess::ok()))
}

/// POST /:group_name/leader/resign — resign as leader, appoint successor.
/// Body: { "successor_pk": <i64> }
async fn resign_leader(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<ResignLeaderBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Cannot resign to yourself.
    if body.successor_pk == caller.pk {
        audit::log(
            &caller,
            "resign_leader",
            &group.pk,
            &group.name,
            Some(body.successor_pk),
            "bad_request",
            Some("cannot resign leadership to yourself"),
        );
        return Err(AppError::BadRequest(
            "cannot resign leadership to yourself".to_string(),
        ));
    }

    // 4. Successor must be a member.
    if !group.users.contains(&body.successor_pk) {
        audit::log(
            &caller,
            "resign_leader",
            &group.pk,
            &group.name,
            Some(body.successor_pk),
            "bad_request",
            Some("successor must be a member of this group"),
        );
        return Err(AppError::BadRequest(
            "successor must be a member of this group".to_string(),
        ));
    }

    // 5. Fetch successor to get their UUID.
    let successor = state.authentik.get_user_by_pk(body.successor_pk).await?;

    // 6. Build new attributes.
    let attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    let (_leader_uuid, existing_managers) = parse_role_attrs(&attrs);

    if !existing_managers.contains(&successor.uuid.as_str()) {
        return Err(AppError::BadRequest(
            "successor must currently be a manager to be appointed leader".to_string(),
        ));
    }

    // New managers = existing managers minus successor UUID minus caller UUID.
    let new_managers: Vec<serde_json::Value> = existing_managers
        .iter()
        .filter(|&&s| s != successor.uuid.as_str() && s != caller.uuid.as_str())
        .map(|s| serde_json::Value::String(s.to_string()))
        .collect();

    let mut new_attrs = attrs.clone();
    if let Some(obj) = new_attrs.as_object_mut() {
        obj.insert(
            "leader".to_string(),
            serde_json::Value::String(successor.uuid.clone()),
        );
        obj.insert(
            "managers".to_string(),
            serde_json::Value::Array(new_managers),
        );
    }

    // 7. PATCH group attributes.
    state
        .authentik
        .patch_group(&group.pk, json!({ "attributes": new_attrs }))
        .await?;

    // 8. Audit log.
    let detail = format!(
        "successor_pk={} successor_uuid={} successor_username={}",
        successor.pk, successor.uuid, successor.username
    );
    audit::log(
        &caller,
        "resign_leader",
        &group.pk,
        &group.name,
        Some(body.successor_pk),
        "ok",
        Some(&detail),
    );

    Ok(Json(MutationSuccess::ok()))
}

/// PUT /:group_name/color — set or clear the display color for a group.
/// Body: { "color": "#rrggbb" } — or "" to clear.
/// Only the direct leader of the group may call this (no parent-inheritance fallback).
async fn set_group_color(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    Json(body): Json<SetColorBody>,
) -> Result<Json<MutationSuccess>, AppError> {
    // Validate color: must be "#rrggbb" (6-digit hex) or "" to clear.
    let color_value: Option<serde_json::Value> = if body.color.is_empty() {
        // Clear: remove the key.
        None
    } else {
        // Validate: must be exactly "#" followed by 6 hex digits.
        let valid = body.color.len() == 7
            && body.color.starts_with('#')
            && body.color[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !valid {
            audit::log(
                &caller,
                "set_group_color",
                &group.pk,
                &group.name,
                None,
                "bad_request",
                Some("color must be a 6-digit hex string like #rrggbb"),
            );
            return Err(AppError::BadRequest(
                "color must be a 6-digit hex string like #rrggbb".to_string(),
            ));
        }
        Some(serde_json::Value::String(body.color.clone()))
    };

    // 4. Merge into existing attributes.
    let mut attrs = group.attributes.clone().unwrap_or_else(|| json!({}));
    if let Some(obj) = attrs.as_object_mut() {
        match color_value {
            Some(val) => {
                obj.insert("color".to_string(), val);
            }
            None => {
                obj.remove("color");
            }
        }
    }

    state
        .authentik
        .patch_group(&group.pk, json!({ "attributes": attrs }))
        .await?;

    // 5. Audit log.
    let detail = if body.color.is_empty() {
        "color cleared".to_string()
    } else {
        format!("color={}", body.color)
    };
    audit::log(
        &caller,
        "set_group_color",
        &group.pk,
        &group.name,
        None,
        "ok",
        Some(&detail),
    );

    Ok(Json(MutationSuccess::ok()))
}
