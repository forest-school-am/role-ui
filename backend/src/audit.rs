use std::fs::OpenOptions;
use std::io::{LineWriter, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;

use crate::routes::api_models::User;

static WRITER: OnceLock<Mutex<LineWriter<std::fs::File>>> = OnceLock::new();

/// Call once at startup before accepting requests.
pub fn init(path: impl AsRef<Path>) -> anyhow::Result<()> {
    let file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path.as_ref())?;
    WRITER
        .set(Mutex::new(LineWriter::new(file)))
        .map_err(|_| anyhow::anyhow!("audit log already initialized"))?;
    Ok(())
}

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

pub fn log(
    caller: &User,
    action: &str,
    group_name: &str,
    target_username: Option<&str>,
    result: &str,
    detail: Option<&str>,
) {
    tracing::debug!(
        actor = %caller.username,
        action,
        group_name,
        target_username,
        result,
        detail,
        "audit"
    );

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
        if let Some(writer) = WRITER.get() {
            if let Ok(mut w) = writer.lock() {
                let _ = writeln!(w, "{json}");
            }
        }
    }
}
