use crate::error::AppError;
use crate::models::GroupRole;
use anyhow::Context;
use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

// ---------------------------------------------------------------------------
// Raw authentik API structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthentikUser {
    pub pk: i64,
    pub uuid: String,
    pub username: String,
    pub name: String,
    pub email: String,
    pub is_active: bool,
    pub attributes: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthentikGroup {
    pub pk: String,
    pub name: String,
    pub is_superuser: bool,
    /// List of parent group UUIDs (writable field)
    pub parents: Vec<String>,
    /// Integer PKs of direct members
    pub users: Vec<i64>,
    pub attributes: Option<Value>,
}

/// Pagination metadata object nested inside list responses (authentik 2025+).
#[derive(Debug, Deserialize)]
struct Pagination {
    /// Next page number; 0 means no next page.
    pub next: u32,
}

/// Paginated list wrapper returned by authentik list endpoints (2025+ format).
#[derive(Debug, Deserialize)]
struct PaginatedResult<T> {
    pub pagination: Pagination,
    pub results: Vec<T>,
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AuthentikClient {
    pub base_url: String,
    pub api_token: String,
    client: Client,
}

impl AuthentikClient {
    pub fn new(base_url: String, api_token: String) -> Self {
        let client = Client::builder()
            .build()
            .expect("failed to build reqwest client");
        Self {
            base_url,
            api_token,
            client,
        }
    }

    // ------------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------------

    fn api_url(&self, path: &str) -> String {
        format!("{}/api/v3{}", self.base_url.trim_end_matches('/'), path)
    }

    fn auth_header(&self) -> String {
        format!("Bearer {}", self.api_token)
    }

    /// GET a single authentik resource; maps 404 to AppError::NotFound.
    async fn get<T: for<'de> Deserialize<'de>>(
        &self,
        url: &str,
    ) -> Result<T, AppError> {
        let resp = self
            .client
            .get(url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .context("failed to send request to authentik")
            .map_err(AppError::Internal)?;

        if resp.status() == StatusCode::NOT_FOUND {
            return Err(AppError::NotFound(format!("resource not found: {url}")));
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::AuthentikError(format!(
                "authentik returned {status}: {body}"
            )));
        }

        resp.json::<T>()
            .await
            .context("failed to decode authentik response")
            .map_err(AppError::Internal)
    }

    /// GET all pages of a list endpoint, aggregating results.
    async fn get_all_pages<T: for<'de> Deserialize<'de>>(
        &self,
        base_url: &str,
        extra_query: &str,
    ) -> Result<Vec<T>, AppError> {
        let mut results: Vec<T> = Vec::new();
        let mut page = 1u32;
        let page_size = 500u32;

        loop {
            let url = format!("{base_url}?page_size={page_size}&page={page}{extra_query}");
            let resp = self
                .client
                .get(&url)
                .header("Authorization", self.auth_header())
                .send()
                .await
                .context("failed to send paginated request to authentik")
                .map_err(AppError::Internal)?;

            if !resp.status().is_success() {
                let status = resp.status();
                let body = resp.text().await.unwrap_or_default();
                return Err(AppError::AuthentikError(format!(
                    "authentik returned {status}: {body}"
                )));
            }

            let page_data: PaginatedResult<T> = resp
                .json()
                .await
                .context("failed to decode authentik paginated response")
                .map_err(AppError::Internal)?;

            let fetched = page_data.results.len() as u64;
            results.extend(page_data.results);

            // pagination.next is the next page number; 0 means no more pages.
            if page_data.pagination.next == 0 || fetched == 0 {
                break;
            }
            page += 1;
        }

        Ok(results)
    }

    // ------------------------------------------------------------------
    // User methods
    // ------------------------------------------------------------------

    /// Fetch a user by their UUID (string UUID, not integer PK).
    pub async fn get_user_by_uuid(&self, uuid: &str) -> Result<AuthentikUser, AppError> {
        let url = format!(
            "{}/api/v3/core/users/?uuid={uuid}",
            self.base_url.trim_end_matches('/')
        );
        let resp = self
            .client
            .get(&url)
            .header("Authorization", self.auth_header())
            .send()
            .await
            .context("failed to request user by UUID from authentik")
            .map_err(AppError::Internal)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(AppError::AuthentikError(format!(
                "authentik returned {status}: {body}"
            )));
        }

        let page: PaginatedResult<AuthentikUser> = resp
            .json()
            .await
            .context("failed to decode user list response")
            .map_err(AppError::Internal)?;

        page.results
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound(format!("user with UUID {uuid} not found")))
    }

    /// Fetch a user by their integer PK.
    pub async fn get_user_by_pk(&self, pk: i64) -> Result<AuthentikUser, AppError> {
        let url = self.api_url(&format!("/core/users/{pk}/"));
        self.get::<AuthentikUser>(&url).await
    }

    /// Batch-fetch users by a slice of integer PKs.
    /// Authentik supports `?pk__in=1,2,3` filtering.
    pub async fn get_users_by_pks(&self, pks: &[i64]) -> Result<Vec<AuthentikUser>, AppError> {
        if pks.is_empty() {
            return Ok(Vec::new());
        }

        let pk_list = pks
            .iter()
            .map(|pk| pk.to_string())
            .collect::<Vec<_>>()
            .join(",");

        let base = format!(
            "{}/api/v3/core/users/",
            self.base_url.trim_end_matches('/')
        );
        // Use get_all_pages with pk__in as extra query param
        let extra = format!("&pk__in={pk_list}");
        self.get_all_pages::<AuthentikUser>(&base, &extra).await
    }

    // ------------------------------------------------------------------
    // Group methods
    // ------------------------------------------------------------------

    /// Fetch all groups (all pages), with parent information included.
    pub async fn get_groups_all(&self) -> Result<Vec<AuthentikGroup>, AppError> {
        let base = format!(
            "{}/api/v3/core/groups/",
            self.base_url.trim_end_matches('/')
        );
        self.get_all_pages::<AuthentikGroup>(&base, "&include_parents=true")
            .await
    }

    /// Fetch a single group by its UUID pk.
    pub async fn get_group(&self, group_pk: &str) -> Result<AuthentikGroup, AppError> {
        let url = format!(
            "{}/api/v3/core/groups/{group_pk}/?include_parents=true",
            self.base_url.trim_end_matches('/')
        );
        self.get::<AuthentikGroup>(&url).await
    }

    /// PATCH a group with the given JSON body.
    pub async fn patch_group(&self, group_pk: &str, body: serde_json::Value) -> Result<(), AppError> {
        let url = format!(
            "{}/api/v3/core/groups/{group_pk}/",
            self.base_url.trim_end_matches('/')
        );

        let resp = self
            .client
            .patch(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("failed to send PATCH request to authentik")
            .map_err(AppError::Internal)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(AppError::AuthentikError(format!(
                "authentik PATCH returned {status}: {body_text}"
            )));
        }

        Ok(())
    }

    /// POST to create a new group and return the created group object.
    pub async fn create_group(&self, body: serde_json::Value) -> Result<AuthentikGroup, AppError> {
        let url = format!(
            "{}/api/v3/core/groups/",
            self.base_url.trim_end_matches('/')
        );

        let resp = self
            .client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("failed to send POST request to authentik")
            .map_err(AppError::Internal)?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(AppError::AuthentikError(format!(
                "authentik POST returned {status}: {body_text}"
            )));
        }

        resp.json::<AuthentikGroup>()
            .await
            .context("failed to decode created group response")
            .map_err(AppError::Internal)
    }

    /// Fetch groups filtered to those where a user is a direct member.
    pub async fn get_groups_for_user(&self, user_pk: i64) -> Result<Vec<AuthentikGroup>, AppError> {
        let base = format!(
            "{}/api/v3/core/groups/",
            self.base_url.trim_end_matches('/')
        );
        let extra = format!("&members_direct={user_pk}&include_parents=true");
        self.get_all_pages::<AuthentikGroup>(&base, &extra).await
    }

    /// Add a user to a group via authentik's dedicated endpoint.
    pub async fn add_user_to_group(&self, group_pk: &str, user_pk: i64) -> Result<(), AppError> {
        let url = format!(
            "{}/api/v3/core/groups/{group_pk}/add_user/",
            self.base_url.trim_end_matches('/')
        );

        let body = serde_json::json!({ "pk": user_pk });

        let resp = self
            .client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("failed to send add_user request to authentik")
            .map_err(AppError::Internal)?;

        if resp.status() == StatusCode::NO_CONTENT || resp.status().is_success() {
            return Ok(());
        }

        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        Err(AppError::AuthentikError(format!(
            "authentik add_user returned {status}: {body_text}"
        )))
    }

    /// Validate a user-supplied bearer token via the userinfo endpoint.
    /// Returns the user's UUID (sub claim) on success.
    pub async fn validate_user_token(&self, token: &str) -> Result<String, AppError> {
        let url = format!(
            "{}/application/o/userinfo/",
            self.base_url.trim_end_matches('/')
        );

        let resp = self
            .client
            .get(&url)
            .header("Authorization", format!("Bearer {token}"))
            .send()
            .await
            .map_err(|e| AppError::AuthentikError(format!("userinfo request failed: {e}")))?;

        if resp.status() == StatusCode::UNAUTHORIZED || resp.status() == StatusCode::FORBIDDEN {
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!("userinfo rejected token: {body}");
            return Err(AppError::Unauthorized);
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            tracing::warn!("userinfo error {status}: {body}");
            return Err(AppError::AuthentikError(format!(
                "userinfo returned {status}: {body}"
            )));
        }

        #[derive(Deserialize)]
        struct UserinfoResponse {
            sub: String,
        }

        let info = resp
            .json::<UserinfoResponse>()
            .await
            .map_err(|e| AppError::AuthentikError(format!("failed to decode userinfo: {e}")))?;

        Ok(info.sub)
    }

    /// Remove a user from a group via authentik's dedicated endpoint.
    pub async fn remove_user_from_group(&self, group_pk: &str, user_pk: i64) -> Result<(), AppError> {
        let url = format!(
            "{}/api/v3/core/groups/{group_pk}/remove_user/",
            self.base_url.trim_end_matches('/')
        );

        let body = serde_json::json!({ "pk": user_pk });

        let resp = self
            .client
            .post(&url)
            .header("Authorization", self.auth_header())
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .context("failed to send remove_user request to authentik")
            .map_err(AppError::Internal)?;

        if resp.status() == StatusCode::NO_CONTENT || resp.status().is_success() {
            return Ok(());
        }

        let status = resp.status();
        let body_text = resp.text().await.unwrap_or_default();
        Err(AppError::AuthentikError(format!(
            "authentik remove_user returned {status}: {body_text}"
        )))
    }
}

// ---------------------------------------------------------------------------
// Role resolution helpers
// ---------------------------------------------------------------------------

/// Resolve a user's role in a group based on the group's attributes.
pub fn resolve_role(group: &AuthentikGroup, user_uuid: &str, _user_pk: i64) -> GroupRole {
    let attrs = group
        .attributes
        .as_ref()
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));

    let leader_uuid: Option<&str> = attrs.get("leader").and_then(|v| v.as_str());

    let manager_uuids: Vec<&str> = attrs
        .get("managers")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str()).collect())
        .unwrap_or_default();

    if leader_uuid == Some(user_uuid) {
        return GroupRole::Leader;
    }

    if manager_uuids.contains(&user_uuid) {
        return GroupRole::Manager;
    }

    GroupRole::Member
}

/// Returns true if the user is a Leader in any direct parent of `group`.
/// Only one level of inheritance (design doc §6.8).
pub fn is_leader_of_any_parent(
    group: &AuthentikGroup,
    all_groups: &[AuthentikGroup],
    user_uuid: &str,
    user_pk: i64,
) -> bool {
    for parent_pk in &group.parents {
        if let Some(parent) = all_groups.iter().find(|g| &g.pk == parent_pk) {
            if resolve_role(parent, user_uuid, user_pk) == GroupRole::Leader {
                return true;
            }
        }
    }
    false
}
