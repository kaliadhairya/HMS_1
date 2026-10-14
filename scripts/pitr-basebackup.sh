#!/usr/bin/env bash
# Physical base backup with verified artifacts. Actual RPO depends on observed
# WAL archival and protected off-host copies, not archive_timeout alone.
set -euo pipefail
umask 077
C="${HMS_DB_CONTAINER:-hms-db}"
DB_USER="${DB_USER:-postgres}"; DB_NAME="${DB_NAME:-hms}"
TS="$(date -u +%Y%m%dT%H%M%SZ)-$$"
[[ "$DB_USER" =~ ^[a-zA-Z0-9_]+$ && "$DB_NAME" =~ ^[a-zA-Z0-9_]+$ ]] || { echo 'Invalid database identity' >&2; exit 2; }
q() { docker exec "$C" psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
[ "$(q 'show archive_mode')" = on ] || { echo 'archive_mode is off; no PITR protection' >&2; exit 1; }
TEMP="/basebackups/.creating-$TS"; FINAL="/basebackups/$TS"
docker exec "$C" sh -ec 'mkdir -p /basebackups; chown postgres:postgres /basebackups; chmod 0700 /basebackups'
docker exec -u postgres "$C" mkdir -m 700 "$TEMP"
cleanup() { docker exec -u postgres "$C" rm -rf "$TEMP" >/dev/null 2>&1 || true; }; trap cleanup EXIT
start=$(date -u +%Y-%m-%dT%H:%M:%SZ)
MIGRATIONS=$(q "SELECT coalesce(json_agg(x ORDER BY version),'[]'::json) FROM (SELECT version,file,checksum FROM schema_migrations) x")
docker exec -u postgres "$C" pg_basebackup -U "$DB_USER" -D "$TEMP" -Ft -z -X fetch --checkpoint=fast --manifest-checksums=SHA256 --label "hms-$TS"
printf '%s\n' "$MIGRATIONS" | docker exec -i -u postgres "$C" sh -c 'cat > "$1/migrations.json"' sh "$TEMP"
docker exec -u postgres "$C" sh -ec 'cd "$1"; sha256sum base.tar.gz backup_manifest migrations.json > artifacts.sha256' sh "$TEMP"
docker exec -i -u postgres "$C" sh -c 'cat > "$1/manifest.json"' sh "$TEMP" <<JSON
{"version":1,"status":"STORED","taken_at":"$start","database":"$DB_NAME","finished_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
JSON
docker exec -u postgres "$C" mv "$TEMP" "$FINAL"
printf 'STORED: base backup %s in %s; restore verification still required\n' "$TS" "$C"
