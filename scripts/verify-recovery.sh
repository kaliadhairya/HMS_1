#!/usr/bin/env bash
# Recovery lab (Phase 6G): proves point-in-time restore and standby takeover
# with real timings, on throwaway containers only. Never touches hms-db.
#
#  1. Primary: PostgreSQL with the same WAL archiving as docker-compose.yml
#     (archive_timeout shortened by LAB_ARCHIVE_TIMEOUT, default 10 s), loaded
#     from the newest Docker backup and migrated with this checkout.
#  2. Point-in-time restore: timestamped marker rows are written; the drill
#     (scripts/pitr-restore-drill.sh) restores to the moment of one marker and
#     must contain every marker up to it and none after.
#  3. Standby takeover: a streaming standby follows the primary; the primary
#     is killed in the middle of writes; the standby is promoted and the
#     application started against it. Data lost (acknowledged writes missing)
#     and time to recover are measured against RPO 5 min / RTO 60 min.
#
# Usage: scripts/verify-recovery.sh <evidence-dir>
#   needs: docker, node (backend deps installed), JWT_SECRET for the app start
set -euo pipefail
cd "$(dirname "$0")/.."
EVID="${1:?Usage: scripts/verify-recovery.sh <evidence-dir>}"; mkdir -p "$EVID"
IMAGE="${LAB_PG_IMAGE:-postgres:16-alpine}"
DUMP="${LAB_DUMP:-$(ls -d "$HOME"/hms-backups/2*/ | sort | tail -1)hms.dump}"
RUN="clinical-final-$BASHPID"
P="hms-$RUN-primary"; SB="hms-$RUN-standby"; PPORT="${LAB_PRIMARY_PORT:-55465}"; SPORT="${LAB_STANDBY_PORT:-55466}"; APORT="${LAB_API_PORT:-15544}"
WAL="hms-$RUN-wal"; BASEVOL="hms-$RUN-base"; NET="hms-$RUN-net"
PRIVATE_ENV=$(mktemp); chmod 0600 "$PRIVATE_ENV"
DBN=hms_verify_final_recovery; PW=$(openssl rand -hex 12)
ARCH_T="${LAB_ARCHIVE_TIMEOUT:-10}"
export PGPASSWORD=$PW
printf 'POSTGRES_PASSWORD=%s\nPOSTGRES_DB=%s\nPGDATA=/var/lib/postgresql/data\n' "$PW" "$DBN" > "$PRIVATE_ENV"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$EVID/recovery.log"; }
cleanup() {
  [ -n "${APP_PID:-}" ] && kill "$APP_PID" 2>/dev/null || true
  docker rm -fv $P $SB >/dev/null 2>&1 || true
  docker volume rm -f "$WAL" "$BASEVOL" >/dev/null 2>&1 || true
  docker network rm "$NET" >/dev/null 2>&1 || true
}
trap 'cleanup; rm -f "$PRIVATE_ENV"; [ -z "${SECRET_DIR:-}" ] || rm -rf "$SECRET_DIR"' EXIT
psqlp() { psql -h 127.0.0.1 -p "$1" -U postgres -d "$DBN" -v ON_ERROR_STOP=1 -Atc "$2"; }
now() { date +%s.%N; }

log "primary: $IMAGE, archive_timeout=${ARCH_T}s, dump $DUMP"
docker volume create "$WAL" >/dev/null; docker volume create "$BASEVOL" >/dev/null
docker run -d --name $P -p 127.0.0.1:$PPORT:5432 --env-file "$PRIVATE_ENV" \
  -v "$WAL:/wal-archive" -v "$BASEVOL:/basebackups" -v "$PWD/scripts/archive-wal.sh:/usr/local/bin/hms-archive-wal:ro" --tmpfs /var/lib/postgresql/data:size=1g \
  $IMAGE postgres -c wal_level=replica -c archive_mode=on -c archive_timeout=$ARCH_T \
  -c 'archive_command=sh /usr/local/bin/hms-archive-wal "%p" "%f"' \
  -c max_wal_senders=5 -c wal_keep_size=256MB >/dev/null
docker exec $P sh -c 'chown postgres:postgres /wal-archive /basebackups; chmod 0700 /wal-archive /basebackups'
for _ in $(seq 1 60); do docker exec $P pg_isready -U postgres -d $DBN >/dev/null 2>&1 && psqlp $PPORT 'select 1' >/dev/null 2>&1 && break; sleep 1; done
docker exec $P sh -c 'echo "host replication all all scram-sha-256" >> /var/lib/postgresql/data/pg_hba.conf'
psqlp $PPORT 'select pg_reload_conf()' >/dev/null
docker exec -i $P pg_restore -U postgres -d $DBN --no-owner --exit-on-error < "$DUMP"
(cd backend && DB_HOST=127.0.0.1 DB_PORT=$PPORT DB_USER=postgres DB_PASSWORD=$PW DB_NAME=$DBN node migrate.js up > "$EVID/migrate.log" 2>&1)
log "primary loaded and migrated ($(grep -c Applied "$EVID/migrate.log") migrations applied)"
# Marker table for the drills only (not part of the application schema).
psqlp $PPORT "create table lab_markers (n integer primary key, at timestamptz not null default clock_timestamp())" >/dev/null

# ── 1. Point-in-time restore ─────────────────────────────────
DB_NAME=$DBN DB_USER=postgres HMS_DB_CONTAINER=$P bash scripts/pitr-basebackup.sh > "$EVID/basebackup-1.log"
log "$(tail -2 "$EVID/basebackup-1.log" | head -1)"
for i in $(seq 1 40); do psqlp $PPORT "insert into lab_markers (n) values ($i)" >/dev/null; sleep 0.25; done
# Restore stops at commit times: target 100 ms after marker 25 was written
# (markers are 250 ms apart), so markers 1-25 are in and 26-40 are out.
TARGET=$(psqlp $PPORT "select to_char((at + interval '100 milliseconds') at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') from lab_markers where n = 25")
EXPECT=$(psqlp $PPORT "select count(*) from lab_markers where at <= '$TARGET'")
log "target: just after marker 25, $TARGET ($EXPECT markers committed by then, 40 in total)"
psqlp $PPORT 'select pg_switch_wal()' >/dev/null; sleep $((ARCH_T + 3))
DRILL_CHECK_SQL="select json_build_object('markers', count(*), 'max', max(n)) from lab_markers" \
HMS_DB_CONTAINER=$P DB_NAME=$DBN HMS_BACKUP_DIR="$EVID" bash scripts/pitr-restore-drill.sh "$TARGET" > "$EVID/pitr.out" 2>&1 \
  || { log "PITR drill FAILED"; cat "$EVID/pitr.out"; exit 1; }
REPORT=$(ls -t "$EVID"/drills/*-pitr.json | head -1)
GOT=$(node -e "const r=require('$REPORT'); console.log(r.check.markers, r.check.max)")
log "restored: $GOT markers/max (expected $EXPECT/25); $(node -e "const r=require('$REPORT'); console.log('RPO', r.rpo_seconds, 's, RTO', r.rto_seconds, 's, audit problems', r.audit_chain_problems, ', unbalanced journal', r.unbalanced_journal_entries)")"
[ "$GOT" = "$EXPECT 25" ] || { log "FAIL: restore did not stop exactly at the target"; exit 1; }

# ── 2. Standby takeover ──────────────────────────────────────
DB_NAME=$DBN DB_USER=postgres HMS_DB_CONTAINER=$P bash scripts/pitr-basebackup.sh > "$EVID/basebackup-2.log"
BASE=$(docker exec $P sh -c 'ls -1 /basebackups | sort | tail -1')
docker run -d --name $SB -p 127.0.0.1:$SPORT:5432 --volumes-from $P:ro --user postgres \
  --tmpfs /standby:size=1g,uid=70,gid=70,mode=0700 --entrypoint sh $IMAGE -c "set -e; mkdir -m 700 /standby/data
tar -xzf /basebackups/$BASE/base.tar.gz -C /standby/data; touch /standby/data/standby.signal
cat >> /standby/data/postgresql.auto.conf <<EOF
primary_conninfo = 'host=$P port=5432 user=postgres passfile=/standby/.pgpass application_name=lab_standby'
restore_command = 'gunzip -c /wal-archive/%f.gz > %p'
EOF
for n in \$(seq 1 300); do [ ! -f /standby/.pgpass ] || break; sleep 0.1; done
[ -f /standby/.pgpass ] || exit 1
exec postgres -D /standby/data -c archive_mode=off -c listen_addresses='*'" >/dev/null
printf '%s:5432:*:postgres:%s\n' "$P" "$PW" | docker exec -i -u postgres "$SB" sh -c 'umask 077; cat > /standby/.pgpass.tmp; mv /standby/.pgpass.tmp /standby/.pgpass'
# The standby reaches the primary by container name on a shared network.
docker network create "$NET" >/dev/null 2>&1 || true
docker network connect "$NET" $P; docker network connect "$NET" $SB
for _ in $(seq 1 90); do [ "$(psqlp $PPORT "select count(*) from pg_stat_replication where state = 'streaming'" 2>/dev/null)" = 1 ] && break; sleep 1; done
[ "$(psqlp $PPORT "select count(*) from pg_stat_replication where state = 'streaming'")" = 1 ] || { log "FAIL: standby never streamed"; docker logs $SB 2>&1 | tail -10; exit 1; }
log "standby streaming from primary"
# Writes, each acknowledged to the client before the next; kill the primary midway.
: > "$EVID/acks.txt"
(for i in $(seq 1001 1600); do psqlp $PPORT "insert into lab_markers (n) values ($i)" >/dev/null 2>&1 && echo "$i $(now)" >> "$EVID/acks.txt" || break; sleep 0.05; done) &
WRITER=$!
sleep 8
KILLED=$(now); docker kill $P >/dev/null; log "primary killed"
wait $WRITER || true
LAST_ACK=$(tail -1 "$EVID/acks.txt" | cut -d' ' -f1)
psqlp $SPORT 'select pg_promote(true, 120)' >/dev/null
PROMOTED=$(now)
[ "$(psqlp $SPORT 'select pg_is_in_recovery()')" = f ] || { log "FAIL: standby not promoted"; exit 1; }
HAVE=$(psqlp $SPORT "select coalesce(max(n), 0) from lab_markers where n > 1000")
LOST=$((LAST_ACK - HAVE))
LAST_ACK_AT=$(tail -1 "$EVID/acks.txt" | cut -d' ' -f2)
HAVE_AT=$(grep "^$HAVE " "$EVID/acks.txt" | cut -d' ' -f2); HAVE_AT=${HAVE_AT:-$LAST_ACK_AT}
RPO=$(echo "$LAST_ACK_AT - $HAVE_AT" | bc)
psqlp $SPORT "insert into lab_markers (n) values (9999)" >/dev/null
log "promoted in $(echo "$PROMOTED - $KILLED" | bc | xargs printf '%.1f')s; last acknowledged write $LAST_ACK, standby has $HAVE ($LOST lost, ${RPO}s of writes); standby accepts writes"
# The application against the promoted standby.
(cd backend && DB_HOST=127.0.0.1 DB_PORT=$SPORT DB_USER=postgres DB_PASSWORD=$PW DB_NAME=$DBN PORT=$APORT TZ=UTC AUDIT_SEALER=off \
  JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}" INTERNAL_SERVICE_SECRET= CORS_ORIGIN= node server.js > "$EVID/app-on-standby.log" 2>&1) &
APP_PID=$!
for _ in $(seq 1 120); do curl -sf localhost:$APORT/api/ready >/dev/null && break; sleep 0.5; done
READY=$(now)
curl -sf localhost:$APORT/api/ready >/dev/null || { log "FAIL: application did not start on the promoted standby"; tail -5 "$EVID/app-on-standby.log"; exit 1; }
RTO=$(echo "$READY - $KILLED" | bc)
log "application ready on the promoted standby $(printf '%.1f' "$RTO")s after the primary died"

STATUS=PASS
[ "$(echo "$RPO > 300" | bc)" = 1 ] && STATUS=FAIL
[ "$(echo "$RTO > 3600" | bc)" = 1 ] && STATUS=FAIL
cat > "$EVID/standby-drill.json" <<EOF
{"kind": "standby_takeover", "status": "$STATUS", "acknowledged_writes": $(wc -l < "$EVID/acks.txt"), "last_acknowledged": $LAST_ACK,
 "last_on_standby": $HAVE, "acknowledged_writes_lost": $LOST, "rpo_seconds": $(printf '%.2f' "$RPO"),
 "promote_seconds": $(echo "$PROMOTED - $KILLED" | bc | xargs printf '%.1f'), "rto_seconds_to_app_ready": $(printf '%.1f' "$RTO"),
 "rpo_target_seconds": 300, "rto_target_seconds": 3600, "replication": "asynchronous streaming",
 "note": "Single host, local containers: shows the mechanism and timings. A regional failover needs the second-region setup (plan O6).",
 "finished_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"}
EOF
log "$STATUS: point-in-time restore and standby takeover (evidence in $EVID)"
[ "$STATUS" = PASS ]
