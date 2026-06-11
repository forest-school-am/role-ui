# docker/ — container build and compose stacks

Two separate concerns live here:

**Dev stack (`composes/authentik.yml`)** — runs Postgres, Redis, and authentik (server + worker) locally. Managed via `just authentik up/down/reset`. The `.env` in the repo root supplies all env vars (passwords, secret key, bootstrap credentials).

**Deploy compose (`composes/app.yml`)** — runs only the role-UI app container against an existing authentik instance. Pulls the pre-built image from GHCR. Uses `app.env.example` as the template for its `.env`.

**`Dockerfile`** — multi-stage production build:
1. `node:22-alpine` builds the frontend (`npm run build`)
2. `rust:1-slim-bookworm` builds the backend (`cargo build --release`)
3. `debian:bookworm-slim` is the runtime image

Build context is always the **repo root** (so `COPY backend/` and `COPY frontend/` resolve correctly). The `.dockerignore` lives next to the `Dockerfile` and is picked up automatically by modern Docker/BuildKit.

CI builds and pushes the image via `.github/workflows/docker-publish.yml`.

## Things to watch

- The authentik compose uses a **patched image** (`authentik-patched:2026.5.2`) — this must be built locally before first use; it is not on a public registry.
- Do not change the postgres/redis service names — they are used as hostnames inside the docker network by the authentik server/worker.
