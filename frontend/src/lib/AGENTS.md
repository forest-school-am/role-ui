# frontend/src/lib/ — utility helpers

Non-React utilities with no side effects.

`ui-constants.ts` — Tailwind class-name constants shared across
components. Centralising them here prevents class-string drift when the
design changes. Import from this file rather than inlining the same
string in multiple components.
