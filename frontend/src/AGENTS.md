# frontend/src/ — application source

## Module responsibilities

| Directory | Responsibility |
|---|---|
| `api/` | API client layer — generated code + manual wrappers |
| `auth/` | OIDC auth flow, auth context, superuser context |
| `components/` | Reusable UI components grouped by domain |
| `pages/` | Route-level page components (thin wrappers around components) |
| `hooks/` | Custom React hooks |
| `layouts/` | Shell layout components |
| `lib/` | Utility functions |
| `types.ts` | Shared TypeScript types (mirrors the generated API types where needed) |
| `config.ts` | Reads `window.__CONFIG__` injected by the backend |
| `App.tsx` | Root component; sets up React Router routes |
| `main.tsx` | Entry point; mounts `QueryClientProvider`, `BrowserRouter`, `AuthProvider` |

## Component canon

One canonical component per object type, used everywhere that object appears in a list or card. Before creating a new component, check if one already exists for the same object. See `components/AGENTS.md` for the inventory.
