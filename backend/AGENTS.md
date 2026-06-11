# backend/ — Rust/Axum HTTP server

See `src/AGENTS.md` for the source layout and patterns.

## Key facts

- Binary: `server` (entry point `src/main.rs`)
- Axum 0.8; Tokio async runtime
- No database — all state comes from authentik's API, cached in memory
- Two external crates (git deps in `Cargo.toml`):
  - `authentik-forest-school-attributes` — typed serde structs for all `attributes` fields; **bump its version and update `rev` here whenever you push a breaking change to that crate**
  - `authentik_api_2026_5_2` — generated OpenAPI client for authentik

## Build

```
cargo build                          # debug
cargo build --release                # release (used in Dockerfile)
cargo clippy -- -W clippy::all       # lints
```

Rate-limiting (`tower-governor`) is skipped in debug builds (`#[cfg(debug_assertions)]`).

## Environment variables

All config comes from env vars; see `src/config.rs` for the full list. In dev the `.env` at the repo root is loaded automatically by `just` (`set dotenv-load`).
