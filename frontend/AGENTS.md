# frontend/ — React/TypeScript SPA

Vite build; served as static files by the Rust backend in production. In dev, `vite build --watch` rebuilds on change and the backend's `ServeDir` picks up the output.

## Key facts

- React 19 + TypeScript + Tailwind CSS + shadcn/ui
- TanStack Query v5 for server state; React Router v6 for navigation
- React Flow for the group DAG view
- Tests: Vitest + Testing Library (`npm test`)
- Linting: ESLint + fallow (`npx fallow`) for dead code

## API client

`src/api/generated/api.ts` is **auto-generated** by orval from `../api-spec.yaml`. Never edit it.
`src/api/generated/index.ts` is **manual** — destructures all functions from `getAuthentikRoleUIBackend()`. Must be updated by hand when new endpoints are added to the spec.
Thin wrappers in `src/api/*.ts` provide the final exported API (hide generated types, adapt signatures).

## Query key conventions

| Key | Data |
|---|---|
| `['me']` | Current user (from `GET /api/users/me`) |
| `['user', username]` | Any user by username |
| `['groups']` | All groups list |
| `['group', groupName]` | Single group detail |

After a mutation use `queryClient.refetchQueries(...)` (not `invalidateQueries`) for immediate UI update.

## Runtime config

The backend injects `window.__CONFIG__` into `index.html` at startup. `src/config.ts` reads it. No build-time env vars needed for OIDC or authentik URL.
