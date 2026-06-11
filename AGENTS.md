# Authentik Role UI — Agent Guide

## Navigation protocol

Every folder in this repo contains two files an agent must consult before doing work there:

| File | Purpose |
|---|---|
| `AGENTS.md` | What lives here, key invariants, patterns to follow, things to avoid |
| `INDEX.md` | One-line description of every immediate child (file or directory) |

**Workflow:** start at the root `AGENTS.md` / `INDEX.md`, identify the relevant subtree, descend into it and repeat until you reach the files you need to change. Relevant context is pushed as deep as possible — the `AGENTS.md` in the most specific folder is the authoritative guide for that area.

**After any change:** update the `AGENTS.md` / `INDEX.md` of every folder whose contents or contracts were affected.

---

## Project overview

Custom UI layered on **authentik v2026.5.2**. A Rust/Axum backend enforces role-based group management; a React/TypeScript frontend visualises the group DAG and provides a user profile page. All persistent state lives in authentik's `attributes` fields — no separate database.

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Rust + Axum (`backend/`) |
| Attributes crate | `../authentik_forest_school_attributes/` — typed serde structs for all attributes |
| Generated Authentik API client | `../authentik_api_2026_5_2/` — OpenAPI-generated Rust client for authentik |
| Frontend | React + TypeScript + Vite + TanStack Query + React Flow + Tailwind (`frontend/`) |
| Identity | authentik 2026.5.2 via Docker Compose (`docker/composes/authentik.yml`) |

---

## Dev commands

All recipes use [just](https://just.systems/). `set dotenv-load` is active — `.env` is loaded automatically.

```
just app up           # build backend (debug) + start vite watch + serve at :8080
just app down         # kill backend and vite watch
just app logs         # tail /tmp/backend.log and /tmp/frontend.log
just app lint         # eslint + fallow + clippy
just app build        # release backend + vite production build

just authentik up     # docker compose up -d (authentik stack)
just authentik down   # docker compose stop
just authentik reset  # full wipe -> start -> wait -> setup -> seed (use after DB loss)
just authentik setup  # create service account + OIDC app (idempotent)
just authentik seed   # create 10 test users + groups
```

| Service | URL |
|---|---|
| authentik | `http://localhost:9000` |
| Backend + frontend | `http://localhost:8080` |

---

## Credentials

- Service account API token: `.env` -> `AUTHENTIK_API_TOKEN`
- authentik admin password: `.env` -> `AUTHENTIK_BOOTSTRAP_PASSWORD`
- OIDC client ID: `roleui`, redirect URI: `http://localhost:8080/auth/callback`
- Test users (password `Test1234!`): `alice.chen`, `bob.smith`, `carol.jones`, +7 others

---

## API / frontend boundary

`api-spec.yaml` is the single source of truth for the backend API.

1. Change the spec.
2. `cd frontend && npx orval` -- regenerates `frontend/src/api/generated/api.ts`.
3. **Manually** update `frontend/src/api/generated/index.ts` -- orval does NOT regenerate it; it must destructure every new function from `getAuthentikRoleUIBackend()`.
4. Write/update the thin wrapper in `frontend/src/api/`.

Never hand-write fetch calls for endpoints covered by the generated client.

---

## Role model

Roles are stored in the group's `forest_school` attribute namespace:

```
forest_school.leaders: [username]   -- group leaders
forest_school.manager: [username]   -- group managers
```

Members not listed in either array are plain members. No role inheritance.

| Action | Minimum role |
|---|---|
| Add / remove member | manager |
| Add manager / remove manager | leader |
| Resign as leader (designate successor) | leader |
| Create / attach / detach / disband child group | leader |
| Set group color | manager |
| Set google-sync config | leader |
| Rename group | leader |
| Patch own custom attributes | self |
| Change display name (one-time) | self |
| Toggle name freeze | superuser |

---

## Authentik 2026.5.2 quirks

**Attributes are deep-merged on PATCH** -- omitting a key leaves the old value in place. Always serialize booleans explicitly; never use `skip_serializing_if` on fields that can be `false` after being set to `true`.

**Provider config** -- all must be set correctly or auth silently breaks:

| Field | Required value |
|---|---|
| `sub_mode` | `user_uuid` |
| `grant_types` | `["authorization_code", "refresh_token"]` |
| `signing_key` | `null` |
| `redirect_uris` | array of `{matching_mode, url}` objects |

Run `just authentik setup` after any DB reset.

If login works but `/api/users/me` returns 502/400 after a DB reset -- stale browser token:
```js
sessionStorage.clear(); location.href = '/';
```
