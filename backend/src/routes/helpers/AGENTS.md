# backend/src/routes/helpers/ — Axum extractors

All application-specific `FromRequestParts` implementations live here. Add new extractors here rather than parsing inline inside handlers.

`mod.rs` re-exports everything. `extractors.rs` contains the implementations.

Key design points:
- Extractors run in the order they appear in the handler signature.
- `FreshCache` must be first in any handler that needs a consistent cache snapshot.
- `WriteLock` sets dirty=true when extracted (before the handler body runs), so concurrent reads block immediately.
- `WriteFlag` is inserted by `invalidate_on_write` middleware; `WriteLock` flips it to trigger a post-response cache refresh.
