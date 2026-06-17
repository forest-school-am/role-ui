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
                .route("/name", put(rename_group))
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

#[derive(Deserialize)]
struct RenameGroupBody {
    name: String,
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

    let gpk = &group.pk;
    let upk = state.authentik_state.user_by_username(&username).await?.pk;
    state.authentik_client.add_user_to_group(gpk, upk).await?;

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

    let gpk = &group.pk;
    let upk = target.pk;

    state.authentik_client.remove_user_from_group(&gpk, upk).await?;

    // If the removed user was a manager, strip them from the attributes too
    if target_role == GroupRole::Manager {
        let mut ga = group.attrs.clone();
        if let Some(fs) = ga.forest_school.as_mut() {
            fs.manager.retain(|u| u != &target.username);
        }
        state.authentik_client.patch_group_attributes(gpk, ga.into_raw()
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

    let gpk = &group.pk;

    let mut ga = group.attrs.clone();
    let fs = ga.forest_school.get_or_insert_with(Default::default);
    if !fs.manager.contains(&username) {
        fs.manager.push(username.clone());
    }

    state.authentik_client.patch_group_attributes(gpk, ga.into_raw()
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

    let gpk = &group.pk;

    let mut ga = group.attrs.clone();
    if let Some(fs) = ga.forest_school.as_mut() {
        fs.manager.retain(|u| u != &target.username);
    }

    state.authentik_client.patch_group_attributes(gpk, ga.into_raw()
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

    let parent_pk = &group.pk;
    let caller_pk = caller.pk;

    let new_group = state.authentik_client.create_group(&name, parent_pk).await?;

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

    let child = state.authentik_state.get_group_by_name(&child_name).await?;
    let parent_pk = &parent.pk;
    let child_pk = &child.pk;

    let mut parents = child.parent_pks.clone();
    if !parents.contains(&parent_pk) {
        parents.push(parent_pk.clone());
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
    let parents: Vec<String> = child.parent_pks.iter()
        .filter(|p| *p != &parent.pk)
        .cloned()
        .collect();

    state.authentik_client.patch_group_parents(&child.pk, parents).await?;

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

    let gpk = &group.pk;
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

    let gpk = &group.pk;
    let mut ga = group.attrs.clone();
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

    let gpk = &group.pk;
    let mut ga = group.attrs.clone();
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

    let gpk = &group.pk;
    let mut ga = group.attrs.clone();
    let fs = ga.forest_school.get_or_insert_with(Default::default);
    // Remove only the resigning caller; other co-leaders stay.
    fs.leaders.retain(|u| u != &caller.username);
    if !fs.leaders.contains(&successor_username) {
        fs.leaders.push(successor_username.clone());
    }
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

fn valid_hex_color(s: &str) -> bool {
    let hex = match s.strip_prefix('#') {
        Some(h) => h,
        None => return false,
    };
    matches!(hex.len(), 3 | 4 | 6 | 8) && hex.bytes().all(|b| b.is_ascii_hexdigit())
}

async fn set_group_color(
    State(state): State<AppState>,
    _fresh: FreshCache,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    _write_lock: WriteLock,
    Json(SetColorBody { color }): Json<SetColorBody>,
) -> Result<Json<()>, AppError> {
    if !valid_hex_color(&color) {
        return Err(AppError::BadRequest(
            "color must be a hex color: #rgb, #rgba, #rrggbb, or #rrggbbaa".to_string(),
        ));
    }
    let gpk = &group.pk;
    let mut ga = group.attrs.clone();
    ga.forest_school.get_or_insert_with(Default::default).color = Some(color.clone());

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "set_group_color", &group.name, None, "ok", Some(&color));
    Ok(Json(()))
}

async fn rename_group(
    State(state): State<AppState>,
    _fresh: FreshCache,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(RenameGroupBody { name }): Json<RenameGroupBody>,
) -> Result<Json<()>, AppError> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err(AppError::BadRequest("name is required".to_string()));
    }
    if name.len() < 5 {
        return Err(AppError::BadRequest(
            "name must be at least 5 characters".to_string(),
        ));
    }
    let old_name = group.name.clone();
    state.authentik_client.patch_group_name(&group.pk, name.clone()).await?;
    audit::log(&caller, "rename_group", &old_name, None, "ok", Some(&name));
    Ok(Json(()))
}

#[derive(Deserialize)]
struct GoogleSyncEntryBody {
    name: Option<String>,
    email: Option<String>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct SetGoogleSyncBody {
    recursive: Option<GoogleSyncEntryBody>,
    direct: Option<GoogleSyncEntryBody>,
}

/// PATCH /api/groups/:group_name/google-sync
/// Each of `recursive` and `direct` is optional; within each, all fields are optional patches.
async fn set_google_sync(
    State(state): State<AppState>,
    _fresh: FreshCache,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
    Json(body): Json<SetGoogleSyncBody>,
) -> Result<Json<()>, AppError> {
    fn valid_email_local(s: &str) -> bool {
        !s.is_empty() && s.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'.' || b == b'-')
    }

    // Validate email formats.
    for (kind, entry) in [("recursive", body.recursive.as_ref()), ("direct", body.direct.as_ref())] {
        if let Some(e) = entry {
            if let Some(email) = &e.email {
                if !valid_email_local(email) {
                    return Err(AppError::BadRequest(format!("{kind}.email must match [a-z0-9.-]+")));
                }
            }
        }
    }

    // Effective emails after this patch (fall back to current cached value).
    let current = group.google_sync.as_ref();
    let eff_recursive_email = body.recursive.as_ref().and_then(|e| e.email.as_deref())
        .or_else(|| current?.recursive.as_ref().and_then(|e| e.email.as_deref()));
    let eff_direct_email = body.direct.as_ref().and_then(|e| e.email.as_deref())
        .or_else(|| current?.direct.as_ref().and_then(|e| e.email.as_deref()));

    // The two slots must hold different emails.
    if let (Some(r), Some(d)) = (eff_recursive_email, eff_direct_email) {
        if r == d {
            return Err(AppError::BadRequest("recursive.email and direct.email must be different".to_string()));
        }
    }

    // Every email must be globally unique across all groups.
    for email in [eff_recursive_email, eff_direct_email].into_iter().flatten() {
        if let Some(owner) = state.authentik_state.google_sync_email_owner(email) {
            if owner != group.name {
                return Err(AppError::BadRequest(format!(
                    "`{email}` is already used by group `{owner}`"
                )));
            }
        }
    }

    let gpk = &group.pk;
    let mut ga = group.attrs.clone();
    let gs = ga.forest_school
        .get_or_insert_with(Default::default)
        .google_sync
        .get_or_insert_with(Default::default);

    if let Some(entry) = body.recursive {
        let rc = gs.recursive.get_or_insert_with(Default::default);
        if let Some(v) = entry.name { rc.name = Some(v); }
        if let Some(v) = entry.email { rc.email = Some(v); }
        if let Some(v) = entry.description { rc.description = v; }
    }
    if let Some(entry) = body.direct {
        let dc = gs.direct.get_or_insert_with(Default::default);
        if let Some(v) = entry.name { dc.name = Some(v); }
        if let Some(v) = entry.email { dc.email = Some(v); }
        if let Some(v) = entry.description { dc.description = v; }
    }

    state.authentik_client.patch_group_attributes(&gpk, ga.into_raw()
        .map_err(|e| AppError::BadRequest(e.to_string()))?).await?;

    audit::log(&caller, "set_google_sync", &group.name, None, "ok", None);
    Ok(Json(()))
}
