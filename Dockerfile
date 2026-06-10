# Build context is the repo root.
# Sibling Rust crates are fetched as pinned git dependencies by cargo.

# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./

# Vite env vars are baked into the JS bundle at build time.
ARG VITE_AUTHENTIK_BASE_URL
ARG VITE_OIDC_CLIENT_ID
ARG VITE_OIDC_REDIRECT_URI
ARG VITE_OIDC_SLUG=roleui
ARG VITE_BACKEND_URL
ENV VITE_AUTHENTIK_BASE_URL=$VITE_AUTHENTIK_BASE_URL \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID \
    VITE_OIDC_REDIRECT_URI=$VITE_OIDC_REDIRECT_URI \
    VITE_OIDC_SLUG=$VITE_OIDC_SLUG \
    VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS backend
WORKDIR /build
COPY backend/ ./backend/
WORKDIR /build/backend
RUN cargo build --release

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
