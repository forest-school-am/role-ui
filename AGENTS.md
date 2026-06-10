# Authentik Role UI — Project Briefing

Custom UI layered on **authentik v2026.5.2**. A Rust/axum backend enforces role-based group management; a React/TypeScript frontend visualises the group DAG and provides a user profile page. All persistent state lives in authentik's `attributes` fields — no separate database.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust + axum (in `backend/`) |
| Attributes crate | `../authentik_forest_school_attributes/` — typed serde structs for all attributes |
| Generated API client | `../authentik_api_2026_5_2/` — OpenAPI-generated Rust client for authentik |
| Frontend | React + TypeScript + Vite + TanStack Query + React Flow + Tailwind + shadcn/ui (in `frontend/`) |
| Identity | authentik 2026.5.2 via Docker Compose |

---

## Dev commands

All recipes use [just](https://just.systems/). `set dotenv-load` is active — `.env` is loaded automatically.

```
just app up           # build backend (debug) + start vite watch + serve at :8080
just app down         # kill backend and vite watch
just app logs         # tail /tmp/backend.log and /tmp/frontend.log
just app lint         # eslint + fallow + clippy
just app build        # release backend + vite production build

just authentik up     # docker compose up -d
just authentik down   # docker compose stop
just authentik reset  # full wipe → start → wait → setup → seed (use after DB loss)
just authentik setup  # create service account + OIDC app (idempotent)
just authentik seed   # create 10 test users + groups
```

| Service | URL |
|---|---|
| authentik | `http://localhost:9000` |
| Backend + frontend | `http://localhost:8080` |

---

## Credentials

- Service account API token: in `.env` as `AUTHENTIK_API_TOKEN`
- authentik admin password: in `.env` as `AUTHENTIK_BOOTSTRAP_PASSWORD`
- OIDC client ID: `roleui`, redirect URI: `http://localhost:8080/callback`
- Test users (password `Test1234!`): `alice.chen`, `bob.smith`, `carol.jones`, and 7 others

---

## Role model

Roles are stored in the group's `forest_school` attribute namespace (typed via the attributes crate):

```
forest_school.leaders: [username, ...]   — group leaders
forest_school.manager: [username, ...]   — group managers
```

Users not listed in either array but present in `group.users` are plain members. No role inheritance between groups.

| Action | Minimum role |
|---|---|
| Add / remove member | manager |
| Remove a manager | leader |
| Add manager | leader |
| Resign as leader (designate successor from managers) | leader |
| Create / attach / detach / disband child group | leader |
| Set group color | manager |
| Set google-sync config | leader |
| Patch own custom attributes | self |

Groups are addressed by **name**; users by **username** throughout the API.

---

## API surface

```
GET    /api/users?search=            search users
GET    /api/users/me                 caller's profile
PATCH  /api/users/me/attributes      replace caller's user-defined attributes
GET    /api/users/:username          any user's profile

GET    /api/groups                   list all groups
GET    /api/groups/:name             group detail
DELETE /api/groups/:name             disband (leader, no children)
POST   /api/groups/:name/members     add member (manager+)
DELETE /api/groups/:name/members/:u  remove member (manager+)
POST   /api/groups/:name/managers    add manager (leader)
DELETE /api/groups/:name/managers/:u remove manager (leader)
POST   /api/groups/:name/leader/resign  resign + hand off to a manager (leader)
POST   /api/groups/:name/subgroups   create child group; caller auto-assigned leader
POST   /api/groups/:name/children    attach existing group as child (leader)
DELETE /api/groups/:name/children/:c detach child (leader)
PUT    /api/groups/:name/color       set group color (manager+)
PATCH  /api/groups/:name/google-sync set google_sync config (leader)
```

---

## Authentik 2026.5.2 quirks

**Provider config** — all must be set correctly or auth silently breaks:

| Field | Required value | What breaks if wrong |
|---|---|---|
| `sub_mode` | `user_uuid` | `sub` becomes username → UUID lookup fails |
| `grant_types` | `["authorization_code", "refresh_token"]` | Token endpoint returns `invalid_request` |
| `property_mappings` | must include openid scope mapping UUID | userinfo returns 403 `Scope mismatch` |
| `signing_key` | `null` | RSA cert makes `_id_token` empty → userinfo JSONDecodeError |
| `redirect_uris` | array of `{matching_mode, url}` objects | Redirect rejected |

Run `just authentik setup` after any DB reset — it fixes all of the above.

**API differences from older authentik docs:**
- Authorize/token/userinfo: no slug in path (`/application/o/userinfo/`, not `/application/o/<slug>/userinfo/`)
- Pagination shape: `{pagination: {current, total_pages}, results: [...]}`
- `parents: UUID[]` on groups — true DAG, not a single `parent_id`
- Token `view_key`: GET, not POST

If login works but `/api/users/me` returns 502/400 after a DB reset, the browser has a stale token. Fix:
```js
sessionStorage.clear(); location.href = '/';
```
