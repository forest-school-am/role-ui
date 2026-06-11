# Show this help
[default]
help:
  @just --list app

# Build Rust backend (release) + Vite frontend
[parallel]
build: build-backend build-frontend


# Build frontend
build-frontend:
    cd frontend && npm run build

# Build backend
build-backend:
    cargo build --release --manifest-path backend/Cargo.toml


# Start Rust backend + Vite watch build; Ctrl+C stops both
up:
    #!/usr/bin/env bash
    set -euo pipefail

    cargo build --manifest-path backend/Cargo.toml
    pkill -f "target/debug/server" || true
    pkill -f "vite build --watch" || true

    cd frontend && npx vite build --watch >> /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!

    RUST_LOG="server=debug,tower_http=debug" \
    AUTHENTIK_BASE_URL="http://localhost:9000" \
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" \
    BACKEND_PORT="${BACKEND_PORT}" \
    OIDC_CLIENT_ID="roleui" \
    OIDC_REDIRECT_URI="http://localhost:8080/auth/callback" \
    STATIC_DIR="{{ justfile_directory() }}/frontend/dist" \
    backend/target/debug/server >> /tmp/backend.log 2>&1 &
    BACKEND_PID=$!

    echo "Frontend PID ${FRONTEND_PID} → /tmp/frontend.log"
    echo "Backend    PID ${BACKEND_PID} → /tmp/backend.log"
    echo "Ctrl+C to stop."

    cleanup() {
        echo "Shutting down…"
        kill "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
        wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    }
    trap cleanup EXIT INT TERM

    wait

# Stop backend and vite watch build
down:
    pkill -f "target/debug/server" || true
    pkill -f "vite build --watch" || true

# Tail both log files together
logs:
    tail -f /tmp/backend.log /tmp/frontend.log

# Run fallow (frontend dead code + duplication) and clippy (Rust lints)
lint:
    #!/usr/bin/env bash
    rc=0
    echo "── eslint ──────────────────────────────────────────────────"
    (cd frontend && npm run lint) || rc=1
    echo ""
    echo "── fallow ──────────────────────────────────────────────────"
    (cd frontend && npx fallow) || rc=1
    echo ""
    echo "── clippy ──────────────────────────────────────────────────"
    cargo clippy --manifest-path backend/Cargo.toml -- -W clippy::all -W dead_code || rc=1
    exit $rc

