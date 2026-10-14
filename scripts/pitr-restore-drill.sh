#!/usr/bin/env bash
# Restore only into a private, network-isolated disposable container. Unknown
# RPO, absent checks and corrupt artifacts fail; no writer activation occurs.
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."
TARGET="${1:?Usage: pitr-restore-drill.sh <ISO time|latest>}"
C="${HMS_DB_CONTAINER:-hms-db}"; DB_USER="${DB_USER:-postgres}"; DB_NAME="${DB_NAME:-hms}"
RPO_T="${RPO_TARGET_SECONDS:-300}"; RTO_T="${RTO_TARGET_SECONDS:-3600}"
[[ "$DB_USER" =~ ^[a-zA-Z0-9_]+$ && "$DB_NAME" =~ ^[a-zA-Z0-9_]+$ && "$RPO_T" =~ ^[1-9][0-9]*$ && "$RTO_T" =~ ^[1-9][0-9]*$ ]] || { echo 'Invalid drill configuration' >&2; exit 2; }
OUT="${HMS_BACKUP_DIR:-$HOME/hms-backups}/drills"; mkdir -p "$OUT"; chmod 0700 "$OUT"
D="hms-clinical-drill-$$"; IMAGE=$(docker inspect -f '{{.Config.Image}}' "$C")
uid=$(docker exec "$C" id -u postgres); gid=$(docker exec "$C" id -g postgres)
cleanup() { docker rm -f "$D" >/dev/null 2>&1 || true; }; trap cleanup EXIT
reference=$(date +%s.%N)
if [ "$TARGET" != latest ]; then reference=$(date -u -d "$TARGET" +%s.%N) || exit 2; fi
BASE=""
while read -r b; do
 [[ "$b" =~ ^[0-9]{8}T[0-9]{6}Z(-[0-9]+)?$ ]] || continue
 taken=$(date -u -d "$(echo "${b%%Z*}Z" | sed -E 's/(....)(..)(..)T(..)(..)(..)Z/\1-\2-\3T\4:\5:\6Z/')" +%s)
 if [ "$TARGET" = latest ] || [ "$taken" -le "${reference%.*}" ]; then BASE="$b"; break; fi
done < <(docker exec "$C" sh -c 'ls -1 /basebackups | sort -r')
[ -n "$BASE" ] || { echo 'No suitable base backup' >&2; exit 1; }
if [ "$TARGET" = latest ]; then RECOVERY="recovery_target_timeline = 'latest'"; else RECOVERY="recovery_target_time = '$(date -u -d "$TARGET" '+%Y-%m-%d %H:%M:%S.%6N+00')'"; fi
start=$(date +%s.%N)
docker run -d --name "$D" --network none --volumes-from "$C:ro" --user postgres --tmpfs "/drill:size=4g,uid=$uid,gid=$gid,mode=0700" \
 --entrypoint sh "$IMAGE" -ec "cd /basebackups/$BASE; sha256sum -c artifacts.sha256 >/dev/null
mkdir -m 700 /drill/data; tar -xzf base.tar.gz -C /drill/data; cp backup_manifest /drill/data/backup_manifest
pg_verifybackup --no-parse-wal /drill/data >/dev/null
touch /drill/data/recovery.signal
cat >> /drill/data/postgresql.auto.conf <<CONFIG
restore_command = 'gunzip -c /wal-archive/%f.gz > %p'
primary_conninfo = ''
$RECOVERY
recovery_target_action = 'promote'
CONFIG
exec postgres -D /drill/data -c archive_mode=off -c listen_addresses='' -c unix_socket_directories=/drill" >/dev/null
q() { docker exec "$D" psql -h /drill -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -Atc "$1"; }
promoted=false
for _ in $(seq 1 "$RTO_T"); do
 [ "$(docker inspect -f '{{.State.Running}}' "$D")" = true ] || break
 if [ "$(q 'select pg_is_in_recovery()' 2>/dev/null)" = f ]; then promoted=true; break; fi
 sleep 1
done
[ "$promoted" = true ] || { docker logs "$D" > "$OUT/$D-failure.log" 2>&1; echo 'Restore failed; see protected failure log' >&2; exit 1; }
last=$(q 'select extract(epoch from pg_last_xact_replay_timestamp())::text')
actual=$(q "SELECT coalesce(json_agg(x ORDER BY version),'[]'::json) FROM (SELECT version,file,checksum FROM schema_migrations) x")
expected=$(docker exec "$C" cat "/basebackups/$BASE/migrations.json")
audit=$(q "select (select count(*) from audit.verify('audit.row_changes'::regclass))+(select count(*) from audit.verify('audit.access_events'::regclass))+(select count(*) from audit.verify('public.hms_audit_logs'::regclass))")
journal=$(q 'select count(*) from (select e.id from hms_journal_entries e left join hms_journal_lines l on l.entry_id=e.id group by e.id having count(l.id)=0 or sum(l.debit)<>sum(l.credit)) x')
stock=$(q 'select count(*) from hms_med_balances b full join (select batch_id,location_id,sum(delta) quantity from hms_med_movements group by 1,2) m using(batch_id,location_id) where coalesce(b.quantity,0)<>coalesce(m.quantity,0)')
clinical=$(q 'select count(*) from hms_med_administrations a join hms_med_order_versions v on v.id=a.version_id join hms_med_orders o on o.id=v.order_id where a.patient_id<>o.patient_id')
complete=$(node backend/scripts/validate-restore-container.cts "$D" "$DB_USER" "$DB_NAME")
extra=null; [ -z "${DRILL_CHECK_SQL:-}" ] || extra=$(q "$DRILL_CHECK_SQL")
REPORT="$OUT/$(date -u +%Y%m%dT%H%M%SZ)-$$-pitr.json"
node - "$reference" "$last" "$start" "$audit" "$journal" "$stock" "$clinical" "$actual" "$expected" "$RPO_T" "$RTO_T" "$extra" "$REPORT" "$BASE" "$TARGET" "$complete" <<'JS'
const fs=require('fs'),{recoveryProblems}=require('./backend/domain/recoveryEvidence.cts');
const [reference,last,start,audit,journal,stock,clinical,actual,expected,rpoTarget,rtoTarget,extra,file,base,target,complete]=process.argv.slice(2);
const m={rpoSeconds:last?Number(reference)-Number(last):null,rtoSeconds:Date.now()/1000-Number(start),rpoTargetSeconds:Number(rpoTarget),rtoTargetSeconds:Number(rtoTarget),auditProblems:Number(audit),unbalancedEntries:Number(journal),stockProblems:Number(stock),clinicalProblems:Number(clinical),schemaMatches:JSON.stringify(JSON.parse(actual))===JSON.stringify(JSON.parse(expected)),artifactVerified:true};
const full=JSON.parse(complete),problems=[...recoveryProblems(m),...(!full.valid?['Complete database invariants failed']:[])],r={kind:'pitr',status:problems.length?'FAIL':'PASS',scope:'ISOLATED_DATABASE_RESTORE',target,base_backup:base,rpo_seconds:m.rpoSeconds,rto_seconds:m.rtoSeconds,audit_chain_problems:m.auditProblems,unbalanced_journal_entries:m.unbalancedEntries,stock_problems:m.stockProblems,clinical_link_problems:m.clinicalProblems,schema_matches:m.schemaMatches,artifact_verified:true,database_checks:full.checks,document_versions:'NOT_CLAIMED_DATABASE_ONLY',check:JSON.parse(extra),problems,finished_at:new Date().toISOString()};
fs.writeFileSync(file,JSON.stringify(r,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(r));process.exitCode=problems.length?1:0;
JS
