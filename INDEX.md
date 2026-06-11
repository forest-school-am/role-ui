# Root index

| Item | Description |
|---|---|
| `backend/` | Rust/Axum HTTP server — route handlers, extractors, authentik state cache |
| `frontend/` | React/TypeScript SPA — group DAG, user profile, TanStack Query data layer |
| `docker/` | Dockerfiles and Docker Compose stacks |
| `scripts/` | SQL migrations and shell scripts for setup/seeding |
| `api-spec.yaml` | OpenAPI spec — source of truth for all backend endpoints; frontend client is generated from it |
| `justfile` | Top-level just entry point; imports `app.just` and `authentik.just` modules |
| `app.just` | Recipes for running, building, and linting the application locally |
| `authentik.just` | Recipes for managing the authentik Docker stack |
| `.env` | Local secrets (gitignored) — see `.env.example` for required keys |
| `.env.example` | Template for the authentik-stack `.env` |
| `app.env.example` | Template for the app-only runtime `.env` (production deploy) |
| `CLAUDE.md` | Coding instructions for Claude — patterns to follow when modifying this repo |
| `AGENTS.md` | This repo's agent navigation guide and project overview |
| `flake.nix` | Nix dev shell (Rust toolchain, Node, just, etc.) |
| `.cargo/config.toml` | Cargo configuration (linker flags, etc.) |
| `.github/workflows/` | CI/CD — Docker image build and publish to GHCR |
