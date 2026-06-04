use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// GroupRole
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroupRole {
    Leader,
    Manager,
    Member,
}

// ---------------------------------------------------------------------------
// GroupMembership — compact entry on a user's profile
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMembership {
    pub group_pk: String,
    pub group_name: String,
    pub role: GroupRole,
}

// ---------------------------------------------------------------------------
// User — full profile response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub pk: i64,
    pub uuid: String,
    pub username: String,
    pub name: String,
    pub email: String,
    pub is_active: bool,
    pub telegram: Option<String>,
    pub groups: Vec<GroupMembership>,
}

// ---------------------------------------------------------------------------
// GroupSummary — lightweight entry for the DAG list
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupSummary {
    pub pk: String,
    pub name: String,
    pub is_superuser: bool,
    pub parent_pks: Vec<String>,
    pub leader_uuid: Option<String>,
    pub manager_uuids: Vec<String>,
    pub member_count: usize,
}

// ---------------------------------------------------------------------------
// GroupMember — a single member inside a group detail response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupMember {
    pub pk: i64,
    pub uuid: String,
    pub username: String,
    pub name: String,
    pub email: String,
    pub is_active: bool,
    pub telegram: Option<String>,
}

// ---------------------------------------------------------------------------
// GroupDetail — full group detail response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GroupDetail {
    pub pk: String,
    pub name: String,
    pub is_superuser: bool,
    pub parent_pks: Vec<String>,
    pub leader: Option<GroupMember>,
    pub managers: Vec<GroupMember>,
    pub members: Vec<GroupMember>,
}

// ---------------------------------------------------------------------------
// MutationSuccess — generic "ok" response
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MutationSuccess {
    pub ok: bool,
}

impl MutationSuccess {
    pub fn ok() -> Self {
        Self { ok: true }
    }
}
