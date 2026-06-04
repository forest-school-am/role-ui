use axum::{
    extract::{Query, State},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{auth::AuthenticatedUser, error::AppError, AppState};

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/search", get(search))
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

    let (user_results, group_results) = match (want_users, want_groups) {
        (true, true) => {
            let (users, groups) = tokio::try_join!(
                state.authentik.search_users(&q, 20),
                state.authentik.get_groups_all(),
            )?;
            (users, groups)
        }
        (true, false) => (state.authentik.search_users(&q, 20).await?, vec![]),
        (false, true) => (vec![], state.authentik.get_groups_all().await?),
        (false, false) => (vec![], vec![]),
    };

    for u in user_results {
        results.push(json!({
            "__search_type": "user",
            "pk": u.pk,
            "uuid": u.uuid,
            "username": u.username,
            "name": u.name,
        }));
    }

    let q_lower = q.to_lowercase();
    for g in group_results {
        if g.is_superuser || !g.name.to_lowercase().contains(&q_lower) {
            continue;
        }
        results.push(json!({
            "__search_type": "group",
            "pk": g.pk,
            "name": g.name,
            "is_superuser": g.is_superuser,
        }));
    }

    Ok(Json(results))
}

