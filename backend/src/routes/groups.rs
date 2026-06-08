use axum::{
    extract::{Query, State},
    routing::{delete, get, post, put},
    Json, Router,
};
use const_format::formatcp;
use serde::Deserialize;
use serde_json::json;
use std::collections::{HashMap, HashSet, VecDeque};
use enum_map::{Enum, EnumMap};
use itertools::Itertools;
use crate::{
    audit,
    auth::AuthenticatedUser,
    authentik::{AuthentikGroup, AuthentikUser},
    error::AppError,
    routes::helpers::{
        GroupAccess, GroupFromPath, Leader, ManagerOrLeader, PathParams, PathParamsGroupName,
        PathParamsUserPK, UserFromPath,
    },
    AppState,
};
use crate::authentik::{get_forest_school_custom_attributes, resolve_role};
// use crate::routes::api_models::AIslop::{GroupChild, GroupDetail, GroupMember, GroupRole, GroupSummary, MutationSuccess};
use crate::routes::api_models::{Group, GroupLink, UserLink, User, GroupRole, RoleSplit};
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
    successor_pk: i64,
}

#[derive(Deserialize)]
struct SetColorBody {
    color: String,
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

async fn list_groups(
    State(state): State<AppState>,
) -> Result<Json<Vec<Group>>, AppError> {
    Ok(Json(state.authentik_state.list_groups()))
}

async fn get_group(
    GroupFromPath { group, .. }: GroupFromPath<PathParamsGroupName>,
) -> Result<Json<Group>, AppError> {
    Ok(Json(group))
}

async fn add_member(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    Json(UsernameBody { username }): Json<UsernameBody>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    if state.authentik_state.user_group_role_relation(&group.name, &username)?.is_some() {
        return Ok(Json(()))
    }

    let gpk = state.authentik_state.groupname_to_pk(&group.name)?;
    let upk = state.authentik_state.username_to_pk(&username)?;
    state
        .authentik_client
        .add_user_to_group(&gpk, upk)
        .await?;

    audit::log(
        &caller,
        "add_member",
        &group.name,
        Some(&username),
        "ok",
        None,
    );
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
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUserPK>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    // Idempotent: not in group — no audit, no change.
    let target_role = state.authentik_state.user_group_role_relation(&group.name, &target.username)?;
    let target_role = match target_role {
        None => {
            return Ok(Json(()));
        },
        Some(r) => r,
    };

    match (caller_role, target_role) {
        (_, GroupRole::Leader) => {
            return Err(AppError::Forbidden(
                "Removing leaders from a group is not allowed".to_string(),
            ));
        },
        (GroupRole::Leader, GroupRole::Manager) => {

        },
        (_, GroupRole::Manager) => {
            return Err(AppError::Forbidden(
                "Only leaders can remove managers from the group".to_string(),
            ));
        },
        (_, GroupRole::Member) => {

        },
    }
    Ok(Json(()))
}

async fn add_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<UsernameBody>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}

async fn remove_manager(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    UserFromPath { user: target, .. }: UserFromPath<PathParamsUserPK>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}

async fn create_child_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<CreateSubgroupBody>,
    _write_lock: WriteLock,
) -> Result<Json<serde_json::Value>, AppError> {
    todo!()
}

async fn attach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    Json(body): Json<AddChildGroupBody>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}

async fn detach_child_group(
    State(state): State<AppState>,
    GroupAccess {
        group: parent,
        caller,
        ..
    }: GroupAccess<Leader>,
    GroupFromPath { group: child, .. }: GroupFromPath<PathParamsGroupName>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}

async fn disband_group(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}


async fn resign_leader(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<Leader>,
    Json(body): Json<ResignLeaderBody>,
    _write_lock: WriteLock,
) -> Result<Json<()>, AppError> {
    todo!()
}

async fn set_group_color(
    State(state): State<AppState>,
    GroupAccess { group, caller, .. }: GroupAccess<ManagerOrLeader>,
    Json(body): Json<SetColorBody>,
) -> Result<Json<()>, AppError> {
    todo!()
}
