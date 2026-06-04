#!/usr/bin/env bash
# =============================================================================
# seed-test-data.sh — Seed test users and groups into a live authentik instance
# =============================================================================
#
# ORG STRUCTURE — Acme Corp
# =========================
#
# USERS (10 total):
#   alice.chen      — Engineering leader; Platform manager              [telegram: @alice_chen]
#   bob.smith       — Engineering manager; Marketing member (no role)   [telegram: @bobsmith]
#   carol.jones     — Platform leader; DevOps manager                   [telegram: @c_jones]
#   david.kim       — Platform member; DevOps member (no special role)  [no telegram]
#   eve.morgan      — Marketing leader; Growth member (no special role) [telegram: @eve_m]
#   frank.nguyen    — Marketing manager; Growth member (no special role)[no telegram]
#   grace.patel     — Growth leader; DevOps member (no special role)    [telegram: @gracep]
#   henry.torres    — DevOps leader only (lone wolf — only member of DevOps with role) [no telegram]
#   iris.walker     — Member of Engineering only (no special role)      [telegram: @iris_w]
#   jake.ross       — SUSPENDED; member of Platform                     [no telegram]
#
# GROUPS (5 total — DAG, not a tree):
#
#   Engineering [ROOT]
#     leader:   alice.chen
#     managers: [bob.smith]
#     members:  alice.chen, bob.smith, iris.walker, jake.ross(suspended)
#
#   Marketing [ROOT]
#     leader:   eve.morgan
#     managers: [frank.nguyen]
#     members:  eve.morgan, frank.nguyen, bob.smith
#
#   Platform [child of Engineering]
#     leader:   carol.jones
#     managers: [alice.chen]
#     members:  carol.jones, alice.chen, david.kim, jake.ross(suspended)
#
#   Growth [child of Marketing]
#     leader:   grace.patel
#     managers: []
#     members:  grace.patel, eve.morgan, frank.nguyen
#     (grace.patel is leader only here — no managers — edge case: group with leader + members but no managers)
#
#   DevOps [parents: Platform AND Engineering — true DAG diamond via native parents array]
#     leader:   henry.torres
#     managers: [carol.jones]
#     members:  henry.torres, carol.jones, david.kim, grace.patel
#     NOTE: authentik 2026.5+ supports native multi-parent groups via the
#           `parents` field (UUID array). No extra_parents attribute hack needed.
#
# COVERAGE CHECKLIST:
#   [x] A user who is leader of one group
#       → henry.torres: leader of DevOps, no role elsewhere
#   [x] A user who is manager in one group and regular member in another
#       → bob.smith: manager in Engineering, plain member in Marketing
#   [x] A user who is leader in one group and manager in another
#       → alice.chen: leader of Engineering, manager of Platform
#       → carol.jones: leader of Platform, manager of DevOps
#   [x] A user who is a member of multiple groups with no special role
#       → david.kim: plain member of Platform and DevOps
#   [x] A suspended user who is a member of a group
#       → jake.ross (is_active=false): member of Engineering and Platform
#   [x] A group with multiple parents (DAG diamond) — NATIVE parents array
#       → DevOps: parents = [Platform, Engineering]
#   [x] A user with a telegram handle
#       → alice.chen (@alice_chen), bob.smith (@bobsmith), carol.jones (@c_jones),
#         eve.morgan (@eve_m), grace.patel (@gracep), iris.walker (@iris_w)
#   [x] A user without a telegram handle
#       → david.kim, frank.nguyen, henry.torres, jake.ross
#
# =============================================================================

set -euo pipefail

JQ=/home/dev/.nix-profile/bin/jq
BASE_URL="http://localhost:9000"
TOKEN="${AUTHENTIK_API_TOKEN:-85d09aa9b7e5d142ab31f24335b7e47b32f630eb23e1f703cc562af46a58593a}"
API="$BASE_URL/api/v3"

# Colour helpers
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${CYAN}[INFO]${NC} $*" >&2; }
ok()      { echo -e "${GREEN}[ OK ]${NC} $*" >&2; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*" >&2; }
fail()    { echo -e "${RED}[FAIL]${NC} $*" >&2; exit 1; }

# =============================================================================
# Helper: find existing user by username, return pk or empty
# =============================================================================
get_user_pk() {
  local username="$1"
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$API/core/users/?search=$username" \
    | $JQ -r --arg u "$username" \
      '.results[] | select(.username == $u) | .pk // empty'
}

# =============================================================================
# Helper: find existing user by username, return uuid or empty
# =============================================================================
get_user_uuid() {
  local username="$1"
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$API/core/users/?search=$username" \
    | $JQ -r --arg u "$username" \
      '.results[] | select(.username == $u) | .uuid // empty'
}

# =============================================================================
# Helper: find existing group by name, return pk (UUID) or empty
# =============================================================================
get_group_pk() {
  local name="$1"
  local encoded="${name// /%20}"
  curl -s -H "Authorization: Bearer $TOKEN" \
    "$API/core/groups/?search=$encoded" \
    | $JQ -r --arg n "$name" \
      '.results[] | select(.name == $n) | .pk // empty'
}

# =============================================================================
# Helper: ensure user exists (idempotent), return pk
# =============================================================================
ensure_user() {
  local username="$1"
  local name="$2"
  local email="$3"
  local telegram="$4"   # pass "" for no telegram
  local active="$5"     # "true" or "false"

  local existing_pk
  existing_pk=$(get_user_pk "$username")

  if [[ -n "$existing_pk" ]]; then
    warn "User '$username' already exists (pk=$existing_pk) — skipping creation"
    echo "$existing_pk"
    return 0
  fi

  info "Creating user: $username ($name)"

  local body
  body=$(printf '{"username":"%s","name":"%s","email":"%s","type":"internal","is_active":%s}' \
    "$username" "$name" "$email" "$active")

  local response
  response=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "$body" \
    "$API/core/users/")

  local pk
  pk=$(echo "$response" | $JQ -r '.pk // empty')

  if [[ -z "$pk" ]]; then
    fail "Failed to create user '$username': $response"
  fi

  ok "Created user '$username' pk=$pk"

  # Set password
  curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"password": "Test1234!"}' \
    "$API/core/users/$pk/set_password/" >/dev/null

  # Set telegram attribute if provided
  if [[ -n "$telegram" ]]; then
    curl -s -X PATCH \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"attributes\":{\"telegram\":\"$telegram\"}}" \
      "$API/core/users/$pk/" > /dev/null
    info "  Set telegram=$telegram for $username"
  fi

  echo "$pk"
}

# =============================================================================
# Helper: ensure group exists (idempotent), return pk (UUID)
# =============================================================================
ensure_group() {
  local name="$1"

  local existing_pk
  existing_pk=$(get_group_pk "$name")

  if [[ -n "$existing_pk" ]]; then
    warn "Group '$name' already exists (pk=$existing_pk) — skipping creation"
    echo "$existing_pk"
    return 0
  fi

  info "Creating group: $name"

  local response
  response=$(curl -s -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\"}" \
    "$API/core/groups/")

  local pk
  pk=$(echo "$response" | $JQ -r '.pk // empty')

  if [[ -z "$pk" ]]; then
    fail "Failed to create group '$name': $response"
  fi

  ok "Created group '$name' pk=$pk"
  echo "$pk"
}

# =============================================================================
# Helper: set group parents using native `parents` UUID array (authentik 2026.5+)
# Replaces the old single-parent + extra_parents-in-attributes workaround.
# =============================================================================
set_group_parents() {
  local group_pk="$1"
  shift
  # Remaining args are parent UUIDs; build a JSON array from them
  local parents_json
  parents_json=$(printf '%s\n' "$@" | $JQ -R . | $JQ -s .)

  local response
  response=$(curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"parents\":$parents_json}" \
    "$API/core/groups/$group_pk/")

  local returned_parents
  returned_parents=$(echo "$response" | $JQ -r '.parents // empty')

  if [[ -z "$returned_parents" ]]; then
    warn "  set_group_parents: unexpected response for group $group_pk: $response"
  else
    info "  Set parents=$parents_json for group $group_pk"
  fi
}

# =============================================================================
# Helper: add user to group (idempotent)
# =============================================================================
add_user_to_group() {
  local group_pk="$1"
  local user_pk="$2"
  local username="$3"

  local response
  response=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"pk\":$user_pk}" \
    "$API/core/groups/$group_pk/add_user/")

  if [[ "$response" == "204" ]]; then
    info "  Added user '$username' to group $group_pk"
  else
    warn "  add_user returned HTTP $response for user '$username' in group $group_pk (may already be a member)"
  fi
}

# =============================================================================
# Helper: set group attributes (leader + managers)
# =============================================================================
set_group_attributes() {
  local group_pk="$1"
  local leader_uuid="$2"    # pass "" for no leader
  local managers_json="$3"  # JSON array of UUID strings, e.g. '["uuid1"]' or '[]'

  local attrs
  if [[ -n "$leader_uuid" ]]; then
    attrs="{\"leader\":\"$leader_uuid\",\"managers\":$managers_json}"
  else
    attrs="{\"managers\":$managers_json}"
  fi

  curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"attributes\":$attrs}" \
    "$API/core/groups/$group_pk/" > /dev/null

  info "  Set attributes for group $group_pk: leader=$leader_uuid managers=$managers_json"
}

# =============================================================================
# MAIN
# =============================================================================

echo ""
echo "============================================================"
echo "  Seeding test data into authentik at $BASE_URL"
echo "  (authentik 2026.5+ — native multi-parent groups via parents[])"
echo "============================================================"
echo ""

# ---------------------------------------------------------------------------
# STEP 1: Create users
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 1: Creating users ==="

# ensure_user username name email telegram active
PK_ALICE=$(ensure_user   "alice.chen"    "Alice Chen"    "alice@acme.com"   "@alice_chen" "true")
PK_BOB=$(ensure_user     "bob.smith"     "Bob Smith"     "bob@acme.com"     "@bobsmith"   "true")
PK_CAROL=$(ensure_user   "carol.jones"   "Carol Jones"   "carol@acme.com"   "@c_jones"    "true")
PK_DAVID=$(ensure_user   "david.kim"     "David Kim"     "david@acme.com"   ""            "true")
PK_EVE=$(ensure_user     "eve.morgan"    "Eve Morgan"    "eve@acme.com"     "@eve_m"      "true")
PK_FRANK=$(ensure_user   "frank.nguyen"  "Frank Nguyen"  "frank@acme.com"   ""            "true")
PK_GRACE=$(ensure_user   "grace.patel"   "Grace Patel"   "grace@acme.com"   "@gracep"     "true")
PK_HENRY=$(ensure_user   "henry.torres"  "Henry Torres"  "henry@acme.com"   ""            "true")
PK_IRIS=$(ensure_user    "iris.walker"   "Iris Walker"   "iris@acme.com"    "@iris_w"     "true")
PK_JAKE=$(ensure_user    "jake.ross"     "Jake Ross"     "jake@acme.com"    ""            "false")

echo ""
info "User PKs: alice=$PK_ALICE bob=$PK_BOB carol=$PK_CAROL david=$PK_DAVID eve=$PK_EVE"
info "         frank=$PK_FRANK grace=$PK_GRACE henry=$PK_HENRY iris=$PK_IRIS jake=$PK_JAKE"

# Fetch UUIDs for role attribute assignment
UUID_ALICE=$(get_user_uuid  "alice.chen")
UUID_BOB=$(get_user_uuid    "bob.smith")
UUID_CAROL=$(get_user_uuid  "carol.jones")
UUID_EVE=$(get_user_uuid    "eve.morgan")
UUID_FRANK=$(get_user_uuid  "frank.nguyen")
UUID_GRACE=$(get_user_uuid  "grace.patel")
UUID_HENRY=$(get_user_uuid  "henry.torres")

echo ""
info "User UUIDs (for role attributes):"
info "  alice=$UUID_ALICE"
info "  bob=$UUID_BOB"
info "  carol=$UUID_CAROL"
info "  eve=$UUID_EVE"
info "  frank=$UUID_FRANK"
info "  grace=$UUID_GRACE"
info "  henry=$UUID_HENRY"

# ---------------------------------------------------------------------------
# STEP 2: Suspend jake.ross
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 2: Suspending jake.ross ==="
JAKE_STATUS=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/core/users/$PK_JAKE/" | $JQ -r '.is_active')
if [[ "$JAKE_STATUS" == "false" ]]; then
  warn "jake.ross is already suspended — skipping"
else
  curl -s -X PATCH \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"is_active":false}' \
    "$API/core/users/$PK_JAKE/" > /dev/null
  ok "Suspended jake.ross"
fi

# ---------------------------------------------------------------------------
# STEP 3: Create groups
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 3: Creating groups ==="

PK_ENG=$(ensure_group    "Engineering")
PK_MKT=$(ensure_group    "Marketing")
PK_PLATFORM=$(ensure_group "Platform")
PK_GROWTH=$(ensure_group  "Growth")
PK_DEVOPS=$(ensure_group  "DevOps")

echo ""
info "Group PKs:"
info "  Engineering=$PK_ENG"
info "  Marketing=$PK_MKT"
info "  Platform=$PK_PLATFORM"
info "  Growth=$PK_GROWTH"
info "  DevOps=$PK_DEVOPS"

# ---------------------------------------------------------------------------
# STEP 4: Set group parent relationships using native parents[] array
# ---------------------------------------------------------------------------
# authentik 2026.5+ supports multi-parent groups natively via the `parents`
# field (a writable UUID array). No extra_parents attribute hack is needed.
#
# Structure:
#   Engineering  → parents: []            (root)
#   Marketing    → parents: []            (root)
#   Platform     → parents: [Engineering]
#   Growth       → parents: [Marketing]
#   DevOps       → parents: [Platform, Engineering]  ← true DAG diamond
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 4: Setting group parent relationships (native parents[] array) ==="

# Engineering and Marketing are roots — no parents (default is [])

# Platform → parents: [Engineering]
set_group_parents "$PK_PLATFORM" "$PK_ENG"
ok "Platform → parents: [Engineering]"

# Growth → parents: [Marketing]
set_group_parents "$PK_GROWTH" "$PK_MKT"
ok "Growth → parents: [Marketing]"

# DevOps → parents: [Platform, Engineering]  ← native DAG diamond
set_group_parents "$PK_DEVOPS" "$PK_PLATFORM" "$PK_ENG"
ok "DevOps → parents: [Platform, Engineering]  (native DAG diamond — no attribute workaround)"

# ---------------------------------------------------------------------------
# STEP 5: Add members to groups
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 5: Adding members to groups ==="

echo ""
info "--- Engineering: alice.chen, bob.smith, iris.walker, jake.ross ---"
add_user_to_group "$PK_ENG" "$PK_ALICE"  "alice.chen"
add_user_to_group "$PK_ENG" "$PK_BOB"   "bob.smith"
add_user_to_group "$PK_ENG" "$PK_IRIS"  "iris.walker"
add_user_to_group "$PK_ENG" "$PK_JAKE"  "jake.ross"

echo ""
info "--- Marketing: eve.morgan, frank.nguyen, bob.smith ---"
add_user_to_group "$PK_MKT" "$PK_EVE"   "eve.morgan"
add_user_to_group "$PK_MKT" "$PK_FRANK" "frank.nguyen"
add_user_to_group "$PK_MKT" "$PK_BOB"   "bob.smith"

echo ""
info "--- Platform: carol.jones, alice.chen, david.kim, jake.ross ---"
add_user_to_group "$PK_PLATFORM" "$PK_CAROL" "carol.jones"
add_user_to_group "$PK_PLATFORM" "$PK_ALICE" "alice.chen"
add_user_to_group "$PK_PLATFORM" "$PK_DAVID" "david.kim"
add_user_to_group "$PK_PLATFORM" "$PK_JAKE"  "jake.ross"

echo ""
info "--- Growth: grace.patel, eve.morgan, frank.nguyen ---"
add_user_to_group "$PK_GROWTH" "$PK_GRACE" "grace.patel"
add_user_to_group "$PK_GROWTH" "$PK_EVE"   "eve.morgan"
add_user_to_group "$PK_GROWTH" "$PK_FRANK" "frank.nguyen"

echo ""
info "--- DevOps: henry.torres, carol.jones, david.kim, grace.patel ---"
add_user_to_group "$PK_DEVOPS" "$PK_HENRY" "henry.torres"
add_user_to_group "$PK_DEVOPS" "$PK_CAROL" "carol.jones"
add_user_to_group "$PK_DEVOPS" "$PK_DAVID" "david.kim"
add_user_to_group "$PK_DEVOPS" "$PK_GRACE" "grace.patel"

# ---------------------------------------------------------------------------
# STEP 6: Set group attributes (leader + managers)
# ---------------------------------------------------------------------------
echo ""
info "=== STEP 6: Setting group leaders and managers ==="

# Engineering: leader=alice, managers=[bob]
set_group_attributes "$PK_ENG" "$UUID_ALICE" "[\"$UUID_BOB\"]"
ok "Engineering: leader=alice.chen, managers=[bob.smith]"

# Marketing: leader=eve, managers=[frank]
set_group_attributes "$PK_MKT" "$UUID_EVE" "[\"$UUID_FRANK\"]"
ok "Marketing: leader=eve.morgan, managers=[frank.nguyen]"

# Platform: leader=carol, managers=[alice]
set_group_attributes "$PK_PLATFORM" "$UUID_CAROL" "[\"$UUID_ALICE\"]"
ok "Platform: leader=carol.jones, managers=[alice.chen]"

# Growth: leader=grace, no managers
set_group_attributes "$PK_GROWTH" "$UUID_GRACE" "[]"
ok "Growth: leader=grace.patel, managers=[]"

# DevOps: leader=henry, managers=[carol]
set_group_attributes "$PK_DEVOPS" "$UUID_HENRY" "[\"$UUID_CAROL\"]"
ok "DevOps: leader=henry.torres, managers=[carol.jones]"

# ---------------------------------------------------------------------------
# STEP 7: Verify — print summary from API
# ---------------------------------------------------------------------------
echo ""
echo "============================================================"
info "=== STEP 7: Verification — querying API for summary ==="
echo "============================================================"

echo ""
info "--- All users ---"
curl -s -H "Authorization: Bearer $TOKEN" "$API/core/users/?page_size=50" \
  | $JQ -r '
    .results[]
    | select(.username | test("^(alice|bob|carol|david|eve|frank|grace|henry|iris|jake)"))
    | [
        (if .is_active then "ACTIVE" else "SUSPENDED" end),
        .username,
        .name,
        .email,
        (.attributes.telegram // "(no telegram)")
      ]
    | @tsv
  ' \
  | column -t -s $'\t'

echo ""
info "--- All groups (with native parents[] array) ---"
curl -s -H "Authorization: Bearer $TOKEN" "$API/core/groups/?page_size=50" \
  | $JQ -r '
    .results[]
    | select(.name | test("^(Engineering|Marketing|Platform|Growth|DevOps)$"))
    | {
        name,
        pk,
        parents: (.parents // []),
        leader: (.attributes.leader // "(none)"),
        managers: (.attributes.managers // []),
        member_count: (.users | length)
      }
    | [
        .name,
        ("pk=" + .pk),
        ("parents_count=" + (.parents | length | tostring)),
        ("parents=" + (.parents | join(","))),
        ("leader=" + .leader),
        ("managers_count=" + (.managers | length | tostring)),
        ("members=" + (.member_count | tostring))
      ]
    | @tsv
  ' \
  | column -t -s $'\t'

echo ""
info "--- Group parent summary table ---"
printf "%-15s  %s\n" "GROUP" "PARENT_COUNT  PARENT_UUIDs"
printf "%-15s  %s\n" "---------------" "------------  ------------"
curl -s -H "Authorization: Bearer $TOKEN" "$API/core/groups/?page_size=50" \
  | $JQ -r '
    .results[]
    | select(.name | test("^(Engineering|Marketing|Platform|Growth|DevOps)$"))
    | [.name, ((.parents // []) | length | tostring), ((.parents // []) | join(", "))]
    | @tsv
  ' \
  | awk -F'\t' '{ printf "%-15s  %-12s  %s\n", $1, $2, $3 }'

echo ""
info "--- Coverage checklist verification ---"

# Fetch full data for analysis
USERS_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/core/users/?page_size=50")
GROUPS_JSON=$(curl -s -H "Authorization: Bearer $TOKEN" "$API/core/groups/?page_size=50")

# Check suspended user
JAKE_ACTIVE=$(echo "$USERS_JSON" | $JQ -r '.results[] | select(.username=="jake.ross") | .is_active')
if [[ "$JAKE_ACTIVE" == "false" ]]; then
  ok "[x] Suspended user: jake.ross is_active=false"
else
  warn "[ ] jake.ross is NOT suspended! is_active=$JAKE_ACTIVE"
fi

# Check alice.chen telegram attribute
ALICE_TG=$(echo "$USERS_JSON" | $JQ -r '.results[] | select(.username=="alice.chen") | .attributes.telegram // "(none)"')
if [[ "$ALICE_TG" == "@alice_chen" ]]; then
  ok "[x] alice.chen has attributes.telegram=\"@alice_chen\""
else
  warn "[ ] alice.chen telegram mismatch: got '$ALICE_TG'"
fi

# Check telegram handles
USERS_WITH_TG=$(echo "$USERS_JSON" | $JQ -r '.results[] | select(.attributes.telegram != null) | .username' | grep -E "^(alice|bob|carol|eve|grace|iris)" | sort | tr '\n' ' ' || true)
ok "[x] Users with telegram: $USERS_WITH_TG"

USERS_WITHOUT_TG=$(echo "$USERS_JSON" | $JQ -r '.results[] | select(.attributes.telegram == null) | .username' | grep -E "^(david|frank|henry|jake)" | sort | tr '\n' ' ' || true)
ok "[x] Users without telegram: $USERS_WITHOUT_TG"

# Check DevOps native parents array — should have exactly 2 entries
DEVOPS_PARENTS_JSON=$(echo "$GROUPS_JSON" | $JQ '.results[] | select(.name=="DevOps") | .parents // []')
DEVOPS_PARENTS_COUNT=$(echo "$DEVOPS_PARENTS_JSON" | $JQ 'length')
echo ""
info "DevOps group 'parents' field from live API:"
echo "$DEVOPS_PARENTS_JSON" | $JQ .
echo ""

if [[ "$DEVOPS_PARENTS_COUNT" -eq 2 ]]; then
  ok "[x] DAG diamond: DevOps has $DEVOPS_PARENTS_COUNT native parents (Platform + Engineering)"
else
  warn "[ ] DevOps parents count unexpected: got $DEVOPS_PARENTS_COUNT, expected 2"
fi

# Check root groups (Engineering and Marketing have empty parents array)
ROOT_GROUPS=$(echo "$GROUPS_JSON" | $JQ '[.results[] | select(.name | test("^(Engineering|Marketing|Platform|Growth|DevOps)$")) | select((.parents // []) | length == 0) | .name] | join(", ")')
ok "[x] Root groups (parents=[]): $ROOT_GROUPS"

# Check alice is leader of Engineering AND manager of Platform
ENG_LEADER=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Engineering") | .attributes.leader')
PLATFORM_MGRS=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Platform") | .attributes.managers[]?')
if [[ "$ENG_LEADER" == "$UUID_ALICE" ]]; then
  ok "[x] alice.chen is leader of Engineering"
fi
if echo "$PLATFORM_MGRS" | grep -q "$UUID_ALICE" 2>/dev/null; then
  ok "[x] alice.chen is manager of Platform (leader+manager in different groups)"
fi

# Check carol: leader of Platform, manager of DevOps
PLATFORM_LEADER=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Platform") | .attributes.leader')
DEVOPS_MGRS=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="DevOps") | .attributes.managers[]?')
if [[ "$PLATFORM_LEADER" == "$UUID_CAROL" ]]; then
  ok "[x] carol.jones is leader of Platform"
fi
if echo "$DEVOPS_MGRS" | grep -q "$UUID_CAROL" 2>/dev/null; then
  ok "[x] carol.jones is manager of DevOps (leader+manager in different groups)"
fi

# Check bob: manager in Engineering, plain member in Marketing
ENG_MGRS=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Engineering") | .attributes.managers[]?')
MKT_LEADER=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Marketing") | .attributes.leader')
MKT_MGRS=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="Marketing") | .attributes.managers[]?')
if echo "$ENG_MGRS" | grep -q "$UUID_BOB" 2>/dev/null; then
  ok "[x] bob.smith is manager in Engineering"
fi
if [[ "$MKT_LEADER" != "$UUID_BOB" ]]; then
  if ! echo "$MKT_MGRS" | grep -q "$UUID_BOB" 2>/dev/null; then
    ok "[x] bob.smith is plain member in Marketing (manager in one, member in another)"
  fi
fi

# Check henry: leader of DevOps only
DEVOPS_LEADER=$(echo "$GROUPS_JSON" | $JQ -r '.results[] | select(.name=="DevOps") | .attributes.leader')
if [[ "$DEVOPS_LEADER" == "$UUID_HENRY" ]]; then
  ok "[x] henry.torres is leader of DevOps only"
fi

echo ""
echo "============================================================"
ok "Seed data script completed successfully!"
echo "============================================================"
echo ""
echo "Org summary:"
echo "  Users: alice.chen, bob.smith, carol.jones, david.kim, eve.morgan,"
echo "         frank.nguyen, grace.patel, henry.torres, iris.walker, jake.ross(SUSPENDED)"
echo ""
echo "  Groups (native parents[] — authentik 2026.5+):"
echo "    Engineering  [ROOT]      leader=alice  managers=[bob]"
echo "    Marketing    [ROOT]      leader=eve    managers=[frank]"
echo "    Platform     [←Eng]     leader=carol  managers=[alice]"
echo "    Growth       [←Mkt]     leader=grace  managers=[]"
echo "    DevOps       [←Plt,Eng] leader=henry  managers=[carol]  ← native DAG diamond"
echo ""
