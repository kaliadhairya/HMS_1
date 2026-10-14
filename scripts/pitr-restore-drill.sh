#!/usr/bin/env bash
# Point-in-time restore drill (Phase 6G). Restores the newest suitable base
# backup plus the WAL archive into a throwaway container, up to the moment
# asked for, then checks the result: migrations, audit chains, financial
# journal balance and key row counts. Measures how long the restore took (RTO)
# and how close to the target the restored data reaches (RPO). The live
# database is only read (its backup volumes are mounted read-only).
#
# Usage: scripts/pitr-restore-drill.sh <ISO time, e.g. 2026-10-14T10:30:00Z | latest>
#        HMS_DB_CONTAINER=name  (default hms-db)
#        RPO_TARGET_SECONDS (300) RTO_TARGET_SECONDS (3600) — blueprint 3.13
# Report: ${HMS_BACKUP_DIR:-~/hms-backups}/drills/<timestamp>-pitr.json
set -euo pipefail
TARGET="${1:?Usage: scripts/pitr-restore-drill.sh <ISO time|latest>}"
C="${HMS_DB_CONTAINER:-hms-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-hms}"
RPO_T="${RPO_TARGET_SECONDS:-300}"; RTO_T="${RTO_TARGET_SECONDS:-3600}"
OUT="${HMS_BACKUP_DIR:-$HOME/hms-backups}/drills"; mkdir -p "$OUT"
D="hms-drill-$$"
IMAGE=$(docker inspect -f '{{.Config.Image}}' "$C")
cleanup() { docker rm -f "$D" >/dev/null 2>&1 || true; }
trap cleanup EXIT

if [ "$TARGET" != latest ]; then target_epoch=$(date -u -d "$TARGET" +%s.%N) || { echo "Not a time: $TARGET" >&2; exit 2; }; fi
# Newest base backup taken before the target.
BASE=$(docker exec "$C" sh -c 'for d in $(ls -1 /basebackups 2>/dev/null | sort -r); do [ -f /basebackups/$d/manifest.json ] && echo $d; done' | while read -r b; do
  taken=$(date -u -d "$(echo "$b" | sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3T\4:\5:\6Z/')" +%s)
  if [ "$TARGET" = latest ] || [ "$taken" -le "${target_epoch%.*}" ]; then echo "$b"; break; fi
done)
[ -n "$BASE" ] || { echo "No base backup in $C:/basebackups older than $TARGET" >&2; exit 1; }

if [ "$TARGET" = latest ]; then RECOVERY="recovery_target_timeline = 'latest'"; else RECOVERY="recovery_target_time = '$(date -u -d "$TARGET" '+%Y-%m-%d %H:%M:%S.%6N+00')'"; fi
start=$(date +%s.%N)
docker run -d --name "$D" --volumes-from "$C:ro" --user postgres --tmpfs /drill:size=4g,uid=70,gid=70,mode=0700 \
  --entrypoint sh "$IMAGE" -c "set -e; mkdir -m 700 /drill/data; tar -xzf /basebackups/$BASE/base.tar.gz -C /drill/data; touch /drill/data/recovery.signal
cat >> /drill/data/postgresql.auto.conf <<EOF
restore_command = 'gunzip -c /wal-archive/%f.gz > %p'
$RECOVERY
recovery_target_action = 'promote'
EOF
exec postgres -D /drill/data -c archive_mode=off -c listen_addresses='' -c unix_socket_directories=/drill" >/dev/null

q() { docker exec "$D" psql -h /drill -U "$DB_USER" -d "$DB_NAME" -Atc "$1"; }
promoted=""
for _ in $(seq 1 "$RTO_T"); do
  if ! docker inspect -f '{{.State.Running}}' "$D" 2>/dev/null | grep -q true; then break; fi
  if [ "$(q 'select pg_is_in_recovery()' 2>/dev/null)" = f ]; then promoted=1; break; fi
  sleep 1
done
rto=$(echo "$(date +%s.%N) - $start" | bc)
if [ -z "$promoted" ]; then
  echo "Restore did not complete:"; docker logs "$D" 2>&1 | tail -15
  exit 1
fi

last=$(q "select extract(epoch from pg_last_xact_replay_timestamp())::numeric(20,3)")
migrations=$(q "select count(*) from schema_migrations")
audit_problems=$(q "select (select count(*) from audit.verify('audit.row_changes'::regclass)) + (select count(*) from audit.verify('audit.access_events'::regclass)) + (select count(*) from audit.verify('public.hms_audit_logs'::regclass))")
unbalanced=$(q "select count(*) from (select entry_id from hms_journal_lines group by 1 having sum(debit) <> sum(credit)) x" 2>/dev/null || echo n/a)
# Optional extra check for drills (a query returning one JSON value).
extra=null; [ -n "${DRILL_CHECK_SQL:-}" ] && extra=$(q "$DRILL_CHECK_SQL")
counts=$(q "select json_object_agg(t, n) from (select 'patients' t, count(*) n from hms_patients union all select 'encounters', count(*) from hms_encounters union all select 'admissions', count(*) from hms_admissions union all select 'audit_row_changes', count(*) from audit.row_changes) x")
if [ "$TARGET" = latest ]; then rpo=null; else rpo=$(printf "%.3f" "$(echo "$target_epoch - ${last:-0}" | bc)"); fi

status=PASS; problems=()
[ "$audit_problems" = 0 ] || { status=FAIL; problems+=("audit chains: $audit_problems problem(s)"); }
[ "$unbalanced" = 0 ] || [ "$unbalanced" = n/a ] || { status=FAIL; problems+=("journal: $unbalanced unbalanced entr(ies)"); }
if [ "$rpo" != null ] && [ "$(echo "$rpo > $RPO_T" | bc)" = 1 ]; then status=FAIL; problems+=("RPO ${rpo}s exceeds ${RPO_T}s"); fi
[ "$(echo "$rto > $RTO_T" | bc)" = 1 ] && { status=FAIL; problems+=("RTO ${rto}s exceeds ${RTO_T}s"); }

plist=""; [ ${#problems[@]} -gt 0 ] && plist=$(printf '"%s",' "${problems[@]}" | sed 's/,$//')
REPORT="$OUT/$(date -u +%Y%m%dT%H%M%SZ)-pitr.json"
cat > "$REPORT" <<EOF
{"kind": "pitr", "status": "$status", "source_container": "$C", "base_backup": "$BASE", "target": "$TARGET",
 "restored_last_commit": $( [ -n "$last" ] && echo "\"$(date -u -d @"${last%.*}" +%Y-%m-%dT%H:%M:%SZ)\"" || echo null ),
 "rpo_seconds": $rpo, "rto_seconds": $(printf '%.1f' "$rto"), "rpo_target_seconds": $RPO_T, "rto_target_seconds": $RTO_T,
 "migrations": $migrations, "audit_chain_problems": $audit_problems, "unbalanced_journal_entries": "$unbalanced", "row_counts": $counts,
 "check": $extra, "problems": [$plist], "finished_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
cat "$REPORT"
echo "$status: restored $C to $TARGET from $BASE in ${rto}s (report $REPORT)"
[ "$status" = PASS ]
