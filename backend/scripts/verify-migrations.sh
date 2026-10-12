#!/usr/bin/env bash
# Proves the migrations are complete:
#   1. on an empty database they apply, a second run does nothing, and
#      "migrate.js check" passes;
#   2. a database built the old way (init_database.js at $LEGACY_REF) upgrades
#      to exactly the same schema as a fresh one.
# Uses DB_HOST/DB_PORT/DB_USER/DB_PASSWORD for a server where it may create
# and drop throwaway databases. Run from anywhere.
set -euo pipefail
cd "$(dirname "$0")/.."
LEGACY_REF="${LEGACY_REF:-1639d15}"
export PGHOST="${DB_HOST:-localhost}" PGPORT="${DB_PORT:-5432}" PGUSER="${DB_USER:-postgres}" PGPASSWORD="${DB_PASSWORD:-postgres}"
FRESH="hms_verify_fresh_$$"
LEGACY="hms_verify_legacy_$$"
LEGACY_SCRIPT="legacy_init_database_$$.js"

cleanup() {
  rm -f "$LEGACY_SCRIPT"
  dropdb --if-exists "$FRESH" 2>/dev/null || true
  dropdb --if-exists "$LEGACY" 2>/dev/null || true
}
trap cleanup EXIT
createdb "$FRESH"
createdb "$LEGACY"

echo "== Fresh database"
DB_NAME="$FRESH" node migrate.js up
DB_NAME="$FRESH" node migrate.js up | grep -q "up to date" || { echo "FAIL: second run was not a no-op"; exit 1; }
DB_NAME="$FRESH" node migrate.js check

echo "== Legacy database (init_database.js at $LEGACY_REF), then migrations"
git show "$LEGACY_REF:backend/init_database.js" > "$LEGACY_SCRIPT"
DB_NAME="$LEGACY" node "$LEGACY_SCRIPT" > /dev/null
DB_NAME="$LEGACY" node migrate.js up

if diff <(psql -d "$FRESH" -Atf scripts/schema-fingerprint.sql) <(psql -d "$LEGACY" -Atf scripts/schema-fingerprint.sql); then
  echo "PASS: fresh and upgraded databases have identical schemas ($(psql -d "$FRESH" -Atf scripts/schema-fingerprint.sql | wc -l) facts)"
else
  echo "FAIL: schemas differ (lines above: < fresh, > upgraded)"
  exit 1
fi
