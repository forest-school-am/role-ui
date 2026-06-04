# Agent Briefing — Authentik Role UI

**Last updated:** 2026-06-04

Read this before doing anything. This project has a strict team model and several non-obvious authentik quirks that caused many hours of debugging.

---

## Team model (enforced)

| Role | Responsibility |
|---|---|
| **Claude (Manager)** | Coordinates only. **Forbidden from writing or editing code files.** Runs scripts, checks output, spawns agents. |
| **Architect** | Designs solutions, specifies algorithms, reviews diffs before they ship. |
| **Backend Dev** | Writes Rust (axum backend). |
| **Frontend Dev** | Writes React/TypeScript frontend. |
| **Tester** | Designs and executes tests. |

Claude must never directly edit source files. All code changes go through the appropriate agent.

---

## Project overview

Custom UI layered on top of **authentik v2026.5.2**. The app lets members of an organisation manage group membership with three internal roles: **leader**, **manager**, **member**. Groups form a DAG (multiple parents allowed). The Rust backend enforces role-based permissions; the React frontend visualises the DAG and provides a user profile page.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust + axum + reqwest + moka (token cache) |
| Frontend | React + TypeScript + Vite + TanStack Query + axios + React Flow + Tailwind + shadcn/ui |
| Identity | authentik 2026.5.2 (Docker Compose) |

---

## Repository layout

```
/home/dev/autentik-role-UI/
├── backend/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs          — startup, AppState, SPA fallback
│       ├── config.rs        — Config::from_env
│       ├── audit.rs         — audit::log() → stdout JSON lines
│       ├── auth.rs          — AuthenticatedUser extractor, moka token cache (60s TTL)
│       ├── authentik.rs     — AuthentikClient: all HTTP to authentik
│       ├── error.rs         — AppError enum → HTTP status codes
│       ├── models.rs        — response structs
│       └── routes/
│           ├── mod.rs
│           ├── users.rs     — /api/users/*
│           └── groups.rs    — /api/groups/*
├── frontend/
│   └── src/
│       ├── api/
│       │   ├── client.ts    — axios instance + extractApiError()
│       │   ├── groups.ts    — typed group API calls
│       │   └── users.ts     — typed user API calls
│       ├── auth/            — OIDC flow (AuthContext, OAuthCallback)
│       ├── components/
│       │   ├── dag/
│       │   │   ├── DAGCanvas.tsx   — layout algorithm + React Flow
│       │   │   ├── GroupNode.tsx   — individual node component
│       │   │   └── ColorPicker.tsx
│       │   └── panels/
│       │       ├── GroupPreviewPanel.tsx — slide-in panel from DAG click
│       │       └── GroupDetailPanel.tsx  — modals (AddMember, CreateSubgroup, etc.)
│       ├── pages/
│       │   ├── StructurePage.tsx   — DAG view
│       │   ├── GroupPage.tsx       — full-page group detail (route: /groups/:name)
│       │   └── PersonalPage.tsx    — user profile
│       └── types/index.ts          — shared TypeScript interfaces
├── scripts/
│   ├── setup-authentik.sh   — creates service account token + OIDC app (idempotent)
│   └── seed-test-data.sh    — creates 10 test users + groups
├── docker-compose.yml
└── .env                     — AUTHENTIK_BOOTSTRAP_TOKEN, AUTHENTIK_API_TOKEN, etc.
```

---

## Running services (dev)

| Service | URL | Notes |
|---|---|---|
| authentik | `http://localhost:9000` | Docker Compose |
| Backend | `http://localhost:8080` | Rust binary |
| Frontend (dev) | `http://localhost:5173` | Vite dev server |
| Frontend (prod via backend) | `http://localhost:8080` | Served from `frontend/dist` |

### Start backend
```bash
AUTHENTIK_BASE_URL=http://localhost:9000 \
AUTHENTIK_API_TOKEN=WKmXQZq74lpPXKdjwa5FPlynj9em0Fe7Hr1Otewt316sdrfbCR9eHJG9TaUd \
BACKEND_PORT=8080 \
STATIC_DIR=/home/dev/autentik-role-UI/frontend/dist \
/home/dev/autentik-role-UI/backend/target/debug/server
```

### Start frontend (dev)
```bash
cd /home/dev/autentik-role-UI/frontend && npm run dev -- --host 0.0.0.0
```

### Build frontend
```bash
cd /home/dev/autentik-role-UI/frontend && npm run build
```

---

## Credentials

- authentik admin password: in `/home/dev/autentik-role-UI/.env` as `AUTHENTIK_BOOTSTRAP_PASSWORD`
- Service account API token: `WKmXQZq74lpPXKdjwa5FPlynj9em0Fe7Hr1Otewt316sdrfbCR9eHJG9TaUd`
- OIDC client ID: `roleui`, redirect URI: `http://localhost:8080/callback`
- Test users (password `Test1234!`): `alice.chen`, `bob.smith`, `carol.jones`, and 7 others

---

## Auth flow (OIDC PKCE Authorization Code)

```
Browser → GET /application/o/authorize/  (PKCE)
        → POST /application/o/token/     → access_token
        → stored in sessionStorage["auth_token"]
        → sent as Bearer to /api/* on backend
        → backend calls GET /application/o/userinfo/ → {sub: UUID}
        → backend calls GET /api/v3/core/users/?uuid=<UUID>  (service account)
        → returns AuthenticatedUser{uuid, username, pk}
        → cached in moka (60s TTL)
```

**Critical authentik 2026.5.2 provider config** — all of these must be correct or auth silently breaks:

| Field | Required value | What breaks if wrong |
|---|---|---|
| `sub_mode` | `user_uuid` | `sub` becomes username string → `?uuid=alice.chen` → 400 |
| `grant_types` | `["authorization_code", "refresh_token"]` | Token endpoint returns `invalid_request — malformed` |
| `property_mappings` | must include openid scope mapping UUID | userinfo returns 403 `Scope mismatch` |
| `signing_key` | `null` | RSA cert makes `_id_token` empty → userinfo JSONDecodeError |
| `redirect_uris` | array of `{matching_mode, url}` objects | Redirect rejected |

The setup script at `scripts/setup-authentik.sh` handles all of this. Run it once after a DB reset.

**Authentik 2026.5.2 API differences from older docs:**
- Authorize/token/userinfo endpoints: no slug in path (e.g. `/application/o/authorize/` not `/application/o/<slug>/authorize/`)
- Pagination: `{pagination: {next: int}, results: [...]}` (not `{count, next_url, results}`)
- `view_key` for tokens: GET, not POST
- `parents: UUID[]` on groups (true DAG, not single `parent_id`)

---

## Role model

Roles are stored in group `attributes` JSON:
```json
{ "leader": "user-uuid", "managers": ["uuid1", "uuid2"] }
```

**No inheritance.** A user who is leader of group A is NOT automatically anything in group A's subgroups. When a leader creates a subgroup, they become leader of that subgroup only — with no automatic role in any other group.

| Action | Minimum role required |
|---|---|
| Add member | manager |
| Remove member | manager (own members) or leader (any) |
| Add manager | leader |
| Remove manager | leader |
| Set leader | leader (target must currently be a manager) |
| Create subgroup | leader |
| Add/detach child group | leader |
| Disband group | leader |
| Resign as leader | leader (must designate a successor from managers) |
| Set group color | leader |

---

## API endpoints

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | /api/users/me | yes | caller's profile |
| GET | /api/users/:uuid | yes | any user's profile |
| GET | /api/groups | yes | `?include_members=true` for full detail |
| GET | /api/groups/:name | yes | full detail with members |
| POST | /api/groups/:name/members | manager+ | `{user_pk: int}` |
| DELETE | /api/groups/:name/members/:user_pk | manager+ | |
| POST | /api/groups/:name/managers | leader | `{user_pk: int}` |
| DELETE | /api/groups/:name/managers/:user_pk | leader | |
| PUT | /api/groups/:name/leader | leader | `{user_pk: int}` — target must be a manager |
| POST | /api/groups/:name/leader/resign | leader | `{successor_pk: int}` |
| POST | /api/groups/:name/subgroups | leader | `{name: string}` |
| POST | /api/groups/:name/children | leader | `{group_name: string}` — attach existing group |
| DELETE | /api/groups/:name/children/:child_name | leader | detach child |
| DELETE | /api/groups/:name | leader | disband (also removes from authentik) |
| PUT | /api/groups/:name/color | leader | `{color: string}` — hex colour stored in attributes |

Groups are addressed by **name** (URL-encoded), not UUID.

---

## Data model

### TypeScript (frontend/src/types/index.ts)
```typescript
User { pk, uuid, username, name, is_active, social: SocialAccount[], ssh: SshKey[], groups: GroupMembership[] }
GroupDetail { pk, name, is_superuser, parent_pks, leader, managers, members, children, color?, is_virtual? }
GroupMembership { group_pk, group_name, role: 'leader'|'manager'|'member' }
SocialAccount { type: string, address: string }  // type="email"|"telegram"|etc.
SshKey { label: string, key: string }
```

### Rust (backend/src/models.rs)
`User`, `GroupDetail`, `GroupMember`, `GroupSummary`, `GroupMembership`, `GroupChild`, `GroupRole`, `MutationSuccess`

### AppState
```rust
pub struct AppState {
    pub authentik: Arc<AuthentikClient>,
    pub token_cache: Arc<Cache<String, AuthenticatedUser>>,
}
```
No config stored — consumed at startup only. All HTTP to authentik goes through `AuthentikClient`.

---

## DAG layout algorithm (DAGCanvas.tsx)

The layout minimises total vertical length of all connectors using coordinate descent.

**Constants:**
```
COLUMN_WIDTH = 320
NODE_HEADER_HEIGHT = 42
NODE_MEMBER_ROW_HEIGHT = 24
NODE_MEMBER_MAX_HEIGHT = 192
NODE_FOOTER_PAD = 8
NODE_GAP = 20
```

**Node height** (variable, based on member count):
```
nodeHeight(pk) = 42 + min(memberCount * 24, 192) + 8
```

**Column assignment:** topological relaxation — `col[node] = max(col[parents]) + 1`.

**`packColumn(orderedPks, desiredYCenters?)`** — bidirectional packing:
- Forward pass: push nodes down so no overlap occurs
- Backward pass check: if a node can move up toward its ideal without overlapping the node above it, it does
- Returns `Map<pk, yCenter>`

**`computeOptimalRows()`** — coordinate descent:
1. Classify connected vs isolated nodes (isolated = no edges)
2. Initialise ordering alphabetically by name (deterministic)
3. Run up to 20 iterations (forward + backward column sweeps)
4. Each column: sort by median yCenter of neighbours, tie-break by pk string
5. Re-pack after each reorder; stop early when cost unchanged
6. Place isolated nodes below connected nodes in their column, alphabetically

**Virtual nodes** (`is_virtual: true`) are placed below the real DAG at a fixed Y offset, side by side.

---

## Error handling

All mutations set a `mutationError` state via `onError: (err) => setMutationError(extractApiError(err))`. Errors display inline in the panel. `extractApiError` (in `api/client.ts`) reads `err.response.data.error`.

The 401 interceptor in `api/client.ts` clears sessionStorage and redirects to `/` on any 401 response.

---

## SPA serving (backend)

The backend serves the frontend SPA using:
```rust
.nest_service("/assets", ServeDir::new(static_dir.join("assets")))
.fallback(move || {
    let path = index_html.clone();
    async move {
        match tokio::fs::read(&path).await {
            Ok(bytes) => ([(header::CONTENT_TYPE, "text/html; charset=utf-8")], bytes).into_response(),
            Err(_) => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
        }
    }
})
```
**Do not** use `ServeDir::not_found_service` — it returns 404 status with index.html body, which breaks OIDC callbacks.

---

## Known issues / backlog

- No token refresh — token expires after 1h, user must re-login
- `is_superuser=true` groups not filtered from group list (low priority)
- `STATIC_DIR` must be an absolute path at startup — relative paths fail
- No pagination on `/api/groups` response (fetch all at once; fine for current scale)
- Service account must be in `authentik Admins` group or API calls return 403

---

## Setup after a DB reset

```bash
# 1. Bring up authentik
cd /home/dev/autentik-role-UI && docker compose up -d

# 2. Set up service account, API token, and OIDC app
AUTHENTIK_BOOTSTRAP_TOKEN=$(grep AUTHENTIK_BOOTSTRAP_TOKEN .env | cut -d= -f2) \
  ./scripts/setup-authentik.sh

# 3. Seed test data
AUTHENTIK_API_TOKEN=$(grep AUTHENTIK_API_TOKEN .env | cut -d= -f2) \
  ./scripts/seed-test-data.sh

# 4. Build frontend
cd frontend && npm run build && cd ..

# 5. Start backend (update API token from .env)
AUTHENTIK_BASE_URL=http://localhost:9000 \
AUTHENTIK_API_TOKEN=$(grep AUTHENTIK_API_TOKEN .env | cut -d= -f2) \
BACKEND_PORT=8080 \
STATIC_DIR=/home/dev/autentik-role-UI/frontend/dist \
./backend/target/debug/server &
```

If login works but `/api/users/me` returns 502/400 after a reset, the user's browser has a stale token issued under the old `sub_mode`. Tell them to run in the browser console:
```js
sessionStorage.clear(); location.href = '/';
```

---

## Future direction

The app is intended to grow into a **company-wide portal** (document search, service catalog). Design search APIs as a single unified `/api/search?q=&types=` endpoint so the frontend contract is stable. Do not add Elasticsearch until document/service indexing is actually needed — authentik's `?search=` is sufficient for people/group search.
