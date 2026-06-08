use axum::{
    extract::State,
    routing::{delete, get, post, put},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};
use itertools::Itertools;
use crate::{
    audit,
    authentik::AuthentikGroup,
    error::AppError,
    routes::helpers::{
        GroupAccess, GroupFromPath, Leader, ManagerOrLeader, PathParams, PathParamsChildGroupName,
        PathParamsGroupName, PathParamsUsername, UserFromPath,
    },
    AppState,
};
use crate::authentik_state::GroupIdType;
use crate::routes::api_models::{Group, GroupLink, GroupRole};
use crate::routes::helpers::WriteLock;

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
                    formatcp!("/members/:{}", PathParams::Username.to_static_str()),
                    delete(remove_member),
                )
                .route("/managers", post(add_manager))
                .route(
                    formatcp!("/managers/:{}", PathParams::Username.to_static_str()),
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
// Request body structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct UsernameBody {
    username: String,
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
    username: String,
}

#[derive(Deserialize)]
struct SetColorBody {
    color: String,
}

// ---------------------------------------------------------------------------
// Cycle detection
// ---------------------------------------------------------------------------

/// Returns true if making `child_pk` a child of `parent_pk` would create a cycle.
fn would_create_cycle(parent_name: &GroupIdType, child_name: &GroupIdType, all_groups: &[Group]) -> bool {
    let parents_map: HashMap<&GroupIdType, Vec<&GroupIdType>> = all_groups
        .iter()
        .map(|g| (&g.name, g.parents.iter().map(|gl| &gl.name).collect_vec()))
        .collect();

    let mut visited: HashSet<&GroupIdType> = HashSet::new();
    let mut queue: VecDeque<&GroupIdType> = VecDeque::new();
    queue.push_back(child_name);

    while let Some(current) = queue.pop_front() {
        if current == parent_name {
            return true;
        }
        if visited.insert(current) {
            if let Some(parents) = parents_map.get(current) {
                for p in parents.iter() {
                    if !visited.contains(p) {
                        queue.push_back(&p);
                    }
                }
            }
        }
    }

    false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Attrs = HashMap<String, serde_json::Value>;

/// Mutably access the `forest_school` sub-object inside an attributes map,
/// creating it if absent.
fn forest_school_mut(attrs: &mut Attrs) -> &mut serde_json::Map<String, serde_json::Value> {
    attrs
        .entry("forest_school".to_string())
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .expect("forest_school must be a JSON object")
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

async fn list_groups(
    State(state): State<AppState>,
) -> Result<Json<Vec<Group>>, AppError> {
    Ok(Json(state.authentik_state.list_groups().await))
}

async fn get_group(
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
) -> Result<Json<Group>, AppError> {
    Ok(Json(group))
}

async fn add_member(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    _write_lock: WriteLock,
    Json(UsernameBody { username }): Json<UsernameBody>,
) -> Result<Json<()>, AppError> {
    // Idempotent: already a member in any role
    if state.authentik_state.user_group_role_relation(&group.name, &username).await?.is_some() {
        return Ok(Json(()));
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let upk = state.authentik_state.username_to_pk(&username).await?;
    state.authentik_client.add_user_to_group(&gpk, upk).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "add_member", &group.name, Some(&username), "ok", None);
    Ok(Json(()))
}

async fn remove_member(
    State(state): State<AppState>,
    GroupAccess {
        group,
        caller,
        role: caller_role,
        ..
    }: GroupAccess<ManagerOrLeader>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUsername>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    let target_role = state
        .authentik_state
        .user_group_role_relation(&group.name, &target.username).await?;
    let target_role = match target_role {
        None => return Ok(Json(())), // idempotent
        Some(r) => r,
    };

    match (&caller_role, &target_role) {
        (_, GroupRole::Leader) => {
            return Err(AppError::Forbidden(
                "Removing leaders from a group is not allowed".to_string(),
            ));
        }
        (GroupRole::Leader, GroupRole::Manager) => {}
        (_, GroupRole::Manager) => {
            return Err(AppError::Forbidden(
                "Only leaders can remove managers from the group".to_string(),
            ));
        }
        (_, GroupRole::Member) => {}
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let upk = state.authentik_state.username_to_pk(&target.username).await?;

    state.authentik_client.remove_user_from_group(&gpk, upk).await?;

    // If the removed user was a manager, strip them from the attributes too
    if target_role == GroupRole::Manager {
        let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
        let mut attrs: Attrs = compat.attributes.unwrap_or_default();
        if let Some(obj) = attrs.get_mut("forest_school").and_then(|v| v.as_object_mut()) {
            if let Some(arr) = obj.get_mut("manager").and_then(|v| v.as_array_mut()) {
                arr.retain(|v| v.as_str() != Some(target.username.as_str()));
            }
        }
        state.authentik_client.patch_group_attributes(&gpk, attrs).await?;
    }

    state.authentik_state.invalidate_and_wait(&state.tx).await?;
    audit::log(&caller, "remove_member", &group.name, Some(&target.username), "ok", None);
    Ok(Json(()))
}

async fn add_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(UsernameBody { username }): Json<UsernameBody>,
) -> Result<Json<()>, AppError> {
    match state.authentik_state.user_group_role_relation(&group.name, &username).await? {
        None => {
            return Err(AppError::BadRequest(
                "user is not a member of this group".to_string(),
            ))
        }
        Some(GroupRole::Leader) => {
            return Err(AppError::BadRequest("user is already the leader".to_string()))
        }
        Some(GroupRole::Manager) => return Ok(Json(())), // idempotent
        Some(GroupRole::Member) => {}
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;

    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut attrs: Attrs = compat.attributes.unwrap_or_default();
    {
        let fs = forest_school_mut(&mut attrs);
        let managers = fs
            .entry("manager".to_string())
            .or_insert_with(|| serde_json::json!([]));
        if let Some(arr) = managers.as_array_mut() {
            if !arr.iter().any(|v| v.as_str() == Some(username.as_str())) {
                arr.push(serde_json::json!(username));
            }
        }
    }

    state.authentik_client.patch_group_attributes(&gpk, attrs).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "add_manager", &group.name, Some(&username), "ok", None);
    Ok(Json(()))
}

async fn remove_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUsername>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    // Idempotent: if not a manager, nothing to do
    if state
        .authentik_state
        .user_group_role_relation(&group.name, &target.username).await?
        != Some(GroupRole::Manager)
    {
        return Ok(Json(()));
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;

    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut attrs: Attrs = compat.attributes.unwrap_or_default();
    if let Some(obj) = attrs.get_mut("forest_school").and_then(|v| v.as_object_mut()) {
        if let Some(arr) = obj.get_mut("manager").and_then(|v| v.as_array_mut()) {
            arr.retain(|v| v.as_str() != Some(target.username.as_str()));
        }
    }

    state.authentik_client.patch_group_attributes(&gpk, attrs).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "remove_manager", &group.name, Some(&target.username), "ok", None);
    Ok(Json(()))
}

async fn create_child_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(CreateSubgroupBody { name }): Json<CreateSubgroupBody>,
) -> Result<Json<GroupLink>, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    if name.len() > 150 {
        return Err(AppError::BadRequest(
            "name must be at most 150 characters".to_string(),
        ));
    }

    let parent_pk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let caller_pk = state.authentik_state.username_to_pk(&caller.username).await?;

    let new_group = state.authentik_client.create_group(&name, &parent_pk).await?;

    // Auto-assign caller as leader (§6.7)
    let mut attrs: Attrs = new_group.attributes.clone().unwrap_or_default();
    {
        let fs = forest_school_mut(&mut attrs);
        fs.insert("leaders".to_string(), serde_json::json!([caller.username]));
    }
    state.authentik_client.patch_group_attributes(&new_group.pk, attrs).await?;
    state.authentik_client.add_user_to_group(&new_group.pk, caller_pk).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "create_child_group", &group.name, None, "ok", Some(&name));
    Ok(Json(GroupLink { name: new_group.name }))
}

async fn attach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(AddChildGroupBody { group_name: child_name }): Json<AddChildGroupBody>,
) -> Result<Json<()>, AppError> {

    if would_create_cycle(&parent.name, &child_name, &state.authentik_state.list_groups().await) {
        return Err(AppError::BadRequest(
            "attaching this group would create a cycle".to_string(),
        ));
    }

    let child_compat = state.authentik_state.get_compat_group_by_name(&child_name).await?;
    let parent_pk = state.authentik_state.groupname_to_pk(&parent.name).await?;
    let child_pk = state.authentik_state.groupname_to_pk(&child_name).await?;

    let mut parents = child_compat.parents;
    if !parents.contains(&parent_pk) {
        parents.push(parent_pk);
    }

    state.authentik_client.patch_group_parents(&child_pk, parents).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "attach_child_group", &parent.name, None, "ok", Some(&child_name));
    Ok(Json(()))
}

async fn detach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    GroupFromPath { group: child, .. }: GroupFromPath<PathParamsChildGroupName>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    let parent_pk = state.authentik_state.groupname_to_pk(&parent.name).await?;
    let child_pk = state.authentik_state.groupname_to_pk(&child.name).await?;

    let child_compat = state.authentik_state.get_compat_group_by_name(&child.name).await?;
    let parents: Vec<String> = child_compat
        .parents
        .into_iter()
        .filter(|p| p != &parent_pk)
        .collect();

    state.authentik_client.patch_group_parents(&child_pk, parents).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "detach_child_group", &parent.name, None, "ok", Some(&child.name));
    Ok(Json(()))
}

async fn disband_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    if !group.children.is_empty() {
        return Err(AppError::BadRequest(
            "group has children — detach or disband them first".to_string(),
        ));
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    state.authentik_client.delete_group(&gpk).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "disband_group", &group.name, None, "ok", None);
    Ok(Json(()))
}

async fn resign_leader(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(ResignLeaderBody { username: successor_username }): Json<ResignLeaderBody>,
) -> Result<Json<()>, AppError> {
    if state
        .authentik_state
        .user_group_role_relation(&group.name, &successor_username).await?
        != Some(GroupRole::Manager)
    {
        return Err(AppError::BadRequest(
            "successor must be a manager of this group".to_string(),
        ));
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut attrs: Attrs = compat.attributes.unwrap_or_default();
    {
        let fs = forest_school_mut(&mut attrs);
        fs.insert("leaders".to_string(), serde_json::json!([successor_username]));
        if let Some(arr) = fs.get_mut("manager").and_then(|v| v.as_array_mut()) {
            arr.retain(|v| v.as_str() != Some(successor_username.as_str()));
        }
    }

    state.authentik_client.patch_group_attributes(&gpk, attrs).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(
        &caller,
        "resign_leader",
        &group.name,
        Some(&successor_username),
        "ok",
        None,
    );
    Ok(Json(()))
}

async fn set_group_color(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    _write_lock: WriteLock,
    Json(SetColorBody { color }): Json<SetColorBody>,
) -> Result<Json<()>, AppError> {
    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut attrs: Attrs = compat.attributes.unwrap_or_default();
    {
        let fs = forest_school_mut(&mut attrs);
        fs.insert("color".to_string(), serde_json::json!(color));
    }

    state.authentik_client.patch_group_attributes(&gpk, attrs).await?;
    state.authentik_state.invalidate_and_wait(&state.tx).await?;

    audit::log(&caller, "set_group_color", &group.name, None, "ok", Some(&color));
    Ok(Json(()))
}
