use axum::{
    extract::State,
    routing::{delete, get, patch, post, put},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use std::collections::{HashMap, HashSet, VecDeque};
use itertools::Itertools;
use crate::{
    audit,
    error::AppError,
    routes::helpers::{
        GroupAccess, GroupFromPath, Leader, ManagerOrLeader, PathParams, PathParamsChildGroupName,
        PathParamsGroupName, PathParamsUsername, SuperuserAccess, UserFromPath,
    },
    AppState,
};
use authentik_forest_school_attributes::GroupAttributes;
use crate::authentik_state::GroupIdType;
use crate::routes::api_models::{Group, GroupLink, GroupRole};
use crate::routes::helpers::{FreshCache, WriteLock};

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
                .route("/leaders", post(add_leader))
                .route(
                    formatcp!("/leaders/:{}", PathParams::Username.to_static_str()),
                    delete(remove_leader),
                )
                .route("/leader/resign", post(resign_leader))
                .route("/subgroups", post(create_child_group))
                .route("/children", post(attach_child_group))
                .route(
                    formatcp!("/children/:{}", PathParams::ChildGroupName.to_static_str()),
                    delete(detach_child_group),
                )
                .route("/color", put(set_group_color))
                .route("/google-sync", patch(set_google_sync)),
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

/// Returns true if making `child_name` a child of `parent_name` would create a cycle.
///
/// A cycle is created iff `parent_name` is already reachable from `child_name` by
/// following child edges downward.  Walking upward through parents instead is wrong:
/// it produces false positives for diamond shapes (multiple paths from parent→child)
/// and false negatives when the real cycle runs child→…→parent.
fn would_create_cycle(parent_name: &GroupIdType, child_name: &GroupIdType, all_groups: &[Group]) -> bool {
    let children_map: HashMap<&GroupIdType, Vec<&GroupIdType>> = all_groups
        .iter()
        .map(|g| (&g.name, g.children.iter().map(|gl| &gl.name).collect_vec()))
        .collect();

    let mut visited: HashSet<&GroupIdType> = HashSet::new();
    let mut queue: VecDeque<&GroupIdType> = VecDeque::new();
    queue.push_back(child_name);

    while let Some(current) = queue.pop_front() {
        if current == parent_name {
            return true;
        }
        if visited.insert(current) {
            if let Some(children) = children_map.get(current) {
                for c in children.iter() {
                    if !visited.contains(c) {
                        queue.push_back(c);
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

async fn list_groups(
    _fresh: FreshCache,
    State(state): State<AppState>,
) -> Result<Json<Vec<Group>>, AppError> {
    Ok(Json(state.authentik_state.list_groups().await))
}

async fn get_group(
    _fresh: FreshCache,
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
) -> Result<Json<Group>, AppError> {
    Ok(Json(group))
}

async fn add_member(
    State(state): State<AppState>,
    _fresh: FreshCache,
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

    audit::log(&caller, "add_member", &group.name, Some(&username), "ok", None);
    Ok(Json(()))
}

async fn remove_member(
    State(state): State<AppState>,
    _fresh: FreshCache,
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
        let mut ga = GroupAttributes::from_raw(compat.attributes)
            .map_err(|e| AppError::BadRequest(e.to_string()))?;
        if let Some(fs) = ga.forest_school.as_mut() {
            fs.manager.retain(|u| u != &target.username);
        }
        state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
            .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;
    }

    audit::log(&caller, "remove_member", &group.name, Some(&target.username), "ok", None);
    Ok(Json(()))
}

async fn add_manager(
    State(state): State<AppState>,
    _fresh: FreshCache,
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
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let fs = ga.forest_school.get_or_insert_with(Default::default);
    if !fs.manager.contains(&username) {
        fs.manager.push(username.clone());
    }

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "add_manager", &group.name, Some(&username), "ok", None);
    Ok(Json(()))
}

async fn remove_manager(
    State(state): State<AppState>,
    _fresh: FreshCache,
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
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    if let Some(fs) = ga.forest_school.as_mut() {
        fs.manager.retain(|u| u != &target.username);
    }

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "remove_manager", &group.name, Some(&target.username), "ok", None);
    Ok(Json(()))
}

async fn create_child_group(
    State(state): State<AppState>,
    _fresh: FreshCache,
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
    let mut ga = GroupAttributes::from_raw(new_group.attributes.clone())
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    ga.forest_school.get_or_insert_with(Default::default).leaders = vec![caller.username.clone()];
    state.authentik_client.patch_group_attributes(&new_group.pk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;
    state.authentik_client.add_user_to_group(&new_group.pk, caller_pk).await?;

    audit::log(&caller, "create_child_group", &group.name, None, "ok", Some(&name));
    Ok(Json(GroupLink { name: new_group.name }))
}

async fn attach_child_group(
    State(state): State<AppState>,
    _fresh: FreshCache,
    SuperuserAccess { caller }: SuperuserAccess,
    GroupFromPath { group: parent, .. }: GroupFromPath<PathParamsGroupName>,
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

    audit::log(&caller, "attach_child_group", &parent.name, None, "ok", Some(&child_name));
    Ok(Json(()))
}

async fn detach_child_group(
    State(state): State<AppState>,
    _fresh: FreshCache,
    SuperuserAccess { caller }: SuperuserAccess,
    GroupFromPath { group: parent, .. }: GroupFromPath<PathParamsGroupName>,
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

    audit::log(&caller, "detach_child_group", &parent.name, None, "ok", Some(&child.name));
    Ok(Json(()))
}

async fn disband_group(
    State(state): State<AppState>,
    _fresh: FreshCache,
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

    audit::log(&caller, "disband_group", &group.name, None, "ok", None);
    Ok(Json(()))
}

async fn add_leader(
    State(state): State<AppState>,
    _fresh: FreshCache,
    SuperuserAccess { caller }: SuperuserAccess,
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
    _write_lock: WriteLock,
    Json(UsernameBody { username }): Json<UsernameBody>,
) -> Result<Json<()>, AppError> {
    match state.authentik_state.user_group_role_relation(&group.name, &username).await? {
        None => return Err(AppError::BadRequest("user is not a member of this group".to_string())),
        Some(GroupRole::Leader) => return Ok(Json(())), // idempotent
        _ => {}
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let fs = ga.forest_school.get_or_insert_with(Default::default);
    if !fs.leaders.contains(&username) {
        fs.leaders.push(username.clone());
    }
    fs.manager.retain(|u| u != &username);

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "add_leader", &group.name, Some(&username), "ok", None);
    Ok(Json(()))
}

async fn remove_leader(
    State(state): State<AppState>,
    _fresh: FreshCache,
    SuperuserAccess { caller }: SuperuserAccess,
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUsername>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    if state.authentik_state.user_group_role_relation(&group.name, &target.username).await?
        != Some(GroupRole::Leader)
    {
        return Ok(Json(())); // idempotent
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    if let Some(fs) = ga.forest_school.as_mut() {
        fs.leaders.retain(|u| u != &target.username);
    }

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "remove_leader", &group.name, Some(&target.username), "ok", None);
    Ok(Json(()))
}

async fn resign_leader(
    State(state): State<AppState>,
    _fresh: FreshCache,
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
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let fs = ga.forest_school.get_or_insert_with(Default::default);
    fs.leaders = vec![successor_username.clone()];
    fs.manager.retain(|u| u != &successor_username);

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

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
    _fresh: FreshCache,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    _write_lock: WriteLock,
    Json(SetColorBody { color }): Json<SetColorBody>,
) -> Result<Json<()>, AppError> {
    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    ga.forest_school.get_or_insert_with(Default::default).color = Some(color.clone());

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "set_group_color", &group.name, None, "ok", Some(&color));
    Ok(Json(()))
}

#[derive(Deserialize)]
struct SetGoogleSyncBody {
    recursive_name: Option<String>,
    direct_name: Option<String>,
}

/// PATCH /api/groups/:group_name/google-sync
/// Body: {"recursive_name": "...", "direct_name": "..."} — both fields optional.
/// Sets or clears the google_sync namespace for the group.
async fn set_google_sync(
    State(state): State<AppState>,
    _fresh: FreshCache,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(body): Json<SetGoogleSyncBody>,
) -> Result<Json<()>, AppError> {
    fn valid_sync_name(s: &str) -> bool {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.')
    }

    // Validate format.
    if let Some(name) = &body.recursive_name {
        if !valid_sync_name(name) {
            return Err(AppError::BadRequest("recursive_name must match [a-z0-9.]+".to_string()));
        }
    }
    if let Some(name) = &body.direct_name {
        if !valid_sync_name(name) {
            return Err(AppError::BadRequest("direct_name must match [a-z0-9.]+".to_string()));
        }
    }

    // Compute the effective values after this patch (fall back to the current cached value).
    let current = group.google_sync.as_ref();
    let eff_recursive = body.recursive_name.as_deref()
        .or_else(|| current?.recursive_name.as_deref());
    let eff_direct = body.direct_name.as_deref()
        .or_else(|| current?.direct_name.as_deref());

    // The two slots must hold different values.
    if let (Some(r), Some(d)) = (eff_recursive, eff_direct) {
        if r == d {
            return Err(AppError::BadRequest(
                "recursive_name and direct_name must be different".to_string(),
            ));
        }
    }

    // Every google_sync name must be globally unique across all groups.
    for name in [eff_recursive, eff_direct].into_iter().flatten() {
        if let Some(owner) = state.authentik_state.google_sync_name_owner(name) {
            if owner != group.name {
                return Err(AppError::BadRequest(format!(
                    "`{}` is already used by group `{}`", name, owner
                )));
            }
        }
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name).await?;
    let compat = state.authentik_state.get_compat_group_by_name(&group.name).await?;
    let mut ga = GroupAttributes::from_raw(compat.attributes)
        .map_err(|e| AppError::BadRequest(e.to_string()))?;
    let gs = ga.forest_school
        .get_or_insert_with(Default::default)
        .google_sync
        .get_or_insert_with(Default::default);
    if let Some(name) = body.recursive_name { gs.recursive_name = Some(name); }
    if let Some(name) = body.direct_name { gs.direct_name = Some(name); }

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "set_google_sync", &group.name, None, "ok", None);
    Ok(Json(()))
}
