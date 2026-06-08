use axum::{
    extract::{Query, State},
    http::header,
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{error::AppError, AppState};

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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/search", get(search))
        .route("/search-link-gen", get(search_link_gen))
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

    let types_str = params.types.as_deref().unwrap_or("user,group");
    let want_users = types_str.split(',').any(|t| t.trim() == "user");
    let want_groups = types_str.split(',').any(|t| t.trim() == "group");

    let mut results: Vec<Value> = Vec::new();

    if want_users {
        let term = Regex::new(&q).unwrap_or_else(|_| {
            Regex::new(&regex::escape(&q)).expect("escaped regex must be valid")
        });
        for u in state.authentik_state.search_users_to_links(&term) {
            results.push(json!({
                "__search_type": "user",
                "username": u.username,
                "name": u.name,
            }));
        }
    }

    if want_groups {
        let q_lower = q.to_lowercase();
        for g in state.authentik_state.list_groups() {
            if g.name.to_lowercase().contains(&q_lower) {
                results.push(json!({
                    "__search_type": "group",
                    "name": g.name,
                }));
            }
        }
    }

    Ok(Json(results))
}

/// GET /api/search-link-gen
/// Intentionally unauthenticated — returns a static JS snippet with no user data.
async fn search_link_gen() -> Response {
    (
        [(header::CONTENT_TYPE, "application/javascript")],
        SEARCH_LINK_GEN_JS,
    )
        .into_response()
}
