use std::collections::{HashMap, HashSet};
use std::sync::RwLock;
use anyhow::anyhow;
use enum_map::{Enum};
use itertools::Itertools;
use regex::Regex;
use tokio::sync::watch;
use crate::routes::api_models::{Group, GroupLink, GroupRole, RoleSplit, User, UserLink};
use crate::authentik::{AuthentikClient, AuthentikGroup};
use crate::routes::api_models::GoogleSyncConfig;
use authentik_forest_school_attributes::{GroupAttributes, UserAttributes};
use crate::error::AppError;

fn is_authentik_group(group: &AuthentikGroup) -> bool {
    group.name.starts_with("authentik") || group.is_superuser
}

pub struct AuthentikStateWrapper {
    state: RwLock<AuthentikState>,
    // true = refresh in progress; read requests block until false.
    // Written true by invalidate(), false by update() after the refresh completes.
    dirty_tx: watch::Sender<bool>,
}

impl AuthentikStateWrapper {
    pub fn new() -> Self {
        let (dirty_tx, _) = watch::channel(false);
        Self {
            state: RwLock::new(Default::default()),
            dirty_tx,
        }
    }

    pub async fn update(&self, authentik_client: &AuthentikClient) -> Result<(), AppError> {
        tracing::debug!("cache refresh started");
        let new_state = update_authentik_state(authentik_client).await?;
        {
            let mut lock = self.state.write().unwrap();
            *lock = new_state;
        }
        self.dirty_tx.send_replace(false);
        tracing::debug!("cache refresh complete");
        Ok(())
    }

    /// Marks the cache stale. Called by WriteLock on extraction so reads block for the entire
    /// duration of the write — not just after the response is on the wire.
    pub fn mark_dirty(&self) {
        self.dirty_tx.send_replace(true);
        tracing::debug!("mark_dirty");
    }

    /// Clears the dirty flag without triggering a refresh. Called by middleware when a write
    /// handler returns non-2xx, meaning no mutation reached authentik and the cache is still valid.
    pub fn clear_dirty(&self) {
        self.dirty_tx.send_replace(false);
        tracing::debug!("clear_dirty");
    }

    /// Suspends the caller until any in-progress refresh completes.
    /// Called by the FreshCache extractor; not meant to be used directly inside state methods.
    pub async fn ensure_fresh(&self) {
        let dirty = *self.dirty_tx.borrow();
        tracing::debug!(dirty, "ensure_fresh");
        if dirty {
            let _ = self.dirty_tx.subscribe().wait_for(|d| !d).await;
            tracing::debug!("ensure_fresh: unblocked");
        }
    }

    pub async fn user_by_username(&self, username: &String) -> Result<User, AppError> {
        self.state.read().unwrap().user_id_to_user(username).cloned()
    }

    pub async fn search_users_to_links(&self, re: &Regex) -> Vec<UserLink> {
        self.state.read().unwrap().users.iter()
            .filter(|u| u.matches(re))
            .map(UserLink::from)
            .collect_vec()
    }

    pub async fn list_groups(&self) -> Vec<Group> {
        self.state.read().unwrap().groups.clone()
    }

    pub async fn get_group_by_name(&self, groupname: &String) -> Result<Group, AppError> {
        self.state.read().unwrap().group_id_to_group(groupname).cloned()
    }

    /// Returns the name of whichever group owns `name` as either `recursive_name` or
    /// `direct_name` in its google_sync config, or `None` if the name is unclaimed.
    pub fn google_sync_name_owner(&self, name: &str) -> Option<String> {
        let lock = self.state.read().unwrap();
        lock.groups.iter().find_map(|g| {
            g.google_sync.as_ref().and_then(|gs| {
                if gs.recursive_name.as_deref() == Some(name)
                    || gs.direct_name.as_deref() == Some(name)
                {
                    Some(g.name.clone())
                } else {
                    None
                }
            })
        })
    }

    pub async fn user_group_role_relation(&self, groupname: &GroupIdType, username: &UserIdType) -> Result<Option<GroupRole>, AppError> {
        let lock = self.state.read().unwrap();
        let idx = lock.group_id_to_group_ptr.get(groupname).ok_or(AppError::NotFound(format!("Group `{}` not found", groupname)))?;
        let map = lock.group_users
            .get(*idx)
            .ok_or_else(|| {
                let err = anyhow!("State invariant failed: group_user mapping not found for group `{}` at idx `{}`", groupname, idx);
                tracing::error!("{err:#}");
                AppError::Internal(err)
            })?;
        Ok(map.get(username).cloned())
    }

}

async fn update_authentik_state(authentik_client: &AuthentikClient) -> Result<AuthentikState, AppError> {
    let authentik_users = authentik_client.get_all_real_users().await?;
    let authentik_groups = authentik_client.get_groups_all().await?
        .into_iter()
        .filter(|g| !is_authentik_group(g))
        .collect_vec();

    let user_id_to_user_ptr = HashMap::from_iter(authentik_users.iter()
        .enumerate()
        .map(|(idx, user)| (user.username.clone(), idx)));
    let group_id_to_group_ptr = HashMap::from_iter(authentik_groups.iter()
        .enumerate()
        .map(|(idx, group)| (group.name.clone(), idx)));


    let user_links: HashMap<UserPkType, UserLink> = HashMap::from_iter(authentik_users.iter()
        .map(|user| (user.pk, UserLink {
            username: user.username.clone(),
            name: user.name.clone(),
        })));
    // username → pk reverse index, used to resolve attribute usernames back to PKs
    let username_to_pk: HashMap<&str, UserPkType> = HashMap::from_iter(authentik_users.iter()
        .map(|user| (user.username.as_str(), user.pk)));
    let group_links: HashMap<GroupPkType, GroupLink> = HashMap::from_iter(authentik_groups.iter()
        .map(|group| (group.pk.clone(), GroupLink {
            name: group.name.clone(),
        })));

    let mut user_memberships: HashMap<UserPkType, RoleSplit<GroupLink>> = Default::default();

    // Helper: resolve a username string from attributes to a pk, update memberships,
    // remove from the plain-members set, and return the UserLink.
    macro_rules! resolve_named_role {
        ($group_pk:expr, $username_val:expr, $role_idx:expr, $members:expr) => {{
            let username: &str = $username_val;
            if let Some(&pk) = username_to_pk.get(username) {
                if !user_memberships.contains_key(&pk) {
                    user_memberships.insert(pk, RoleSplit::default());
                }
                user_memberships
                    .get_mut(&pk)
                    .unwrap()
                    .0.as_mut_array()
                    .get_mut($role_idx)
                    .expect("Something gone wrong with `enum_map` crate")
                    .push(group_links.get($group_pk).unwrap().clone());
                $members.remove(&pk);
                user_links.get(&pk).cloned()
            } else {
                None
            }
        }};
    }

    let groups = authentik_groups.iter()
        .map(|group| {
            let mut members: HashSet<i64> = group.users.iter().cloned().collect();

            let ga = GroupAttributes::from_raw(group.attributes.clone()).unwrap_or_default();
            let fs = ga.forest_school.as_ref();
            let leaders = fs
                .map(|f| {
                    f.leaders.iter()
                        .filter_map(|username| {
                            resolve_named_role!(&group.pk, username, GroupRole::Leader.into_usize(), members)
                        })
                        .collect_vec()
                })
                .unwrap_or_default();
            let managers = fs
                .map(|f| {
                    f.manager.iter()
                        .filter_map(|username| {
                            resolve_named_role!(&group.pk, username, GroupRole::Manager.into_usize(), members)
                        })
                        .collect_vec()
                })
                .unwrap_or_default();
            let members = members.iter()
                .filter_map(|pk| {
                    if !user_memberships.contains_key(pk) {
                        user_memberships.insert(*pk, RoleSplit::default());
                    }
                    user_memberships
                        .get_mut(pk)
                        .unwrap()
                        .0.as_mut_array()
                        .get_mut(GroupRole::Member.into_usize())
                        .expect("Something gone wrong with `enum_map` crate")
                        .push(
                            group_links
                                .get(&group.pk)
                                .unwrap()
                                .clone()
                        );
                    user_links.get(pk)
                })
                .cloned()
                .collect_vec()
                ;

            let children: Vec<GroupLink> = authentik_groups
                .iter()
                .filter(|g| !is_authentik_group(g) && g.parents.contains(&group.pk))
                .map(|g| GroupLink {
                    name: g.name.clone(),
                })
                .collect();

            let parents: Vec<GroupLink> = group.parents.iter()
                .filter_map(|p| group_links.get(p))
                .cloned()
                .collect_vec();


            let color = fs.and_then(|f| f.color.clone());
            let google_sync = fs
                .and_then(|f| f.google_sync.as_ref())
                .map(|gs| GoogleSyncConfig {
                    recursive_name: gs.recursive_name.clone(),
                    direct_name: gs.direct_name.clone(),
                });

            Group {
                pk: group.pk.clone(),
                attrs: ga,
                parent_pks: group.parents.clone(),
                name: group.name.clone(),
                members: {
                    let mut rs = RoleSplit::default();
                    let mut leaders = leaders;
                    let mut managers = managers;
                    let mut members = members;
                    rs
                        .0.as_mut_array()
                        .get_mut(GroupRole::Leader.into_usize())
                        .expect("Something gone wrong with `enum_map` crate")
                        .append(&mut leaders);
                    rs
                        .0.as_mut_array()
                        .get_mut(GroupRole::Manager.into_usize())
                        .expect("Something gone wrong with `enum_map` crate")
                        .append(&mut managers);
                    rs
                        .0.as_mut_array()
                        .get_mut(GroupRole::Member.into_usize())
                        .expect("Something gone wrong with `enum_map` crate")
                        .append(&mut members);
                    rs
                },
                children,
                parents,
                color,
                google_sync,
            }
        })
        .collect_vec();

    let users = authentik_users.iter()
        .map(|user| {
            let ua = UserAttributes::from_raw(user.attributes.clone()).unwrap_or_default();
            let fs = ua.forest_school.as_ref();

            let logins = fs
                .map(|f| f.logins.iter().map(|l| crate::routes::api_models::LoginAccount {
                    kind: l.kind.clone(),
                    address: l.address.clone(),
                }).collect_vec())
                .unwrap_or_default();

            let attributes = fs
                .map(|f| {
                    let mut pairs: Vec<(String, String)> = f.user_defined.iter()
                        .map(|(k, v)| (k.clone(), v.clone()))
                        .collect();
                    pairs.sort_by(|a, b| a.0.cmp(&b.0));
                    pairs
                })
                .unwrap_or_default();

            let groups = user_memberships.remove(&user.pk).unwrap_or_default();

            User {
                pk: user.pk,
                attrs: ua,
                username: user.username.clone(),
                name: user.name.clone(),
                is_active: user.is_active,
                is_superuser: user.is_superuser,
                logins,
                groups,
                attributes,
            }
        })
        .collect_vec();

    let group_users = groups.iter()
        .map(|g| {
            let mut m = HashMap::new();
            for (role, userlinks) in g.members.0.iter() {
                for link in userlinks.iter() {
                    m.insert(link.username.clone(), role.clone());
                }
            }
            m
        })
        .collect_vec();

    Ok(AuthentikState {
        groups,
        users,
        user_id_to_user_ptr,
        group_id_to_group_ptr,
        group_users,
    })
}

///
/// Contract:
/// for <group> it's useful representation is located at index `idx` in `<groups>`
/// in `pk_to_<group>_ptr` there is a link from actual `pk` to `<Group>Ptr` holding same `idx`
#[derive(Default)]
struct AuthentikState {
    groups: Vec<Group>,
    group_users: Vec<HashMap<UserIdType, GroupRole>>,
    users: Vec<User>,
    user_id_to_user_ptr: HashMap<UserIdType, usize>,
    group_id_to_group_ptr: HashMap<GroupIdType, usize>,
}

impl AuthentikState {
    fn group_id_to_group(&self, id: &GroupIdType) -> Result<&Group, AppError> {
        let idx = self.group_id_to_group_ptr.get(id)
            .ok_or_else(|| AppError::NotFound(format!("Group `{}` not found", id)))?;
        Ok(&self.groups[*idx])
    }
    fn user_id_to_user(&self, id: &UserIdType) -> Result<&User, AppError> {
        let idx = self.user_id_to_user_ptr.get(id)
            .ok_or_else(|| AppError::NotFound(format!("User `{}` not found", id)))?;
        Ok(&self.users[*idx])
    }
}

type UserPkType = i64;
type GroupPkType = String;
pub type UserIdType = String;
pub type GroupIdType = String;
