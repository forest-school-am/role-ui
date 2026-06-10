# Build context must be the workspace root (one level above this repo) so that
# sibling crates referenced via relative paths in Cargo.toml are available.
# Example: docker build -f authentik-role-UI/Dockerfile ..

# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY authentik-role-UI/frontend/package.json authentik-role-UI/frontend/package-lock.json ./
RUN npm ci
COPY authentik-role-UI/frontend/ ./

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
# Sibling crates referenced as ../../<name> from the backend directory
COPY authentik_api_2026_5_2/ ./authentik_api_2026_5_2/
COPY authentik_forest_school_attributes/ ./authentik_forest_school_attributes/
COPY authentik-role-UI/backend/ ./authentik-role-UI/backend/
WORKDIR /build/authentik-role-UI/backend
RUN cargo build --release

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /build/authentik-role-UI/backend/target/release/server ./server
COPY --from=frontend /build/dist ./static

ENV STATIC_DIR=/app/static \
    BACKEND_PORT=8080

EXPOSE 8080
CMD ["/app/server"]
