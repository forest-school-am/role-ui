# backend/src/ index

| Item | Description |
|---|---|
| `main.rs` | Entry point: router assembly, middleware stack, server startup |
| `config.rs` | Env-var config struct |
| `auth.rs` | Token validation, token cache, auth middleware |
| `authentik.rs` | Authentik API client wrapper (all outbound API calls) |
| `authentik_state.rs` | In-memory user+group cache with dirty-flag invalidation |
| `error.rs` | `AppError` — unified error type mapping to HTTP status codes |
| `audit.rs` | Append-only audit log |
| `routes/` | HTTP route handlers and extractors |
