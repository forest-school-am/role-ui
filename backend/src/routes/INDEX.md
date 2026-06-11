# backend/src/routes/ index

| Item | Description |
|---|---|
| `mod.rs` | Router assembly; `invalidate_on_write` middleware |
| `api_models.rs` | Shared request/response types (`User`, `Group`, `UserLogins`, `RoleSplit`, …) |
| `users.rs` | `/api/users/*` handlers: get_me, get_user, search_users, set_display_name, toggle_name_freeze, patch_my_attributes |
| `groups.rs` | `/api/groups/*` handlers: list, get, disband, members, managers, leaders, children, rename, color, google-sync |
| `search.rs` | `/api/search` and `/api/search-link-gen` — cross-entity search |
| `helpers/` | `FromRequestParts` extractors (FreshCache, WriteLock, GroupAccess, …) |
