# frontend/src/test/ — shared test utilities

`factories.ts` — builder functions for test data. Always use these
rather than constructing raw objects inline, so tests stay correct when
the type shapes change. Current factories: `makeUser`, `makeGroupDetail`.

`setup.ts` — Vitest global setup: imports `@testing-library/jest-dom`
matchers so `expect(...).toBeInTheDocument()` etc. are available in
every test file without an explicit import.
