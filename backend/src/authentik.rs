use std::collections::HashMap;
use authentik_api::apis::configuration::Configuration;
use authentik_api::apis::core_api;
use authentik_api::models;
use serde_json::Value;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Wrapper types — stable interface over the generated API models
// ---------------------------------------------------------------------------

#[derive(Clone)]
pub struct AuthentikUser {
    pub pk: i64,
    pub username: String,
    pub name: String,
    pub is_active: bool,
    pub is_superuser: bool,
    pub attributes: Option<HashMap<String, Value>>,
}

#[derive(Clone)]
pub struct AuthentikGroup {
    pub pk: String,          // UUID as lowercase string
    pub name: String,
    pub parents: Vec<String>, // parent UUID strings
    pub users: Vec<i64>,
    pub attributes: Option<HashMap<String, Value>>,
    pub is_superuser: bool,
}

impl AuthentikUser {
    fn from_api(u: models::User) -> Self {
        Self {
            pk: u.pk as i64,
            username: u.username,
            name: u.name,
            is_active: u.is_active.unwrap_or(true),
            is_superuser: u.is_superuser,
            attributes: u.attributes,
        }
    }
}

impl AuthentikGroup {
    fn from_api(g: models::Group) -> Self {
        Self {
            pk: g.pk.to_string(),
            name: g.name,
            parents: g.parents
                .unwrap_or_default()
                .iter()
                .map(|u| u.to_string())
                .collect(),
            users: g.users
                .unwrap_or_default()
                .iter()
                .map(|&pk| pk as i64)
                .collect(),
            attributes: g.attributes,
            is_superuser: g.is_superuser.unwrap_or(false),
        }
    }
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

pub struct AuthentikClient {
    config: Configuration,
}

fn map_api_err<E: std::fmt::Display>(e: E) -> AppError {
    let msg = e.to_string();
    tracing::error!("authentik API error: {msg}");
    AppError::AuthentikError(msg)
}

impl AuthentikClient {
    pub fn new(base_url: String, api_token: String) -> Self {
        let base_url = base_url.trim_end_matches('/');
        Self {
            config: Configuration {
                base_path: format!("{}/api/v3", base_url),
                bearer_access_token: Some(api_token),
                ..Default::default()
            },
        }
    }

    // Validates the caller's OIDC bearer token via the userinfo endpoint and
    // returns the validated user's preferred_username.
    pub async fn validate_user_token(&self, token: &str) -> Result<String, AppError> {
        // Strip the /api/v3 suffix from base_path to get the authentik root URL.
        let base = self.config.base_path.trim_end_matches("/api/v3");
        let url = format!("{}/application/o/userinfo/", base);

        let resp = reqwest::Client::new()
            .get(&url)
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("userinfo request failed: {e}");
                AppError::Unauthorized
            })?;

        if !resp.status().is_success() {
            tracing::warn!("userinfo endpoint rejected token: HTTP {}", resp.status());
            return Err(AppError::Unauthorized);
        }

        let claims: serde_json::Value = resp.json().await.map_err(|e| {
            tracing::warn!("userinfo response not JSON: {e}");
            AppError::Unauthorized
        })?;

        if let Some(username) = claims.get("preferred_username").and_then(|v| v.as_str()) {
            return Ok(username.to_string());
        }

        // Tokens issued before the profile scope was added only contain `sub`
        // (the user UUID).  Fall back to looking up the username via the admin API.
        let sub = claims
            .get("sub")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                tracing::warn!("userinfo has neither preferred_username nor sub; claims: {claims}");
                AppError::Unauthorized
            })?;

        tracing::debug!("no preferred_username in userinfo; resolving username for sub={sub}");
        let lookup_url = format!("{}/api/v3/core/users/?uuid={sub}&page_size=1", base);
        let lookup_resp = reqwest::Client::new()
            .get(&lookup_url)
            .bearer_auth(self.config.bearer_access_token.clone().unwrap_or_default())
            .send()
            .await
            .map_err(|e| {
                tracing::warn!("UUID lookup request failed: {e}");
                AppError::Unauthorized
            })?;

        if !lookup_resp.status().is_success() {
            tracing::warn!("UUID lookup returned HTTP {}", lookup_resp.status());
            return Err(AppError::Unauthorized);
        }

        let body: serde_json::Value = lookup_resp.json().await.map_err(|_| AppError::Unauthorized)?;
        body.get("results")
            .and_then(|r| r.get(0))
            .and_then(|u| u.get("username"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| {
                tracing::warn!("UUID lookup found no user for sub={sub}");
                AppError::Unauthorized
            })
    }

    pub async fn get_all_real_users(&self) -> Result<Vec<AuthentikUser>, AppError> {
        let mut all = Vec::new();
        let mut page = 1i32;
        loop {
            let result = core_api::core_users_list(
                &self.config,
                None, None, None, None, None, // attributes, date_joined, date_joined__gt, date_joined__lt, email
                None, None,                   // groups_by_name, groups_by_pk
                None, None,                   // include_groups, include_roles
                None, None,                   // is_active, is_superuser
                None, None, None, None,       // last_login, last_login__gt, last_login__isnull, last_login__lt
                None, None, None,             // last_updated, last_updated__gt, last_updated__lt
                None,                         // name
                None, Some(page), Some(500),  // ordering, page, page_size
                None, None,                   // path, path_startswith
                None, None,                   // roles_by_name, roles_by_pk
                None,                         // search
                Some(vec![
                    models::UserTypeEnum::Internal,
                    models::UserTypeEnum::External,
                ]),
                None, None,                   // username, uuid
            )
            .await
            .map_err(map_api_err)?;

            all.extend(result.results.into_iter().map(AuthentikUser::from_api));
            if result.pagination.current >= result.pagination.total_pages {
                break;
            }
            page += 1;
        }
        Ok(all)
    }

    pub async fn get_groups_all(&self) -> Result<Vec<AuthentikGroup>, AppError> {
        let mut all = Vec::new();
        let mut page = 1i32;
        loop {
            let result = core_api::core_groups_list(
                &self.config,
                None,        // attributes
                None,        // include_children
                None,        // include_inherited_roles
                Some(true),  // include_parents — needed to populate the parents field
                Some(false), // include_users — keep response compact; users is still a list of PKs
                None,        // is_superuser
                None, None,  // members_by_pk, members_by_username
                None,        // name
                None, Some(page), Some(500), // ordering, page, page_size
                None,        // search
            )
            .await
            .map_err(map_api_err)?;

            all.extend(result.results.into_iter().map(AuthentikGroup::from_api));
            if result.pagination.current >= result.pagination.total_pages {
                break;
            }
            page += 1;
        }
        Ok(all)
    }

    pub async fn add_user_to_group(&self, group_pk: &str, user_pk: i64) -> Result<(), AppError> {
        core_api::core_groups_add_user_create(
            &self.config,
            group_pk,
            models::UserAccountRequest { pk: user_pk as i32 },
        )
        .await
        .map_err(map_api_err)
    }

    pub async fn remove_user_from_group(
        &self,
        group_pk: &str,
        user_pk: i64,
    ) -> Result<(), AppError> {
        core_api::core_groups_remove_user_create(
            &self.config,
            group_pk,
            models::UserAccountRequest { pk: user_pk as i32 },
        )
        .await
        .map_err(map_api_err)
    }

    pub async fn patch_group_attributes(
        &self,
        group_pk: &str,
        attributes: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let req = models::PatchedGroupRequest {
            attributes: Some(attributes),
            ..Default::default()
        };
        core_api::core_groups_partial_update(&self.config, group_pk, Some(req))
            .await
            .map_err(map_api_err)?;
        Ok(())
    }

    pub async fn patch_group_parents(
        &self,
        group_pk: &str,
        parent_pks: Vec<String>,
    ) -> Result<(), AppError> {
        let parents: Vec<uuid::Uuid> = parent_pks
            .iter()
            .filter_map(|s| s.parse().ok())
            .collect();
        let req = models::PatchedGroupRequest {
            parents: Some(parents),
            ..Default::default()
        };
        core_api::core_groups_partial_update(&self.config, group_pk, Some(req))
            .await
            .map_err(map_api_err)?;
        Ok(())
    }

    pub async fn create_group(
        &self,
        name: &str,
        parent_pk: &str,
    ) -> Result<AuthentikGroup, AppError> {
        let parent_uuid: uuid::Uuid = parent_pk
            .parse()
            .map_err(|_| AppError::BadRequest(format!("invalid parent group pk: {}", parent_pk)))?;
        let req = models::GroupRequest {
            name: name.to_string(),
            parents: Some(vec![parent_uuid]),
            ..Default::default()
        };
        let group = core_api::core_groups_create(&self.config, req)
            .await
            .map_err(map_api_err)?;
        Ok(AuthentikGroup::from_api(group))
    }

    pub async fn delete_group(&self, group_pk: &str) -> Result<(), AppError> {
        core_api::core_groups_destroy(&self.config, group_pk)
            .await
            .map_err(map_api_err)
    }

    pub async fn patch_user_attributes(
        &self,
        user_pk: i32,
        attributes: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let req = models::PatchedUserRequest {
            attributes: Some(attributes),
            ..Default::default()
        };
        core_api::core_users_partial_update(&self.config, user_pk, Some(req))
            .await
            .map_err(map_api_err)?;
        Ok(())
    }
}

