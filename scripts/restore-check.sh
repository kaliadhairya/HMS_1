#!/usr/bin/env bash
# Prove a backup restores: load it into a temporary database inside the
# Docker "db" service, compare per-table row counts with the backup's
# row-counts.txt, then drop the temporary database. The live database is
# never touched.
# Usage: scripts/restore-check.sh <backup-dir> [compose-file]
set -euo pipefail
cd "$(dirname "$0")/.."
DIR="${1:?Usage: scripts/restore-check.sh <backup-dir> [compose-file]}"
COMPOSE_FILE="${2:-docker-compose.yml}"
DB_USER="${DB_USER:-postgres}"
CHECK_DB="hms_restore_check_$$"
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

COUNTS_SQL="select string_agg(relname || ' ' || n, E'\n' order by relname) from (
  select c.relname, (xpath('/row/c/text()', query_to_xml('select count(*) c from public.' || quote_ident(c.relname), false, true, '')))[1]::text n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r') t"

cleanup() { dc exec -T db dropdb -U "$DB_USER" --if-exists "$CHECK_DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

dc exec -T db createdb -U "$DB_USER" "$CHECK_DB"
dc exec -T db pg_restore -U "$DB_USER" -d "$CHECK_DB" --no-owner --exit-on-error < "$DIR/hms.dump"
restored=$(dc exec -T db psql -U "$DB_USER" -d "$CHECK_DB" -Atc "$COUNTS_SQL")
tables=$(printf '%s\n' "$restored" | grep -c .)

if [ ! -f "$DIR/row-counts.txt" ]; then
  echo "RESTORED: $tables tables loaded without errors (no row-counts.txt to compare against)."
elif diff <(cat "$DIR/row-counts.txt") <(printf '%s\n' "$restored") >/dev/null; then
  echo "PASS: $tables tables restored; every table's row count matches the backup."
else
  echo "FAIL: restored row counts differ from the backup:" >&2
  diff <(cat "$DIR/row-counts.txt") <(printf '%s\n' "$restored") >&2 || true
  exit 1
fi
tar -tzf "$DIR/uploads.tar.gz" >/dev/null && echo "Uploads archive is readable."
