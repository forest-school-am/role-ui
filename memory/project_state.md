---
name: project-state
description: Current implementation state of the Authentik Role UI project
metadata:
  type: project
---

Scaffolding complete as of 2026-06-04. Both backend and frontend compile cleanly.

**Why:** Multi-agent project building a UI layer on top of authentik identity provider.

**How to apply:** Use this to orient agents on what exists before giving them implementation tasks.

## Backend (Rust/axum)
- Location: `/home/dev/autentik-role-UI/backend/`
- `cargo check` passes (9 unused-variable warnings, expected)
- All files present: config, error, models, auth middleware, authentik client, route stubs
- Uses `rustls-tls` instead of OpenSSL (no OpenSSL headers in env)
- All 8 API endpoints stubbed, no business logic yet

## Frontend (React/TypeScript/Vite)
- Location: `/home/dev/autentik-role-UI/frontend/`
- `npm run build` passes (0 TS errors)
- All components implemented: CrownIcon, GroupTag, UserCard, GroupMemberItem, GroupNode, DAGCanvas, GroupDetailPanel
- Auth layer: PKCE OIDC flow with sessionStorage
- API layer: axios with token injection
- Pages: PersonalPage, StructurePage, OAuthCallback

## Infrastructure
- `docker-compose.yml` at repo root: PostgreSQL 16, Redis 7, authentik server+worker (2024.10.5)
- `scripts/setup-authentik.sh` creates service account + API token
- `.env.example` at root; `frontend/.env.example` for frontend

## Next steps
1. Start authentik Docker env and run setup script
2. Implement backend route handlers (business logic)
3. Wire frontend to live backend
4. Tester validates end-to-end
