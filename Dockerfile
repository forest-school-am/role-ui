# Build context is the repo root.
# Sibling Rust crates are fetched as pinned git dependencies by cargo.

# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./

RUN npm run build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS backend
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY backend/ ./backend/
WORKDIR /build/backend
# github_token secret is mounted at /run/secrets/github_token and used only
# during this RUN step — it is never written into an image layer.
RUN --mount=type=secret,id=github_token \
    TOKEN=$(cat /run/secrets/github_token) \
    && git config --global url."https://x-access-token:${TOKEN}@github.com/".insteadOf "https://github.com/" \
    && cargo build --release \
    && git config --global --remove-section "url.https://x-access-token:${TOKEN}@github.com/"

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /build/backend/target/release/server ./server
COPY --from=frontend /build/dist ./static

ENV STATIC_DIR=/app/static \
    BACKEND_PORT=8080

EXPOSE 8080
CMD ["/app/server"]
