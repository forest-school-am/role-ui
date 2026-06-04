# Technical Design Document: Authentik Role UI

## Overview

This document is the authoritative specification for the Authentik Role UI project. Developers implement directly from this document. Nothing here should be interpreted or inferred — if something is ambiguous, consult the Open Questions section (§6) before writing code.

The system consists of a thin Rust backend (axum) that proxies and extends the authentik API, plus a React/TypeScript frontend. No separate database is used. All persistent state lives in authentik's `attributes` fields on users and groups.

---

## 1. Rust Backend API Contract

### Global conventions

- All endpoints require a valid Bearer token in the `Authorization` header (the user's authentik OIDC access token).
- All request and response bodies are `application/json`.
- The backend resolves the calling user's identity before every endpoint handler runs (see §2).
- HTTP error responses follow the shape: `{ "error": "<message>" }`.
- All UUIDs are lowercase hyphenated strings (`"550e8400-e29b-41d4-a716-446655440000"`).
- User PKs are integers; Group PKs are UUIDs (this follows authentik's own model).

---

### 1.1 User endpoints

#### `GET /api/users/me`

Returns the profile of the currently authenticated user.

- **Caller:** any authenticated user
- **Request body:** none
- **Response body:**

```
{
  "pk": int,
  "uuid": string (UUID),
  "username": string,
  "name": string,
  "email": string,
  "is_active": boolean,
  "telegram": string | null,
  "groups": GroupMembership[]
}
```

Where `GroupMembership` is:

```
{
  "group_pk": string (UUID),
  "group_name": string,
  "role": "leader" | "manager" | "member"
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/users/{id}/` — fetch user record (id resolved from token introspection, see §2)
  2. `GET /api/v3/core/groups/?include_parents=true&members_direct={user_pk}` — fetch all groups the user belongs to (filter by user membership)
- **Business logic:**
  - `telegram` is extracted from `user.attributes.telegram` (null if not present or attributes is null).
  - For each group in the user's membership list, resolve role by running Role Resolution (§3) with `subject_user_uuid = user.uuid`.
  - Groups are returned in alphabetical order by `group_name`.

---

#### `GET /api/users/{user_uuid}`

Returns the profile of any user by their authentik UUID.

- **Caller:** any authenticated user
- **Request body:** none
- **Response body:** same shape as `GET /api/users/me`
- **authentik API calls:**
  1. `GET /api/v3/core/users/?uuid={user_uuid}` — resolve user by UUID to get integer PK and full user object
  2. `GET /api/v3/core/groups/?members_direct={user_pk}` — fetch all groups the user belongs to
- **Business logic:** identical to `/api/users/me`. Role resolution is applied per group.

---

### 1.2 Group endpoints

#### `GET /api/groups`

Returns all groups with their full hierarchy information for DAG rendering.

- **Caller:** any authenticated user
- **Request body:** none
- **Response body:**

```
{
  "groups": GroupSummary[]
}
```

Where `GroupSummary` is:

```
{
  "pk": string (UUID),
  "name": string,
  "is_superuser": boolean,
  "parent_pks": string[] (UUID[]),
  "leader_uuid": string (UUID) | null,
  "manager_uuids": string[] (UUID[]),
  "member_count": int
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/?include_parents=true` — paginate through all groups
- **Business logic:**
  - `leader_uuid` is extracted from `group.attributes.leader` (null if absent).
  - `manager_uuids` is extracted from `group.attributes.managers` (empty array if absent).
  - `parent_pks` is taken directly from the `parents` field (list of UUIDs).
  - `member_count` is the length of the `users` array on the group object.
  - Pagination: iterate all authentik pages (using `?page_size=500&page=N`) and aggregate before responding. The backend must not expose raw pagination to the frontend.

---

#### `GET /api/groups/{group_pk}`

Returns full detail for a single group including all members with their roles.

- **Caller:** any authenticated user
- **Request body:** none
- **Response body:**

```
{
  "pk": string (UUID),
  "name": string,
  "is_superuser": boolean,
  "parent_pks": string[] (UUID[]),
  "leader": GroupMember | null,
  "managers": GroupMember[],
  "members": GroupMember[]
}
```

Where `GroupMember` is:

```
{
  "pk": int,
  "uuid": string (UUID),
  "username": string,
  "name": string,
  "email": string,
  "is_active": boolean,
  "telegram": string | null
}
```

Note: the `leader` field contains the single leader member object (or null). `managers` contains manager member objects. `members` contains all other regular members. A user who is leader or manager does NOT also appear in `members`.

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/?include_parents=true` — fetch group with attributes and parent list
  2. For each user UUID in `group.users`, batch-fetch user objects: `GET /api/v3/core/users/?pk__in={pk1},{pk2},...` (use pagination if needed). If authentik does not support `pk__in`, fall back to individual `GET /api/v3/core/users/{pk}/` calls with concurrency.
- **Business logic:**
  - `leader_uuid` comes from `group.attributes.leader`.
  - `manager_uuids` comes from `group.attributes.managers`.
  - Partition all user objects into the three buckets: leader (UUID matches `leader_uuid`), managers (UUID in `manager_uuids`), members (everyone else).
  - `telegram` is extracted from `user.attributes.telegram`.
  - `managers` and `members` are sorted by `name` ascending.

---

#### `POST /api/groups/{group_pk}/members`

Add a user to a group (make them a regular member).

- **Caller:** manager or leader of this group
- **Request body:**

```
{
  "user_pk": int
}
```

- **Response body:**

```
{
  "ok": true
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — fetch current group (to get current `users` list and `attributes`)
  2. `GET /api/v3/core/users/{user_pk}/` — verify user exists and is active
  3. `PATCH /api/v3/core/groups/{group_pk}/` — send updated `users` list (add `user_pk` to existing list if not already present)
- **Business logic / validation:**
  - Calling user must have `manager` or `leader` role in this group (§3). Respond `403` if not.
  - If `user_pk` is already in the group, respond `200` with `{ "ok": true }` (idempotent).
  - If user does not exist in authentik, respond `404 { "error": "user not found" }`.

---

#### `DELETE /api/groups/{group_pk}/members/{user_pk}`

Remove a user from a group entirely (removes all roles as well if applicable).

- **Caller:** manager or leader of this group
- **Request body:** none
- **Response body:**

```
{
  "ok": true
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — fetch current group state
  2. `PATCH /api/v3/core/groups/{group_pk}/` — send updated `users` list with `user_pk` removed, AND updated `attributes` with the user removed from `leader` and `managers` fields if present
- **Business logic / validation:**
  - Calling user must have `manager` or `leader` role in this group. Respond `403` if not.
  - A manager cannot remove another manager. If the target user is in `attributes.managers` and the calling user is a manager (not leader), respond `403 { "error": "managers cannot remove other managers" }`.
  - A manager cannot remove the leader. If the target user's UUID matches `attributes.leader` and the calling user is a manager (not leader), respond `403 { "error": "managers cannot remove the group leader" }`.
  - A leader cannot remove themselves if they are the leader. Respond `403 { "error": "leader cannot remove themselves; reassign leadership first" }`.
  - If user is not in the group, respond `200` with `{ "ok": true }` (idempotent).
  - Both the `users` array and the `attributes` (leader/managers) must be updated atomically in a single `PATCH` call.

---

#### `POST /api/groups/{group_pk}/managers`

Assign the manager role to a user who is already a member of the group.

- **Caller:** leader of this group only
- **Request body:**

```
{
  "user_pk": int
}
```

- **Response body:**

```
{
  "ok": true
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — fetch current group state
  2. `GET /api/v3/core/users/{user_pk}/` — fetch user to get their UUID
  3. `PATCH /api/v3/core/groups/{group_pk}/` — send updated `attributes` with user's UUID added to `managers` list
- **Business logic / validation:**
  - Calling user must have `leader` role in this group. Respond `403` if not.
  - Target user must already be a member of the group (i.e., their `pk` appears in `group.users`). Respond `400 { "error": "user is not a member of this group" }` if not.
  - Target user must not already be the leader. Respond `400 { "error": "user is already the leader" }` if they are.
  - If the user is already in `managers`, respond `200 { "ok": true }` (idempotent).
  - Only the `attributes` field is patched; `users` list is not changed.

---

#### `DELETE /api/groups/{group_pk}/managers/{user_pk}`

Remove the manager role from a user.

- **Caller:** leader of this group only
- **Request body:** none
- **Response body:**

```
{
  "ok": true
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — fetch current group state
  2. `GET /api/v3/core/users/{user_pk}/` — fetch user to get their UUID
  3. `PATCH /api/v3/core/groups/{group_pk}/` — send updated `attributes` with user's UUID removed from `managers`
- **Business logic / validation:**
  - Calling user must have `leader` role in this group. Respond `403` if not.
  - If the user is not in `managers`, respond `200 { "ok": true }` (idempotent).
  - Only `attributes` is patched; `users` list is unchanged (user stays in the group as a regular member).

---

#### `PUT /api/groups/{group_pk}/leader`

Assign the leader role to a user. The target user must already be a manager of this group.

- **Caller:** current leader of this group only
- **Request body:**

```
{
  "user_pk": int
}
```

- **Response body:**

```
{
  "ok": true
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — fetch current group state
  2. `GET /api/v3/core/users/{user_pk}/` — fetch user to get their UUID
  3. `PATCH /api/v3/core/groups/{group_pk}/` — send updated `attributes`: set `leader` to target user's UUID and remove target user from `managers` list
- **Business logic / validation:**
  - Calling user must be the current leader of this group. Respond `403` if not.
  - Target user must be in the group's `managers` list. Respond `400 { "error": "user must be a manager before becoming leader" }` if they are not a manager.
  - After assignment: the previous leader implicitly becomes a regular member (their UUID is no longer in `leader`). The previous leader is NOT automatically removed from the group `users` list — they remain a member.
  - The new leader is removed from `managers` list and set as `leader`.
  - This is not idempotent in the general case: if the target is already the leader, respond `200 { "ok": true }`.

---

#### `POST /api/groups/{group_pk}/subgroups`

Create a new group as a child of the given group.

- **Caller:** leader of the parent group only
- **Request body:**

```
{
  "name": string
}
```

- **Response body:**

```
{
  "pk": string (UUID),
  "name": string
}
```

- **authentik API calls:**
  1. `GET /api/v3/core/groups/{group_pk}/` — verify parent group exists and calling user is leader
  2. `POST /api/v3/core/groups/` — create new group with `{ "name": "<name>", "parents": ["<group_pk>"] }`
- **Business logic / validation:**
  - Calling user must have `leader` role in the parent group. Respond `403` if not.
  - `name` must be a non-empty string after trimming whitespace. Max length 150 characters (matching authentik limits). Respond `400 { "error": "name is required" }` if blank.
  - On success, return the newly created group's `pk` and `name` from the authentik response.
  - The new group's `attributes` will be empty by default (no leader or managers yet).

---

## 2. Auth Flow

### Overview

The frontend uses authentik's OIDC Authorization Code flow with PKCE. The backend validates the resulting access token on every request by calling authentik's token introspection endpoint or userinfo endpoint. The backend does not maintain sessions or issue its own tokens.

### Detailed flow

**Step 1 — Frontend initiates login**

The React app, on first load without a stored token, redirects the browser to authentik's OIDC authorization endpoint:

```
GET https://<authentik-host>/application/o/<app-slug>/authorize/
  ?response_type=code
  &client_id=<client-id>
  &redirect_uri=<frontend-origin>/callback
  &scope=openid profile email
  &code_challenge=<PKCE challenge>
  &code_challenge_method=S256
  &state=<random nonce>
```

**Step 2 — Authentik authenticates the user**

Authentik handles all credential verification, MFA, etc. On success it redirects to the frontend callback URL with a `code` and the original `state`.

**Step 3 — Frontend exchanges code for tokens**

The frontend sends a token exchange request (from the browser, or proxied through the backend — see Open Questions §6.1):

```
POST https://<authentik-host>/application/o/<app-slug>/token/
  Content-Type: application/x-www-form-urlencoded

  grant_type=authorization_code
  &code=<code>
  &redirect_uri=<frontend-origin>/callback
  &client_id=<client-id>
  &code_verifier=<PKCE verifier>
```

Response includes `access_token`, `id_token`, `refresh_token`, `expires_in`.

**Step 4 — Frontend stores tokens and attaches to requests**

The frontend stores the `access_token` (and `refresh_token`) in memory (not localStorage, see §6.2 for discussion). Every request to the Rust backend includes:

```
Authorization: Bearer <access_token>
```

**Step 5 — Backend validates the token on every request**

The backend middleware intercepts every incoming request and performs token introspection. Two acceptable approaches (see §6.3 for decision):

- **Option A — Userinfo endpoint:** `GET https://<authentik-host>/application/o/<app-slug>/userinfo/` with the forwarded Bearer token. On success, authentik returns the OIDC claims. Cache result for 60 seconds per token (using a short-lived in-memory cache keyed by token hash) to avoid calling authentik on every request.
- **Option B — JWT validation:** Fetch authentik's JWKS from `https://<authentik-host>/application/o/<app-slug>/jwks/` and validate the JWT signature locally. Refresh JWKS on a schedule (e.g., every hour) or on validation failure.

The middleware extracts from the token/claims:
- `sub` — authentik user UUID (stored as `uuid` on the user object)
- `email`
- `preferred_username`

These are stored in request context so downstream handlers can use them without re-fetching.

**Step 6 — Backend resolves user identity to an integer PK**

Many authentik API calls require the integer `pk` (not the UUID). After step 5, the backend calls:

```
GET /api/v3/core/users/?uuid=<sub>
```

This returns the full user object including the integer `pk`. The result should be cached per-UUID with a short TTL (e.g., 5 minutes) to reduce authentik API calls.

**Step 7 — Token refresh**

The frontend is responsible for refreshing the access token before expiry using the stored `refresh_token`:

```
POST https://<authentik-host>/application/o/<app-slug>/token/
  grant_type=refresh_token
  &refresh_token=<refresh_token>
  &client_id=<client-id>
```

The frontend should refresh proactively (e.g., 60 seconds before expiry). If the backend returns `401`, the frontend clears stored tokens and redirects to login.

---

## 3. Role Resolution

### Definitions

A user's role in a group is derived entirely from the group's `attributes` JSON field. No authentik native RBAC is used for this purpose.

- **Leader:** `group.attributes.leader == user.uuid` (string equality)
- **Manager:** `user.uuid` appears in `group.attributes.managers` (array contains)
- **Member:** `user.pk` appears in `group.users` AND the user is neither leader nor manager
- **Non-member:** `user.pk` does not appear in `group.users`

### Role resolution algorithm

Given:
- `group_pk` — the group being checked
- `subject_user_uuid` — the UUID of the user whose role we are determining
- `subject_user_pk` — the integer PK of the same user

Procedure:

1. Fetch the group: `GET /api/v3/core/groups/{group_pk}/` — this returns `attributes`, `users`, `parents`.
2. Extract `leader_uuid = group.attributes?.leader ?? null`.
3. Extract `manager_uuids = group.attributes?.managers ?? []`.
4. If `leader_uuid == subject_user_uuid` → role is `leader`. Stop.
5. If `manager_uuids.contains(subject_user_uuid)` → role is `manager`. Stop.
6. If `group.users.contains(subject_user_pk)` → role is `member`. Stop.
7. Role is `non-member`.

### Authorization checks (used in endpoint handlers)

- **"is manager or leader":** role is `leader` OR `manager`
- **"is leader":** role is `leader` exactly

### Role resolution for request authorization

When an endpoint requires a role check, the handler:
1. Resolves the calling user's UUID from the request context (set in step 5 of auth flow).
2. Fetches the group to get its `attributes` and `users` list.
3. Runs the algorithm above.

The group fetch in step 2 will often already be needed by the handler for its own business logic, so the same fetched object can be reused — the backend should not perform two separate fetches.

### Edge cases

- If `group.attributes` is null or missing the `leader` key, there is no leader.
- If `group.attributes` is null or missing the `managers` key, there are no managers.
- A user UUID that appears as leader is NOT also expected to appear in `managers`. If they appear in both, `leader` takes precedence.
- A user can be a manager or leader without having a role in any parent group — roles are strictly per-group.

---

## 4. Frontend Component Map

### Routing structure

```
/                    → redirect to /me
/me                  → PersonalPage (own profile)
/users/:userUuid     → PersonalPage (another user's profile)
/structure           → StructurePage
/callback            → OAuthCallback (handles OIDC redirect)
```

---

### Pages

#### PersonalPage

- **Route:** `/me` and `/users/:userUuid`
- **Purpose:** Display a single user's profile with group memberships and roles.
- **Data fetched:**
  - `/me` route: `GET /api/users/me`
  - `/users/:userUuid` route: `GET /api/users/{userUuid}`
- **State:**
  - `user: User | null` — the loaded user object
  - `loading: boolean`
  - `error: string | null`
- **Child components:**
  - `UserCard` — renders the main profile card
  - `GroupTag` (multiple, one per group membership) — rendered inside UserCard
  - `CrownIcon` — rendered inside GroupTag when role is leader or manager

---

#### StructurePage

- **Route:** `/structure`
- **Purpose:** Full-screen DAG visualization of all groups with members shown inside each node.
- **Data fetched:**
  - `GET /api/groups` — group list with hierarchy
  - `GET /api/groups/{group_pk}` — lazily fetched per node when expanded/hovered, OR eagerly fetched for all groups on load (see §6.4)
- **State:**
  - `groups: GroupSummary[]` — raw list from backend
  - `selectedGroupPk: string | null` — currently selected/expanded group node
  - `groupDetails: Record<string, GroupDetail>` — cache of fetched group details by pk
  - `loading: boolean`
  - `error: string | null`
- **Child components:**
  - `DAGCanvas` — the full React Flow canvas
  - `GroupNode` (rendered by React Flow per node)
  - `GroupMemberItem` (rendered inside GroupNode)
  - `CrownIcon`

---

### Components

#### UserCard

- **Purpose:** Display a user's name, status, email, telegram handle, and their group memberships with roles.
- **Props:**
  - `user: User` — the full user object including `groups: GroupMembership[]`
- **State:** none (pure display component)
- **Renders:**
  - User display name (`user.name`)
  - Active/Suspended badge based on `user.is_active`
  - Email
  - Telegram handle (or "–" if null)
  - List of `GroupTag` components, one per entry in `user.groups`, sorted by group name

---

#### GroupTag

- **Purpose:** A pill/badge showing a group name and optionally a role crown icon.
- **Props:**
  - `groupName: string`
  - `role: "leader" | "manager" | "member"`
  - `onClick?: () => void` — optional, navigates to group in StructurePage or opens detail
- **State:** none
- **Renders:**
  - `CrownIcon` with `variant="gold"` if role is `leader`
  - `CrownIcon` with `variant="silver"` if role is `manager`
  - No icon if role is `member`
  - Group name text

---

#### CrownIcon

- **Purpose:** A visual crown icon indicating leader or manager role.
- **Props:**
  - `variant: "gold" | "silver"`
  - `size?: "sm" | "md"` — default `"sm"`
- **State:** none
- **Renders:** An SVG crown icon. Gold (#FFD700) for leader, silver (#C0C0C0) for manager. No interactivity.

---

#### DAGCanvas

- **Purpose:** Wraps React Flow to render the group DAG. Handles layout computation and event delegation.
- **Props:**
  - `groups: GroupSummary[]`
  - `groupDetails: Record<string, GroupDetail>`
  - `onGroupSelect: (groupPk: string) => void`
- **State:**
  - `nodes: Node[]` — React Flow node objects, computed from `groups`
  - `edges: Edge[]` — React Flow edge objects, computed from `groups`
- **Behavior:**
  - On mount and when `groups` changes, compute a left-to-right layout using a topological sort. Root nodes (groups with no parents) are placed in the leftmost column. Children are placed one column to the right of their rightmost parent.
  - Each node in the layout maps to a `GroupNode` component rendered by React Flow's `nodeTypes`.
  - Edges connect from parent group node to child group node (direction: parent → child, left to right).
  - When a node is clicked, call `onGroupSelect` with the group's pk.
- **Child components:**
  - `GroupNode` (via React Flow `nodeTypes`)

---

#### GroupNode

- **Purpose:** A single node in the DAG canvas. Displays group name and members (leader, managers, members).
- **Props:**
  - `data: GroupNodeData` — a custom data object passed by React Flow

Where `GroupNodeData` is:

```
{
  groupPk: string,
  groupName: string,
  detail: GroupDetail | null,   // null if not yet loaded
  onSelect: (groupPk: string) => void
}
```

- **State:** none (data comes from parent via React Flow)
- **Renders:**
  - Group name as a header
  - If `detail` is null: a loading skeleton or just the group name
  - If `detail` is loaded:
    - Leader first: `GroupMemberItem` with `CrownIcon variant="gold"`, if leader exists
    - Managers next: `GroupMemberItem` with `CrownIcon variant="silver"` for each
    - Regular members below: `GroupMemberItem` with no crown, for each
  - React Flow source/target handles on left and right edges for edge connections

---

#### GroupMemberItem

- **Purpose:** A single member row inside a GroupNode.
- **Props:**
  - `member: GroupMember`
  - `crownVariant?: "gold" | "silver"` — undefined means no crown
- **State:** none
- **Renders:**
  - `CrownIcon` if `crownVariant` is provided
  - User display name (`member.name`)
  - Clicking navigates to `/users/{member.uuid}`

---

### Management UI components (role management actions)

These components are conditionally rendered only when the calling user has the appropriate role. They are embedded in context menus or action panels on the group detail view (accessible from StructurePage by clicking a group node or from a separate group detail panel).

#### GroupDetailPanel

- **Purpose:** A side panel or modal showing full group detail and management actions.
- **Props:**
  - `groupPk: string`
  - `callerRole: "leader" | "manager" | "member" | "non-member"` — the calling user's role in this group
- **State:**
  - `detail: GroupDetail | null`
  - `loading: boolean`
- **Data fetched:** `GET /api/groups/{groupPk}`
- **Renders:**
  - Full member list (same layout as GroupNode but with action buttons)
  - If `callerRole` is `manager` or `leader`: "Add Member" button → opens `AddMemberForm`
  - If `callerRole` is `manager` or `leader`: remove member button per regular member
  - If `callerRole` is `leader`: "Assign Manager" button per regular member, "Remove Manager" button per manager
  - If `callerRole` is `leader`: "Assign Leader" button per manager (with confirmation dialog)
  - If `callerRole` is `leader`: "Create Subgroup" button → opens `CreateSubgroupForm`

---

## 5. Data Types (TypeScript interfaces)

These interfaces correspond directly to the API response shapes defined in §1.

```typescript
// Roles a user can have within a single group
type GroupRole = "leader" | "manager" | "member";

// A compact group membership entry on a user's profile
interface GroupMembership {
  group_pk: string;      // UUID
  group_name: string;
  role: GroupRole;
}

// Full user profile (response from GET /api/users/me and GET /api/users/:uuid)
interface User {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  email: string;
  is_active: boolean;
  telegram: string | null;
  groups: GroupMembership[];
}

// Summary of a group, used in the groups list (GET /api/groups)
interface GroupSummary {
  pk: string;            // UUID
  name: string;
  is_superuser: boolean;
  parent_pks: string[];  // UUID[]
  leader_uuid: string | null;  // UUID
  manager_uuids: string[];     // UUID[]
  member_count: number;
}

// Full group list response
interface GroupListResponse {
  groups: GroupSummary[];
}

// A single member inside a group detail response
interface GroupMember {
  pk: number;
  uuid: string;          // UUID
  username: string;
  name: string;
  email: string;
  is_active: boolean;
  telegram: string | null;
}

// Full group detail (response from GET /api/groups/:groupPk)
interface GroupDetail {
  pk: string;            // UUID
  name: string;
  is_superuser: boolean;
  parent_pks: string[];  // UUID[]
  leader: GroupMember | null;
  managers: GroupMember[];
  members: GroupMember[];
}

// Mutation success response (used for add/remove member, manager, leader)
interface MutationSuccess {
  ok: true;
}

// Error response from backend
interface ApiError {
  error: string;
}

// React Flow node data payload for GroupNode
interface GroupNodeData {
  groupPk: string;
  groupName: string;
  detail: GroupDetail | null;
  onSelect: (groupPk: string) => void;
}

// CrownIcon variant
type CrownVariant = "gold" | "silver";

// CrownIcon size
type CrownSize = "sm" | "md";
```

---

## 6. Resolved Decisions

### 6.1 — Auth: authentik OIDC, browser-side Authorization Code + PKCE

Users authenticate via authentik's own OIDC provider. The frontend is a public client — no client secret. Token exchange (code → access token) happens browser-side. No `/auth/callback` endpoint on the Rust backend.

### 6.2 + 6.3 — Token storage and validation

Fully delegated to authentik OIDC. The frontend stores tokens per OIDC standards (sessionStorage acceptable). The backend validates the Bearer token by calling authentik's userinfo endpoint (`/application/o/<app-slug>/userinfo/`) with a 60-second in-memory cache keyed by token hash.

### 6.4 — Eager loading on StructurePage

All group details (including members) are fetched eagerly on page load. Max scale is ~300 users. The backend should expose `GET /api/groups?include_members=true` that returns full `GroupDetail` for every group in one response, so the frontend makes a single request.

**Add this endpoint to §1.2:**

`GET /api/groups?include_members=true` — same as `GET /api/groups` but each `GroupSummary` is replaced with a full `GroupDetail` (leader object, managers array, members array). The backend fetches all groups from authentik, then batch-fetches all user objects (deduplicated across groups), assembles the response.

### 6.5 — Visibility unrestricted

All authenticated users can see all groups, all members, all emails. No filtering by membership.

### 6.6 — Previous leader becomes a regular member

When `PUT /api/groups/{group_pk}/leader` is called, the previous leader's UUID is removed from `attributes.leader`. They remain in `group.users` and are not added to `attributes.managers`. They become a plain member.

### 6.7 — Subgroup creator is auto-assigned as leader

When `POST /api/groups/{group_pk}/subgroups` creates a new group, the backend immediately sets `attributes.leader = <calling_user_uuid>` and adds the calling user to the new group's `users` list. A `PATCH` to the new group is made immediately after creation.

**Updated response body** for `POST /api/groups/{group_pk}/subgroups`:

```
{
  "pk": string (UUID),
  "name": string,
  "leader_uuid": string (UUID)   // always the calling user's UUID
}
```

### 6.8 — Role inheritance: leaders inherit authority over direct children only

A leader of group G has implicit `leader`-level authority over all **direct children** of G (groups where G is in their `parents` list). This inheritance does NOT recurse — a leader of G has no implicit authority over grandchildren.

**Updated role resolution algorithm (§3):**

Add step 3.5 after checking the group's own attributes: if the subject user is not leader/manager/member of the target group, check each of the target group's parent groups — if the subject user is `leader` of any direct parent, treat them as `leader` of the target group for authorization purposes.

This means:
- Role displayed to the UI for the user's own profile (`GET /api/users/me`) still shows only explicit roles.
- Authorization checks in endpoint handlers use the extended algorithm (direct parent leader counts).

### 6.9 — Backend API token provisioned via setup script

The Rust backend requires a long-lived authentik API token with permissions to read/write users and groups. A setup script (`scripts/setup-authentik.sh`) will:
1. Wait for authentik to be healthy
2. Use the authentik bootstrap admin credentials to create a service account user
3. Generate an API token for that service account
4. Write the token to `.env` as `AUTHENTIK_API_TOKEN`

The backend reads `AUTHENTIK_API_TOKEN` from the environment at startup.

---

*End of design document.*
