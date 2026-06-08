# ── Stage 1: Build frontend ───────────────────────────────────────────────────
FROM node:22-alpine AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Build backend ────────────────────────────────────────────────────
FROM rust:1-slim-bookworm AS backend
WORKDIR /build
COPY backend/ ./
RUN cargo build --release

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend /build/target/release/server ./server
COPY --from=frontend /build/dist ./static

ENV STATIC_DIR=/app/static \
    BACKEND_PORT=8080

EXPOSE 8080
CMD ["/app/server"]
