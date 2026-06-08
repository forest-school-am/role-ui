use serde::Serialize;
use crate::routes::api_models::User;
// ---------------------------------------------------------------------------
// Audit event — written as a JSON line to stdout on every write attempt.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AuditEvent<'a> {
    timestamp: String,
    actor_username: &'a str,
    action: &'a str,
    group_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_username: Option<&'a str>,
    result: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    detail: Option<&'a str>,
}

/// Emit one JSON audit line to stdout.
///
/// `result` is one of `"ok"`, `"forbidden"`, or `"bad_request"`.
/// `detail` carries the rejection reason on non-ok results, or extra context
/// on success (e.g. the name of a newly created subgroup).
pub fn log(
    caller: &User,
    action: &str,
    group_name: &str,
    target_username: Option<&str>,
    result: &str,
    detail: Option<&str>,
) {
    let event = AuditEvent {
        timestamp: chrono::Utc::now().to_rfc3339(),
        actor_username: &caller.username,
        action,
        group_name,
        target_username,
        result,
        detail,
    };
    if let Ok(json) = serde_json::to_string(&event) {
        println!("AUDIT {json}");
    }
}
