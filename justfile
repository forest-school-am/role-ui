set dotenv-load

# Show this help
help:
    @just --list
# ---------------------------------------------------------------------------
# Subcommand dispatchers
# ---------------------------------------------------------------------------

# Manage the authentik docker-compose stack  (up | down | reset)
authentik cmd='help':
    @just _authentik-{{cmd}}

# Manage the local app (Rust backend + frontend build)  (up | logs)
app cmd='help':
    @just _app-{{cmd}}

# ---------------------------------------------------------------------------
# Standalone recipes (still useful individually)
# ---------------------------------------------------------------------------

# Create service account + OIDC app using the bootstrap token
_authentik-setup:
    #!/usr/bin/env bash
    set -euo pipefail
    AUTHENTIK_BOOTSTRAP_TOKEN="${AUTHENTIK_BOOTSTRAP_TOKEN}" bash scripts/setup-authentik.sh

# Create 10 test users + groups using the API token
_authentik-seed:
    #!/usr/bin/env bash
    set -euo pipefail
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" bash scripts/seed-test-data.sh

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

# Build the frontend once (Vite/React → frontend/dist/)
build:
    cd frontend && npm run build

# Start the Vite dev server (hot-reload, accessible on all interfaces)
dev:
    cd frontend && npm run dev -- --host 0.0.0.0

# ---------------------------------------------------------------------------
# Private: authentik subcommands
# ---------------------------------------------------------------------------

_authentik-help:
    @echo ""
    @echo "just authentik <cmd>"
    @echo ""
    @echo "  up     start containers, preserving existing data"
    @echo "  down   stop containers, preserving data (no volume wipe)"
    @echo "  reset  full wipe → start → wait for health → setup → seed"
    @echo ""

# Start the authentik stack (postgres + redis + server + worker)
_authentik-up:
    docker compose up -d

# Stop containers without wiping data
_authentik-down:
    docker compose stop

# Full wipe and rebuild: stop+wipe volumes → start → wait for health → setup → seed
_authentik-reset:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose down -v
    docker compose up -d
    echo "Waiting for authentik to become healthy…"
    until curl -sf http://localhost:9000/-/health/ready/ >/dev/null 2>&1; do
        sleep 5
    done
    echo "Authentik is healthy."
    just authentik setup
    # Re-source .env so seed gets the token just written by setup
    set -a; source .env; set +a
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" just authentik seed

# ---------------------------------------------------------------------------
# Private: app subcommands
# ---------------------------------------------------------------------------

_app-help:
    @echo ""
    @echo "just app <cmd>"
    @echo ""
    @echo "  up     start backend + vite watch build in background"
    @echo "  down   stop backend + vite watch build"
    @echo "  logs   tail /tmp/backend.log and /tmp/frontend.log"
    @echo ""

# Start Rust backend + Vite watch build concurrently in the background
_app-up:
    #!/usr/bin/env bash
    set -euo pipefail
    pkill -f "target/debug/server" || true

    cd frontend && npx vite build --watch >> /tmp/frontend.log 2>&1 &
    FRONTEND_PID=$!

    AUTHENTIK_BASE_URL="http://localhost:9000" \
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" \
    BACKEND_PORT="${BACKEND_PORT}" \
    STATIC_DIR="{{ justfile_directory() }}/frontend/dist" \
    backend/target/debug/server >> /tmp/backend.log 2>&1 &
    BACKEND_PID=$!

    echo "Frontend build watch started (PID ${FRONTEND_PID}), logging to /tmp/frontend.log"
    echo "Backend started            (PID ${BACKEND_PID}), logging to /tmp/backend.log"

# Stop backend and vite watch build
_app-down:
    pkill -f "target/debug/server" || true
    pkill -f "vite build --watch" || true

# Tail both log files together
_app-logs:
    tail -f /tmp/backend.log /tmp/frontend.log
