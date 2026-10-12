#!/usr/bin/env bash
# Back up the HMS database (Docker Compose "db" service) and uploads.
# Usage: scripts/backup-db.sh [compose-file]     (default: docker-compose.yml)
# Writes to $HMS_BACKUP_DIR (default ~/hms-backups)/<timestamp>/:
#   hms.dump          pg_dump custom-format archive
#   row-counts.txt    per-table row counts, checked by restore-check.sh
#   uploads.tar.gz    backend/uploads
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${1:-docker-compose.yml}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-hms}"
OUT="${HMS_BACKUP_DIR:-$HOME/hms-backups}/$(date +%Y%m%d-%H%M%S)"
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

COUNTS_SQL="select string_agg(relname || ' ' || n, E'\n' order by relname) from (
  select c.relname, (xpath('/row/c/text()', query_to_xml('select count(*) c from public.' || quote_ident(c.relname), false, true, '')))[1]::text n
  from pg_class c join pg_namespace s on s.oid = c.relnamespace where s.nspname = 'public' and c.relkind = 'r') t"
counts() { dc exec -T db psql -U "$DB_USER" -d "$DB_NAME" -Atc "$COUNTS_SQL"; }

mkdir -p "$OUT"
before=$(counts)
dc exec -T db pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$OUT/hms.dump"
after=$(counts)
if [ "$before" = "$after" ]; then
  printf '%s\n' "$after" > "$OUT/row-counts.txt"
else
  echo "WARNING: data changed while the backup ran; row-counts.txt not written, so restore-check can only confirm the archive restores." >&2
fi
tar -czf "$OUT/uploads.tar.gz" -C backend uploads
echo "Backup written to $OUT ($(du -sh "$OUT" | cut -f1))"
echo "Prove it restores: scripts/restore-check.sh $OUT"
