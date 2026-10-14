#!/usr/bin/env bash
# Base backup for point-in-time restore (Phase 6G). Together with the WAL
# archive (docker-compose.yml: archive_mode, archive_timeout=60s) it lets the
# database be restored to any moment after this backup, losing at most about
# a minute. Run it daily (cron) and keep at least the last two.
#
# Usage: scripts/pitr-basebackup.sh            (container hms-db)
#        HMS_DB_CONTAINER=name scripts/pitr-basebackup.sh
# Writes /basebackups/<timestamp>/ inside the container (volume hms-basebackups):
#   base.tar.gz   the data directory     manifest.json   when and from which WAL
set -euo pipefail
C="${HMS_DB_CONTAINER:-hms-db}"
DB_USER="${DB_USER:-postgres}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
docker exec "$C" sh -c "test \"\$(psql -U $DB_USER -Atc 'show archive_mode')\" = on" \
  || { echo "archive_mode is off in $C: base backups alone cannot restore to a point in time." >&2; exit 1; }
# Files are owned by the database user so a restore can read them.
docker exec "$C" chown postgres /basebackups
docker exec -u postgres "$C" mkdir -p "/basebackups/$TS"
start=$(date +%s)
# -X fetch puts the WAL needed for consistency in the backup itself.
docker exec -u postgres "$C" pg_basebackup -U "$DB_USER" -D "/basebackups/$TS" -Ft -z -X fetch --checkpoint=fast --label "hms-$TS"
lsn=$(docker exec "$C" sh -c "tar -xzOf /basebackups/$TS/base.tar.gz backup_label | sed -n 's/^START WAL LOCATION: \([^ ]*\).*/\1/p'")
size=$(docker exec "$C" du -sk "/basebackups/$TS" | cut -f1)
docker exec -i -u postgres "$C" sh -c "cat > /basebackups/$TS/manifest.json" <<EOF
{"taken_at": "$(date -u -d @$start +%Y-%m-%dT%H:%M:%SZ)", "start_lsn": "$lsn", "size_kb": $size, "seconds": $(( $(date +%s) - start )), "pg_version": "$(docker exec "$C" postgres -V | awk '{print $3}')"}
EOF
echo "Base backup /basebackups/$TS in $C (${size} KB, start WAL $lsn)"
echo "Restore drill: scripts/pitr-restore-drill.sh <time|latest>"
