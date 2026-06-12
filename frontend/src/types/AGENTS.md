# frontend/src/types/ — shared TypeScript types

`index.ts` is the single source of truth for types used across more
than one module. It re-exports from the generated API client rather
than defining its own copies, so changes to the spec propagate
automatically.

## Rules

- Re-export generated types rather than duplicating them.
- Frontend-only types (UI state, component props) live here only when
  they are used in more than one unrelated module. If a type is only
  ever used in one component, define it in that file.
- `GroupDetail` extends the API `Group` type with `is_virtual?: boolean`
  (a front-end-only flag added for virtual groups shown in the DAG).
