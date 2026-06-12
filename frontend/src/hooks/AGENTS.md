# frontend/src/hooks/ — custom React hooks

Hooks that encapsulate cross-cutting logic not tied to a specific
component or domain module.

## Hooks

`useCallerRole(groupName)` — returns the current user's role in a
specific group (`'leader' | 'manager' | 'member' | null`). Used to
gate operations that require a minimum privilege level.

`useGroupModals()` — manages a single active modal name for group pages.
Replaces multiple `useState(false)` booleans with one discriminated
union: `{ activeModal, open(name), close() }`.

`useDebounce(value, delay)` — returns a debounced copy of `value`.
Used in search inputs to avoid firing a query on every keystroke.

`useEscapeKey(callback)` — calls `callback` when the Escape key is
pressed. Used to close panels and modals without coupling them to a
specific key-listener location.
