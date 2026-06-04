#!/usr/bin/env bash
# setup-authentik.sh
#
# Creates a service-account API token in authentik and writes it to .env.
#
# Usage:
#   AUTHENTIK_BOOTSTRAP_TOKEN=<your-bootstrap-token> ./scripts/setup-authentik.sh
#
# The bootstrap token is the value you set as AUTHENTIK_BOOTSTRAP_TOKEN in
# docker-compose.yml (passed to the authentik server on first boot). Authentik
# registers it automatically and it can be used immediately for API calls.
#
# Alternatively, set AUTHENTIK_BASE_URL to override the default localhost:9000.

set -euo pipefail

AUTHENTIK_BASE_URL="${AUTHENTIK_BASE_URL:-http://localhost:9000}"
HEALTH_URL="${AUTHENTIK_BASE_URL}/-/health/ready/"
ENV_FILE="${ENV_FILE:-.env}"
SERVICE_ACCOUNT_NAME="${SERVICE_ACCOUNT_NAME:-roleui-backend}"
TOKEN_IDENTIFIER="${TOKEN_IDENTIFIER:-roleui-backend-token}"
MAX_RETRIES=60
RETRY_INTERVAL=5

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
warn()    { echo "[WARN]  $*" >&2; }
error()   { echo "[ERROR] $*" >&2; exit 1; }

require_cmd() {
    command -v "$1" >/dev/null 2>&1 || error "Required command '$1' not found. Please install it."
}

require_cmd curl
require_cmd jq

# ---------------------------------------------------------------------------
# Step 1 — Require bootstrap token
# ---------------------------------------------------------------------------

if [[ -z "${AUTHENTIK_BOOTSTRAP_TOKEN:-}" ]]; then
    echo ""
    echo "================================================================"
    echo " AUTHENTIK_BOOTSTRAP_TOKEN is not set."
    echo ""
    echo " To use this script automatically, set the token before running:"
    echo ""
    echo "   export AUTHENTIK_BOOTSTRAP_TOKEN=<your-token>"
    echo "   ./scripts/setup-authentik.sh"
    echo ""
    echo " The bootstrap token is the value you put in AUTHENTIK_BOOTSTRAP_TOKEN"
    echo " in your .env file (or docker-compose env). Authentik registers it on"
    echo " first boot."
    echo ""
    echo " Alternatively, create the token manually:"
    echo "   1. Open http://localhost:9000 and log in as admin."
    echo "   2. Go to Directory → Tokens & App passwords."
    echo "   3. Create a new token (intent: API) for a service account user."
    echo "   4. Copy the token key and add it to your .env:"
    echo "      AUTHENTIK_API_TOKEN=<paste-token-here>"
    echo "================================================================"
    echo ""
    exit 1
fi

BOOTSTRAP_TOKEN="${AUTHENTIK_BOOTSTRAP_TOKEN}"

# ---------------------------------------------------------------------------
# Step 2 — Wait for authentik to be ready
# ---------------------------------------------------------------------------

info "Waiting for authentik at ${HEALTH_URL} ..."
attempt=0
until curl -sf "${HEALTH_URL}" >/dev/null 2>&1; do
    attempt=$((attempt + 1))
    if [[ $attempt -ge $MAX_RETRIES ]]; then
        error "authentik did not become ready after $((MAX_RETRIES * RETRY_INTERVAL))s. Is it running?"
    fi
    info "  Not ready yet (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${RETRY_INTERVAL}s..."
    sleep "${RETRY_INTERVAL}"
done
success "authentik is ready."

# ---------------------------------------------------------------------------
# Step 3 — Check if the token already exists
# ---------------------------------------------------------------------------

info "Checking for existing token '${TOKEN_IDENTIFIER}' ..."
existing=$(curl -sf \
    -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
    "${AUTHENTIK_BASE_URL}/api/v3/core/tokens/?identifier=${TOKEN_IDENTIFIER}" \
    | jq -r '.results[0].key // empty') || true

if [[ -n "$existing" ]]; then
    success "Token '${TOKEN_IDENTIFIER}' already exists."
    API_TOKEN="$existing"
else
    # -----------------------------------------------------------------------
    # Step 4 — Find or create the service account user
    # -----------------------------------------------------------------------

    info "Looking for service account user '${SERVICE_ACCOUNT_NAME}' ..."
    user_pk=$(curl -sf \
        -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
        "${AUTHENTIK_BASE_URL}/api/v3/core/users/?username=${SERVICE_ACCOUNT_NAME}&type=service_account" \
        | jq -r '.results[0].pk // empty') || true

    if [[ -z "$user_pk" ]]; then
        info "Creating service account user '${SERVICE_ACCOUNT_NAME}' ..."
        user_pk=$(curl -sf \
            -X POST \
            -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "{\"username\": \"${SERVICE_ACCOUNT_NAME}\", \"name\": \"Role UI Backend\", \"type\": \"service_account\", \"path\": \"goauthentik.io/serviceaccounts\"}" \
            "${AUTHENTIK_BASE_URL}/api/v3/core/users/" \
            | jq -r '.pk') || error "Failed to create service account user."
        success "Created service account user (pk=${user_pk})."
    else
        success "Found existing service account user (pk=${user_pk})."
    fi

    # -----------------------------------------------------------------------
    # Step 5 — Create the API token
    # -----------------------------------------------------------------------

    info "Creating API token '${TOKEN_IDENTIFIER}' ..."
    token_response=$(curl -sf \
        -X POST \
        -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
        -H "Content-Type: application/json" \
        -d "{\"identifier\": \"${TOKEN_IDENTIFIER}\", \"intent\": \"api\", \"user\": ${user_pk}, \"description\": \"Role UI backend service account token\"}" \
        "${AUTHENTIK_BASE_URL}/api/v3/core/tokens/") \
        || error "Failed to create API token. Check that your bootstrap token has admin permissions."

    # Retrieve the actual key (requires a separate view-key call)
    API_TOKEN=$(curl -sf \
        -X POST \
        -H "Authorization: Bearer ${BOOTSTRAP_TOKEN}" \
        "${AUTHENTIK_BASE_URL}/api/v3/core/tokens/${TOKEN_IDENTIFIER}/view_key/" \
        | jq -r '.key') \
        || error "Failed to retrieve API token key."

    success "Created API token '${TOKEN_IDENTIFIER}'."
fi

# ---------------------------------------------------------------------------
# Step 6 — Write token to .env
# ---------------------------------------------------------------------------

if [[ -f "${ENV_FILE}" ]]; then
    if grep -q "^AUTHENTIK_API_TOKEN=" "${ENV_FILE}"; then
        # Replace existing (possibly empty) value
        sed -i "s|^AUTHENTIK_API_TOKEN=.*|AUTHENTIK_API_TOKEN=${API_TOKEN}|" "${ENV_FILE}"
        success "Updated AUTHENTIK_API_TOKEN in ${ENV_FILE}."
    else
        echo "AUTHENTIK_API_TOKEN=${API_TOKEN}" >> "${ENV_FILE}"
        success "Appended AUTHENTIK_API_TOKEN to ${ENV_FILE}."
    fi
else
    warn "${ENV_FILE} not found. Creating it with just the token."
    echo "AUTHENTIK_API_TOKEN=${API_TOKEN}" > "${ENV_FILE}"
fi

echo ""
echo "================================================================"
echo " Setup complete!"
echo ""
echo " AUTHENTIK_API_TOKEN has been written to ${ENV_FILE}."
echo " Restart the Rust backend to pick up the new token."
echo "================================================================"
echo ""
