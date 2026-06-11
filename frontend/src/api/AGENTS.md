# frontend/src/api/ — API client layer

## Files

`generated/api.ts` — **AUTO-GENERATED** by `npx orval` from `../../../api-spec.yaml`. Never edit manually. Regenerate whenever the spec changes.

`generated/index.ts` — **MANUAL**. Destructures every function from the single `getAuthentikRoleUIBackend()` call and re-exports them as named exports. Must be updated by hand after each orval run that adds new operations.

Everything else is a thin manual wrapper:
- Hides generated parameter shapes behind clean function signatures.
- Keeps query functions as plain `() => Promise<T>` so they work directly as TanStack Query `queryFn`.
- Groups by resource: `users.ts`, `groups.ts`, `groupQueryHelpers.ts`.

## Pattern for adding a new endpoint

1. Add to `api-spec.yaml`.
2. Run `npx orval` — `generated/api.ts` is updated.
3. Add the new function name to the destructure list in `generated/index.ts`.
4. Write a wrapper in the appropriate `*.ts` file and re-export it.
