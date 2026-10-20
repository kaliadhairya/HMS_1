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

# The new clinical-grant authority begins empty. Schema conversion must never
# manufacture approval events without a responsible actor and request record.
UNATTRIBUTED_PRIVILEGES=$(psql -d "$FRESH" -Atc "
  SELECT count(*) FROM audit.row_changes
   WHERE table_name = 'hms_clinical_privileges' AND operation = 'INSERT'
     AND actor_user_id IS NULL AND request_id IS NULL")
if [ "$UNATTRIBUTED_PRIVILEGES" != "0" ]; then
  echo "FAIL: migration created $UNATTRIBUTED_PRIVILEGES unattributed clinical privilege grants"
  exit 1
fi

# Every application table must be audited (migration 0006), except the ones
# whose rows are not clinical, financial or security events. Terminology
# concepts are reference content: their audited release row records the
# loaded file's checksum and count, and a trigger forbids any change (0090).
# The checkpoint shipping queue is delivery bookkeeping like the outbox; the
# write-once store is the evidence (0091). Interface messages are their own
# append-only log and carry whole health records (0092); so do documents
# imported from other facilities (0093).
UNAUDITED=$(psql -d "$FRESH" -Atc "
  SELECT string_agg(c.relname, ', ') FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'hms\\_%'
     AND c.relname NOT IN ('hms_audit_logs', 'hms_sessions', 'hms_idempotency_keys', 'hms_outbox', 'hms_inbox', 'hms_term_concepts', 'hms_audit_checkpoint_shipments', 'hms_interface_messages', 'hms_abdm_imports')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                      WHERE t.tgrelid = c.oid AND p.proname = 'capture_change')")
if [ -n "$UNAUDITED" ]; then
  echo "FAIL: tables without an audit trigger: $UNAUDITED"
  exit 1
fi

if diff <(psql -d "$FRESH" -Atf scripts/schema-fingerprint.sql) <(psql -d "$LEGACY" -Atf scripts/schema-fingerprint.sql); then
  echo "PASS: fresh and upgraded databases have identical schemas ($(psql -d "$FRESH" -Atf scripts/schema-fingerprint.sql | wc -l) facts)"
else
  echo "FAIL: schemas differ (lines above: < fresh, > upgraded)"
  exit 1
fi
