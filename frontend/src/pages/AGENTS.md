# frontend/src/pages/ — route-level pages

Thin route entry points. Each page owns:
- Route-specific state (panel open/closed, URL params).
- A single data query via TanStack Query.
- Rendering of the canonical component from `components/`.

Pages should not contain domain logic. If a piece of logic would be
useful to a panel or another page, move it into the component or a hook.

## Pages

`StructurePage` (`/structure`) — Fetches all groups, renders `DAGCanvas`
and the floating preview panels. Manages which panel is open via
`PanelState` discriminated union.

`GroupPage` (`/groups/:name`) — Fetches one group by name and renders
`GroupPage` (the component). Also hosts `GroupModalsRenderer`.

`PersonalPage` (`/me`, `/users/:username`) — Fetches the target user
and renders `UserPage`. The `/me` route resolves the current user's
username from `useAuth()`.
