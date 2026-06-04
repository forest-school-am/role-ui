use axum::{
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{auth::AuthenticatedUser, error::AppError, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/search", get(search))
        .route("/api/search-link-gen", get(search_link_gen))
}

// ---------------------------------------------------------------------------
// Query param structs
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct SearchQuery {
    q: Option<String>,
    types: Option<String>,
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/// GET /api/search?q=term&types=user,group
/// Returns a mixed array of user and group results annotated with __search_type.
async fn search(
    State(state): State<AppState>,
    _caller: AuthenticatedUser,
    Query(params): Query<SearchQuery>,
) -> Result<Json<Vec<Value>>, AppError> {
    let q = match params.q.as_deref() {
        Some(t) if !t.trim().is_empty() => t.trim().to_string(),
        _ => {
            return Err(AppError::BadRequest(
                "query parameter 'q' is required and must be non-empty".to_string(),
            ))
        }
    };

    // Parse requested types; default to both.
    let types_str = params.types.as_deref().unwrap_or("user,group");
    let want_users = types_str.split(',').any(|t| t.trim() == "user");
    let want_groups = types_str.split(',').any(|t| t.trim() == "group");

    let mut results: Vec<Value> = Vec::new();

    match (want_users, want_groups) {
        (true, true) => {
            let (users, groups) = tokio::try_join!(
                state.authentik.search_users(&q, 20),
                state.authentik.get_groups_all(),
            )?;

            for u in users {
                results.push(json!({
                    "__search_type": "user",
                    "pk": u.pk,
                    "uuid": u.uuid,
                    "username": u.username,
                    "name": u.name,
                }));
            }

            let q_lower = q.to_lowercase();
            for g in groups {
                if g.is_superuser {
                    continue;
                }
                if g.name.to_lowercase().contains(&q_lower) {
                    results.push(json!({
                        "__search_type": "group",
                        "pk": g.pk,
                        "name": g.name,
                        "is_superuser": g.is_superuser,
                    }));
                }
            }
        }
        (true, false) => {
            let users = state.authentik.search_users(&q, 20).await?;
            for u in users {
                results.push(json!({
                    "__search_type": "user",
                    "pk": u.pk,
                    "uuid": u.uuid,
                    "username": u.username,
                    "name": u.name,
                }));
            }
        }
        (false, true) => {
            let groups = state.authentik.get_groups_all().await?;
            let q_lower = q.to_lowercase();
            for g in groups {
                if g.is_superuser {
                    continue;
                }
                if g.name.to_lowercase().contains(&q_lower) {
                    results.push(json!({
                        "__search_type": "group",
                        "pk": g.pk,
                        "name": g.name,
                        "is_superuser": g.is_superuser,
                    }));
                }
            }
        }
        (false, false) => {
            // No recognized types requested — return empty.
        }
    }

    Ok(Json(results))
}

// ---------------------------------------------------------------------------
// JS snippet endpoint
// ---------------------------------------------------------------------------

const SEARCH_LINK_GEN_JS: &str = r#"function generateSearchLink(obj) {
  switch (obj.__search_type) {
    case 'user':
      return '/users/' + encodeURIComponent(obj.username);
    case 'group':
      return '/groups/' + encodeURIComponent(obj.name);
    default:
      return '#';
  }
}"#;

/// GET /api/search-link-gen
/// Returns a JavaScript snippet (unauthenticated) that exports a function
/// for building URL paths from search result objects.
async fn search_link_gen() -> Response {
    (
        [(header::CONTENT_TYPE, "application/javascript")],
        SEARCH_LINK_GEN_JS,
    )
        .into_response()
}
