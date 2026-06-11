use serde::{Deserialize, Serialize};
use enum_map::{EnumMap,Enum};
use regex::Regex;
use authentik_forest_school_attributes::{GroupAttributes, UserAttributes, UserLogins};
use crate::authentik_state::{GroupPkType, UserPkType};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct User {
    #[serde(skip)]
    pub pk: UserPkType,
    #[serde(skip)]
    pub attrs: UserAttributes,
    pub username: String,
    pub name: String,
    pub is_active: bool,
    pub is_superuser: bool,
    pub name_frozen: bool,
    pub logins: UserLogins,
    pub groups: RoleSplit<GroupLink>,
    pub attributes: Vec<(String, String)>
}

impl User {
    pub fn matches(&self, term: &Regex) -> bool {
        term.is_match(&self.username) ||
            term.is_match(&self.name) ||
            self.logins.google.as_deref().is_some_and(|a| term.is_match(a)) ||
            self.logins.telegram.as_deref().is_some_and(|a| term.is_match(a))
    }
}
impl From<&User> for UserLink {
    fn from(value: &User) -> Self {
        Self {
            username: value.username.clone(),
            name: value.name.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GoogleSyncConfig {
    pub recursive_name: Option<String>,
    pub direct_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Group {
    #[serde(skip)]
    pub pk: GroupPkType,
    #[serde(skip)]
    pub attrs: GroupAttributes,
    #[serde(skip)]
    pub parent_pks: Vec<GroupPkType>,
    pub name: String,
    pub members: RoleSplit<UserLink>,
    pub children: Vec<GroupLink>,
    pub parents: Vec<GroupLink>,
    pub color: Option<String>,
    pub google_sync: Option<GoogleSyncConfig>,
}

impl Group {
    pub fn matches(&self, term: &Regex) -> bool {
        term.is_match(&self.name)
    }
}

impl From<&Group> for GroupLink {
    fn from(value: &Group) -> Self {
        Self {
            name: value.name.clone(),
        }
    }
}

#[derive(Default, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UserLink {
    pub username: String,
    pub name: String,
}

#[derive(Default, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct GroupLink {
    pub name: String,
}

pub trait Link {}
impl Link for UserLink {}
impl Link for GroupLink {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Enum)]
#[serde(rename_all = "snake_case")]
pub enum GroupRole {
    Leader,
    Manager,
    Member,
}

#[derive(Default, Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoleSplit<LinkType: Link>(pub EnumMap<GroupRole, Vec<LinkType>>);


#[cfg(test)]
mod test {
    use enum_map::enum_map;
    use serde_json::{json, from_value};
    use super::*;

    #[test]
    fn test_serialization() {
        let g = Group {
            pk: Default::default(),
            attrs: Default::default(),
            parent_pks: Default::default(),
            name: "G3".to_string(),
            members: RoleSplit(enum_map! {
                GroupRole::Leader => vec![
                    UserLink{
                        username: "test".to_string(),
                        name: "Test Test".to_string(),
                    },
                    UserLink{
                        username: "test2".to_string(),
                        name: "Test Test2".to_string(),
                    },
                ],
                GroupRole::Manager => vec![
                    UserLink{
                        username: "test3".to_string(),
                        name: "Test Test3".to_string(),
                    },
                    UserLink{
                        username: "test4".to_string(),
                        name: "Test Test4".to_string(),
                    },
                ],
                GroupRole::Member => vec![
                    UserLink{
                        username: "test5".to_string(),
                        name: "Test Test5".to_string(),
                    },
                ],
            }),
            children: vec![
                GroupLink{
                    name: "G4".to_string(),
                },
                GroupLink{
                    name: "G5".to_string(),
                },
            ],
            parents: vec![
                GroupLink{
                    name: "G1".to_string(),
                },
                GroupLink{
                    name: "G2".to_string(),
                },
            ],
            color: Some("FF0000".to_string()),
            google_sync: None,
        };
        let g_ser = json!(g);
        println!("{}", g_ser);
        let g_des: Group = from_value(g_ser).unwrap();
        assert_eq!(g_des, g);
    }
}