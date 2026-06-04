# Project Brief: Authentik Role UI

## What We're Building

A lightweight web UI layered on top of an existing [authentik](https://goauthentik.io) installation.
authentik is the identity provider — we do not replace it, we extend it with a custom UI and a thin Rust backend.

## Stack Decisions

| Layer | Tech | Rationale |
|---|---|---|
| Backend | Rust + axum + reqwest | Lightweight proxy + role logic |
| Frontend | React + TypeScript + React Flow | DAG visualization, mature ecosystem |
| Styling | shadcn/ui + Tailwind | Fast, accessible components |
| API style | REST | Well-documented, simple |
| Auth | authentik OAuth2/OIDC | Dogfood the system |

## authentik API Facts

- Base URL: `https://<authentik-host>/api/v3/`
- Auth: Bearer token (API token or OAuth2 access token)
- OpenAPI schema at `/api/v3/schema/`

### Group Model (important)

Groups are a **true DAG** (not a tree) — each group can have multiple parents.

```
parents = ManyToManyField("Group", through="GroupParentageNode")
```

Key API fields on a Group object:
- `pk`: UUID
- `name`: string
- `is_superuser`: boolean
- `parents`: UUID[] (writable — native multi-parent DAG, available from 2025.x; we run 2026.5.2)
- `parents_obj`: expanded parent objects (only with `?include_parents=true`)
- `children`: UUID[] (reverse relation)
- `attributes`: arbitrary JSON — **this is where we store leader/manager roles**
- `users`: int[] (user PKs)
- `users_obj`: expanded user objects

Useful endpoints:
```
GET  /api/v3/core/groups/?include_parents=true   # full graph
GET  /api/v3/core/groups/{uuid}/
POST /api/v3/core/groups/
PATCH /api/v3/core/groups/{uuid}/
GET  /api/v3/core/users/
GET  /api/v3/core/users/{id}/
PATCH /api/v3/core/users/{id}/
```

### User Model

Key fields:
- `pk`: int
- `uuid`: UUID
- `username`: string
- `name`: string (display name)
- `email`: string
- `is_active`: boolean
- `attributes`: arbitrary JSON — **telegram handle stored here**

## Data Model Extensions (via authentik attributes)

We store our custom metadata inside authentik's `attributes` JSON field.
No separate database needed.

### Group attributes schema
```json
{
  "leader": "user-uuid",
  "managers": ["user-uuid-1", "user-uuid-2"]
}
```

### User attributes schema
```json
{
  "telegram": "@handle"
}
```

## Features to Build

### 1. Personal Page
- Per-user page showing: active/suspended status, email, telegram, list of groups
- Each group tag shows a gold crown if user is leader, silver if manager

### 2. Structure Page (DAG View)
- Visualize the group hierarchy as a DAG
- Top-level groups (no parents) are root nodes
- Each group node shows members inside as avatars/names
- Leader drawn first, with gold crown
- Managers drawn next, with silver crown
- Regular members below
- Edges connect parent → child groups
- Layout: left-to-right, groups expand rightward

### 3. Role Management
- `manager`: can add/remove members from their group
- `leader`: can do everything a manager can + assign/remove managers + create subgroups + assign subgroup leaders
- Role assignments are stored in group `attributes` and enforced by our Rust backend (not authentik)

## Our Backend Responsibilities

The Rust backend:
1. Authenticates requests (validates authentik tokens)
2. Proxies authentik API calls (read users, groups, memberships)
3. Enforces role-based authorization (only leaders can assign managers, etc.)
4. Exposes a clean REST API for the frontend

The Rust backend does NOT manage users or groups directly in authentik's sense —
it delegates all persistence to authentik via its API, using group/user `attributes` for role metadata.

## What Is NOT in Scope

- Replacing authentik admin UI
- Managing authentication flows, providers, applications in authentik
- Any native authentik RBAC (we build our own lightweight layer on top)
