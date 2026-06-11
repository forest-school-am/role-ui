# backend/src/ — server source

## Module map

| File | Role |
|---|---|
| `main.rs` | Router assembly, middleware wiring, startup (loads state, binds port) |
| `config.rs` | `Config` struct — reads all env vars at startup; fails fast if any are missing |
| `auth.rs` | JWT validation against authentik userinfo; 60-second token cache; `auth_middleware` injects `User` into request extensions |
| `authentik.rs` | Thin wrapper over the generated authentik API client; all calls to authentik live here |
| `authentik_state.rs` | In-memory snapshot of all users and groups; `WriteLock`/`FreshCache` dirty-flag mechanism |
| `error.rs` | `AppError` enum; maps to HTTP status codes |
| `audit.rs` | Append-only audit log (one JSON line per write operation) |
| `routes/` | Route handlers and extractors — see `routes/AGENTS.md` |

## Cache invalidation (WriteLock / FreshCache)

Write handlers acquire `WriteLock` (marks cache dirty, serialises concurrent writes). After the handler returns 2xx, `invalidate_on_write` middleware sends a signal to refresh the cache in the background. Read handlers that must return fresh data declare `_fresh: FreshCache` as their **first** extractor — it blocks until dirty=false.

**Critical:** `auth_middleware` reads the user from the cache *before* `FreshCache` runs. Handlers that return the caller's own data (e.g. `get_me`) must re-read from the fresh state after `FreshCache`, not reuse the `caller` from extensions.

## Type aliases (authentik_state.rs)

```rust
pub type UserPkType  = i64;
pub type GroupPkType = String;
pub type UserIdType  = String;   // username
pub type GroupIdType = String;   // group name
```

Use these everywhere — never bare `i64` or `String` for PK/ID fields.
