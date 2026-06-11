# Show this help
[default]
help:
    @just --list authentik

# Start the authentik stack (postgres + redis + server + worker)
up:
    docker compose -f docker/composes/authentik.yml up -d

# Stop containers without wiping data
down:
    docker compose -f docker/composes/authentik.yml stop

# Full wipe and rebuild: stop+wipe volumes → start → wait for health → setup → seed
reset:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose -f docker/composes/authentik.yml down -v
    docker compose -f docker/composes/authentik.yml up -d
    echo "Waiting for authentik to become healthy…"
    until curl -sf http://localhost:9000/-/health/ready/ >/dev/null 2>&1; do
        sleep 5
    done
    echo "Authentik is healthy."
    just authentik setup
    # Re-source .env so seed gets the token just written by setup
    set -a; source docker/.env; set +a
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" just authentik seed

# ---------------------------------------------------------------------------
# Standalone recipes (still useful individually)
# ---------------------------------------------------------------------------

# Create service account + OIDC app using the bootstrap token
setup:
    #!/usr/bin/env bash
    set -euo pipefail
    AUTHENTIK_BOOTSTRAP_TOKEN="${AUTHENTIK_BOOTSTRAP_TOKEN}" bash scripts/setup-authentik.sh

# Apply custom SQL migrations against the authentik PostgreSQL container
migrate:
    #!/usr/bin/env bash
    set -euo pipefail
    docker compose -f docker/composes/authentik.yml exec -T postgresql \
        psql \
        --username="${AUTHENTIK_POSTGRESQL__USER}" \
        --dbname="${AUTHENTIK_POSTGRESQL__NAME}" \
        < scripts/migrate-gws-uniqueness.sql

# Create 10 test users + groups using the API token
seed:
    #!/usr/bin/env bash
    set -euo pipefail
    AUTHENTIK_API_TOKEN="${AUTHENTIK_API_TOKEN}" bash scripts/seed-test-data.sh


