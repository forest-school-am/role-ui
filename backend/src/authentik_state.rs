use std::collections::{HashMap, HashSet};
use std::marker::PhantomData;
use std::ops::{Index, IndexMut};
use std::sync::{LockResult, RwLock, RwLockReadGuard};
use std::time::{Duration, Instant, SystemTime};
use anyhow::anyhow;
use enum_map::{enum_map, Enum, EnumMap};
use itertools::Itertools;
use regex::Regex;
use crate::AppState;
use crate::routes::api_models::{Group, GroupLink, GroupRole, RoleSplit, User, UserLink};
use crate::authentik::{get_forest_school_custom_attributes, resolve_role, AuthentikClient, AuthentikGroup, AuthentikUser};
use crate::error::AppError;

fn is_authentik_group(group: &AuthentikGroup) -> bool {
    group.name.starts_with("authentik") || group.is_superuser
}

pub struct AuthentikStateWrapper {
    state: RwLock<AuthentikStateCache>,
}

struct AuthentikStateCache {
    state: AuthentikState,
    dirty: bool,
    last_update: Instant,
}

impl AuthentikStateWrapper {
    pub fn new() -> Self {
        Self {
            state: RwLock::new(AuthentikStateCache {
                state: Default::default(),
                dirty: true,
                last_update: Instant::now(),
            }),
        }
    }

    pub async fn update(&self, authentik_client: &AuthentikClient) -> Result<(), AppError> {
        let new_state = update_authentik_state(authentik_client).await?;
        let mut lock = self.state.write().unwrap();
        lock.state = new_state;
        lock.dirty = false;
        lock.last_update = Instant::now();
        Ok(())
    }

    pub fn user_by_username(&self, username: &String) -> Result<User, AppError> {
        self.state.read().unwrap().state.user_id_to_user(username).cloned()
    }

    pub fn search_users_to_links(&self, re: &Regex) -> Vec<UserLink> {
        self.state.read().unwrap().state.users.iter()
            .filter(|u| u.matches(re))
            .map(|u| UserLink::from(u))
            .collect_vec()
    }

    pub fn list_groups(&self) -> Vec<Group> {
        self.state.read().unwrap().state.groups.clone()
    }

    pub fn get_group_by_name(&self, groupname: &String) -> Result<Group, AppError> {
        self.state.read().unwrap().state.group_id_to_group(groupname).cloned()
    }

    pub fn user_group_role_relation(&self, groupname: &GroupIdType, username: &UserIdType) -> Result<Option<GroupRole>, AppError> {
        let lock = self.state.read().unwrap();
        let ptr = lock.state.group_id_to_group_ptr.get(groupname).ok_or(AppError::NotFound(format!("Group `{}` not found", groupname)))?;
        let map = lock.state.group_users
            .get(
                ptr.idx
            ).ok_or(
            AppError::Internal(anyhow!("State invariant failed: group_user mapping not found for group `{}` at idx `{}`", groupname, ptr.idx).into()))?;
        Ok(map.get(username).cloned())
    }

    pub fn username_to_pk(&self, username: &UserIdType) -> Result<UserPkType, AppError> {
        let lock = self.state.read().unwrap();
        let ptr = lock.state.user_id_to_user_ptr.get(username).ok_or(AppError::NotFound(format!("User `{}` not found", username)))?;
        Ok(lock.state.compat_users.get(ptr.idx).ok_or(
            AppError::Internal(anyhow!("State invariant failed: compat_user for username `{}` at idx `{}`", username, ptr.idx).into())
        )?.pk)
    }

    pub fn groupname_to_pk(&self, groupname: &GroupIdType) -> Result<GroupPkType, AppError> {
        let lock = self.state.read().unwrap();
        let ptr = lock.state.group_id_to_group_ptr.get(groupname).ok_or(AppError::NotFound(format!("User `{}` not found", groupname)))?;
        Ok(lock.state.compat_groups.get(ptr.idx).ok_or(
            AppError::Internal(anyhow!("State invariant failed: compat_user for username `{}` at idx `{}`", groupname, ptr.idx).into())
        )?.pk.clone())
    }

    pub fn user_by_pk(&self, pk: UserPkType) -> Result<User, AppError> {
        let lock = self.state.read().unwrap();
        let ptr = lock.state.pk_to_user_ptr.get(&pk).copied()
            .ok_or(AppError::NotFound(format!("User with pk `{}` not found", pk)))?;
        Ok(lock.state.index(ptr.frontend()).clone())
    }

    pub fn get_compat_group_by_name(&self, groupname: &GroupIdType) -> Result<AuthentikGroup, AppError> {
        let lock = self.state.read().unwrap();
        Ok(lock.state.group_id_to_authentik_group(groupname)?.clone())
    }
}

async fn update_authentik_state(authentik_client: &AuthentikClient) -> Result<AuthentikState, AppError> {
    let authentik_users = authentik_client.get_all_real_users().await?;
    let authentik_groups = authentik_client.get_groups_all().await?
        .into_iter()
        .filter(|g| !is_authentik_group(g))
        .collect_vec();

    let pk_to_user_ptr = HashMap::from_iter(authentik_users.iter()
        .enumerate()
        .map(|(idx, user)| (user.pk, UserPtr { idx })));
    let pk_to_group_ptr = HashMap::from_iter(authentik_groups.iter()
        .enumerate()
        .map(|(idx, group)| (group.pk.clone(), GroupPtr { idx })));

    let user_id_to_user_ptr = HashMap::from_iter(authentik_users.iter()
        .enumerate()
        .map(|(idx, user)| (user.username.clone(), UserPtr { idx })));
    let group_id_to_group_ptr = HashMap::from_iter(authentik_groups.iter()
        .enumerate()
        .map(|(idx, group)| (group.name.clone(), GroupPtr { idx })));


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

            let leaders = get_forest_school_custom_attributes(group.attributes.as_ref())
                .and_then(|a| a.get("leaders"))
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|entry| entry.as_str())
                        .filter_map(|username| {
                            resolve_named_role!(&group.pk, username, GroupRole::Leader.into_usize(), members)
                        })
                        .collect_vec()
                })
                .unwrap_or_default();
            let managers = get_forest_school_custom_attributes(group.attributes.as_ref())
                .and_then(|a| a.get("manager"))
                .and_then(|v| v.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|entry| entry.as_str())
                        .filter_map(|username| {
                            resolve_named_role!(&group.pk, username, GroupRole::Manager.into_usize(), members)
                        })
                        .collect_vec()
                })
                .unwrap_or_default();
            let members = members.iter()
                .filter_map(|pk| {
                    if !user_memberships.contains_key(pk) {
                        user_memberships.insert(pk.clone(), RoleSplit::default());
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


            let color = get_forest_school_custom_attributes(group.attributes.as_ref())
                .and_then(|a| a.get("color"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            Group {
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
            }
        })
        .collect_vec();

    let users = authentik_users.iter()
        .map(|user| {
            let attributes = get_forest_school_custom_attributes(user.attributes.as_ref())
                .and_then(|a| a.get("custom"))
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr
                        .iter()
                        .filter_map(|item| {
                            item
                                .as_array()
                                .map(|arr| {
                                    arr
                                        .iter()
                                        .filter_map(|kv| Some(kv.as_str()?.to_string()))
                                        .collect_array::<2>()
                                })
                                .flatten()
                        })
                        .map_into()
                        .collect_vec()
                }).unwrap_or(vec![]);

            let groups = user_memberships.remove(&user.pk).unwrap_or_default();

            User {
                username: user.username.clone(),
                name: user.name.clone(),
                is_active: user.is_active,
                logins: vec![],
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
        pk_to_user_ptr,
        pk_to_group_ptr,
        user_id_to_user_ptr,
        group_id_to_group_ptr,
        group_users,
        compat_groups: authentik_groups,
        compat_users: authentik_users,
    })
}

///
/// Contract:
/// for <group> it's useful representation is located at index `idx` in `<groups>`
/// in `pk_to_<group>_ptr` there is a link from actual `pk` to `<Group>Ptr` holding same `idx`
/// in `group_id_to_<group>_ptr` there is a link from <group> id type (currently string) to `<Group>Ptr>` holding same `idx`
/// in `compat_<group>` the original authentik representation is stored at the same index
///
#[derive(Default)]
struct AuthentikState {
    groups: Vec<Group>,
    group_users: Vec<HashMap<UserIdType, GroupRole>>,
    users: Vec<User>,

    pk_to_user_ptr: HashMap<UserPkType, UserPtr>,
    pk_to_group_ptr: HashMap<GroupPkType, GroupPtr>,
    user_id_to_user_ptr: HashMap<UserIdType, UserPtr>,
    group_id_to_group_ptr: HashMap<GroupIdType, GroupPtr>,
    compat_groups: Vec<AuthentikGroup>,
    compat_users: Vec<AuthentikUser>,
}

/// Util
impl AuthentikState {
    fn pk_to_group(&self, pk: &GroupPkType) -> Result<&Group, AppError> {
        Ok(self.index(self.pk_to_group_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by pk: `{}`", pk)))?.frontend()))
    }
    fn pk_to_authentik_group(&self, pk: &GroupPkType) -> Result<&AuthentikGroup, AppError> {
        Ok(self.index(self.pk_to_group_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by pk: `{}`", pk)))?.authentik()))
    }
    fn pk_to_user(&self, pk: &UserPkType) -> Result<&User, AppError> {
        Ok(self.index(self.pk_to_user_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find user by pk: `{}`", pk)))?.frontend()))
    }
    fn pk_to_authentik_user(&self, pk: &UserPkType) -> Result<&AuthentikUser, AppError> {
        Ok(self.index(self.pk_to_user_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find user by pk: `{}`", pk)))?.authentik()))
    }

    fn group_id_to_group(&self, pk: &GroupIdType) -> Result<&Group, AppError> {
        Ok(self.index(self.group_id_to_group_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by group_id: `{}`", pk)))?.frontend()))
    }
    fn group_id_to_authentik_group(&self, pk: &GroupIdType) -> Result<&AuthentikGroup, AppError> {
        Ok(self.index(self.group_id_to_group_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by group_id: `{}`", pk)))?.authentik()))
    }
    fn user_id_to_user(&self, pk: &UserIdType) -> Result<&User, AppError> {
        Ok(self.index(self.user_id_to_user_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by user_id: `{}`", pk)))?.frontend()))
    }
    fn user_id_to_authentik_user(&self, pk: &UserIdType) -> Result<&AuthentikUser, AppError> {
        Ok(self.index(self.user_id_to_user_ptr.get(pk).ok_or(AppError::NotFound(format!("Could not find group by user_id: `{}`", pk)))?.authentik()))
    }
}

type UserPkType = i64;
type GroupPkType = String;
pub type UserIdType = String;
pub type GroupIdType = String;

trait CompatType {}
struct Authentik {}
struct Frontend {}
impl CompatType for Authentik {}
impl CompatType for Frontend {}

trait IndexType {}

struct TypedGroupPtr<T: CompatType> {
    _p: PhantomData<T>
}
struct TypedUserPtr<T: CompatType> {
    _p: PhantomData<T>
}
impl<T: CompatType> IndexType for TypedGroupPtr<T> {}
impl<T: CompatType> IndexType for TypedUserPtr<T> {}

struct TypedPtr<T: IndexType> {
    idx: usize,
    _p: PhantomData<T>
}

#[derive(Copy, Clone)]
struct UserPtr {
    idx: usize,
}
#[derive(Copy, Clone)]
struct GroupPtr {
    idx: usize,
}
impl UserPtr {
    fn authentik(self) -> TypedPtr<TypedUserPtr<Authentik>> {
        TypedPtr {
            idx: self.idx,
            _p: PhantomData::default(),
        }
    }
    fn frontend(self) -> TypedPtr<TypedUserPtr<Frontend>> {
        TypedPtr {
            idx: self.idx,
            _p: PhantomData::default(),
        }
    }
}
impl GroupPtr {
    fn authentik(self) -> TypedPtr<TypedGroupPtr<Authentik>> {
        TypedPtr {
            idx: self.idx,
            _p: PhantomData::default(),
        }
    }
    fn frontend(self) -> TypedPtr<TypedGroupPtr<Frontend>> {
        TypedPtr {
            idx: self.idx,
            _p: PhantomData::default(),
        }
    }
}

impl Index<TypedPtr<TypedGroupPtr<Frontend>>> for AuthentikState {
    type Output = Group;

    fn index(&self, index: TypedPtr<TypedGroupPtr<Frontend>>) -> &Self::Output {
        self.groups.index(index.idx)
    }
}

impl IndexMut<TypedPtr<TypedGroupPtr<Frontend>>> for AuthentikState {
    fn index_mut(&mut self, index: TypedPtr<TypedGroupPtr<Frontend>>) -> &mut <Self as Index<TypedPtr<TypedGroupPtr<Frontend>>>>::Output {
        self.groups.index_mut(index.idx)
    }
}

impl Index<TypedPtr<TypedUserPtr<Frontend>>> for AuthentikState {
    type Output = User;

    fn index(&self, index: TypedPtr<TypedUserPtr<Frontend>>) -> &Self::Output {
        self.users.index(index.idx)
    }
}

impl IndexMut<TypedPtr<TypedUserPtr<Frontend>>> for AuthentikState {
    fn index_mut(&mut self, index: TypedPtr<TypedUserPtr<Frontend>>) -> &mut <Self as Index<TypedPtr<TypedUserPtr<Frontend>>>>::Output {
        self.users.index_mut(index.idx)
    }
}

impl Index<TypedPtr<TypedGroupPtr<Authentik>>> for AuthentikState {
    type Output = AuthentikGroup;

    fn index(&self, index: TypedPtr<TypedGroupPtr<Authentik>>) -> &Self::Output {
        self.compat_groups.index(index.idx)
    }
}

impl IndexMut<TypedPtr<TypedGroupPtr<Authentik>>> for AuthentikState {
    fn index_mut(&mut self, index: TypedPtr<TypedGroupPtr<Authentik>>) -> &mut <Self as Index<TypedPtr<TypedGroupPtr<Authentik>>>>::Output {
        self.compat_groups.index_mut(index.idx)
    }
}

impl Index<TypedPtr<TypedUserPtr<Authentik>>> for AuthentikState {
    type Output = AuthentikUser;

    fn index(&self, index: TypedPtr<TypedUserPtr<Authentik>>) -> &Self::Output {
        self.compat_users.index(index.idx)
    }
}

impl IndexMut<TypedPtr<TypedUserPtr<Authentik>>> for AuthentikState {
    fn index_mut(&mut self, index: TypedPtr<TypedUserPtr<Authentik>>) -> &mut <Self as Index<TypedPtr<TypedUserPtr<Authentik>>>>::Output {
        self.compat_users.index_mut(index.idx)
    }
}