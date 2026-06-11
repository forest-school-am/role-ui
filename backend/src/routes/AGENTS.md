# backend/src/routes/ — HTTP route handlers

## Layout

`mod.rs` assembles the router and applies `invalidate_on_write` and `auth_middleware` as route layers. Handlers are split by resource.

## Extractor conventions

Always use `FromRequestParts` extractors for handler arguments — never parse path params manually. Available extractors (`helpers/extractors.rs`):

| Extractor | What it provides |
|---|---|
| `FreshCache` | Blocks until cache is not dirty; must be **first** in any handler that reads from the cache |
| `WriteLock` | Marks cache dirty, acquires write mutex, sets `WriteFlag`; must appear in write handlers |
| `User` | Authenticated caller from request extensions (set by `auth_middleware`) |
| `UserFromPath<PP>` | Full `User` looked up from a path param by username — reads from **fresh** state because it runs after `FreshCache` |
| `GroupFromPath<PP>` | Full `Group` looked up from a path param by name |
| `GroupAccess<R>` | Group + caller + role check (`R` = `Leader` or `ManagerOrLeader`); auto-elevates superusers |
| `SuperuserAccess` | Requires `caller.is_superuser && x-as-superuser: true` header |

`PathParams` enum provides type-safe path segment names (`PathParams::Username`, `PathParams::GroupName`, etc.).

## api_models.rs

Shared request/response structs (`User`, `Group`, `UserLogins`, `RoleSplit`, etc.). `User` and `Group` have `#[serde(skip)]` fields (`pk`, `attrs`, `parent_pks`) that are used internally but not serialised.

## Adding a new endpoint

1. Add the route to the `Router` in the relevant file (`users.rs` or `groups.rs`).
2. Write the handler using appropriate extractors.
3. Update `api-spec.yaml`.
4. Run `cd frontend && npx orval`.
5. Update `frontend/src/api/generated/index.ts` (manual).
6. Add a wrapper in `frontend/src/api/`.
