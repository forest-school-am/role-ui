use crate::auth::AuthenticatedUser;
use serde::Serialize;

// ---------------------------------------------------------------------------
// Audit event — written as a JSON line to stdout on every write attempt.
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AuditEvent<'a> {
    timestamp: String,
    actor_pk: i64,
    actor_uuid: &'a str,
    actor_username: &'a str,
    action: &'a str,
    group_pk: &'a str,
    group_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    target_user_pk: Option<i64>,
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
    caller: &AuthenticatedUser,
    action: &str,
    group_pk: &str,
    group_name: &str,
    target_user_pk: Option<i64>,
    result: &str,
    detail: Option<&str>,
) {
    let event = AuditEvent {
        timestamp: chrono::Utc::now().to_rfc3339(),
        actor_pk: caller.pk,
        actor_uuid: &caller.uuid,
        actor_username: &caller.username,
        action,
        group_pk,
        group_name,
        target_user_pk,
        result,
        detail,
    };
    if let Ok(json) = serde_json::to_string(&event) {
        println!("AUDIT {json}");
    }
}
