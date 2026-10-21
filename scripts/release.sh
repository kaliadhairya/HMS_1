#!/usr/bin/env bash
# Release a new HMS version on a Docker Compose host, with an automatic rollback (completion B8).
# Usage: scripts/release.sh [compose-file]        (default: docker-compose.prod.yml)
#
#  1. The images now running (backend, worker, frontend) are kept as the rollback point.
#  2. A fresh backup is taken (scripts/backup-db.sh); a release never starts without one.
#  3. The new images are built.
#  4. Migrations run as their own job. They must be compatible with the version still running
#     (add, never remove or rename); a rollback does not undo them. A failed migration stops the
#     release before anything is replaced. The restricted runtime identity is then granted the
#     new schema (the runtime-role job).
#  5. The worker, then the backend, then the frontend are recreated. docker stop drains each
#     instance first (stop_grace_period is longer than HMS_DRAIN_TIMEOUT_MS).
#  6. The release waits until backend and worker report healthy (RELEASE_HEALTH_TIMEOUT seconds,
#     default 180). If they do not, the kept images are put back and must become healthy.
# Exit 0 released; 1 refused or rolled back to the previous version; 2 rollback impossible or
# failed (the operator must act: see docs/clinical-final/OPERATIONS.md, section 10 "Releases").
set -euo pipefail
cd "$(dirname "$0")/.."
COMPOSE_FILE="${1:-docker-compose.prod.yml}"
TIMEOUT="${RELEASE_HEALTH_TIMEOUT:-180}"
SERVICES="worker backend frontend"
CHECKED="backend worker"
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }
log() { echo "[release] $*"; }

health() { # healthy | unhealthy | starting | missing
  local cid; cid=$(dc ps -q "$1" 2>/dev/null || true)
  [ -n "$cid" ] || { echo missing; return; }
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid"
}
wait_healthy() {
  local deadline=$((SECONDS + TIMEOUT)) svc state all
  while [ $SECONDS -lt $deadline ]; do
    all=1
    for svc in $CHECKED; do state=$(health "$svc"); [ "$state" = healthy ] || all=0; done
    [ $all = 1 ] && return 0
    sleep "${RELEASE_POLL_SECONDS:-5}"
  done
  for svc in $CHECKED; do log "$svc is $(health "$svc")"; done
  return 1
}

# 1. Rollback point: the image of each running service, under a name a rebuild cannot replace.
declare -A IMAGE_NAME=()
for svc in $SERVICES; do
  cid=$(dc ps -q "$svc" 2>/dev/null || true)
  [ -n "$cid" ] || continue
  IMAGE_NAME[$svc]=$(docker inspect -f '{{.Config.Image}}' "$cid")
  docker tag "$(docker inspect -f '{{.Image}}' "$cid")" "hms-release-rollback/$svc:latest"
  log "rollback point for $svc kept"
done

# 2–4. Backup, build, migrate. Nothing running is changed if any of these fails.
HMS_BACKUP_DIR="${HMS_BACKUP_DIR:-$HOME/hms-backups}" DB_NAME="${DB_NAME:-hms}" bash scripts/backup-db.sh "$COMPOSE_FILE" \
  || { log "REFUSED: the backup failed; nothing was changed."; exit 1; }
dc build $SERVICES migrate || { log "REFUSED: the build failed; nothing was changed."; exit 1; }
dc run --rm migrate || { log "REFUSED: the migration failed; the running version is unchanged. Investigate before retrying."; exit 1; }
dc run --rm runtime-role || { log "REFUSED: the runtime identity could not be granted the new schema; the running version is unchanged."; exit 1; }

# 5–6. Replace and check.
for svc in $SERVICES; do dc up -d --no-deps --no-build "$svc"; done
if wait_healthy; then
  # Supporting services (HTTPS proxy, metrics, dashboards) are started if they are not running.
  dc up -d --no-build proxy prometheus grafana || log "warning: a supporting service did not start"
  log "RELEASED: backend and worker are healthy."; exit 0
fi

log "The new version is not healthy; rolling back."
if [ ${#IMAGE_NAME[@]} -eq 0 ]; then log "ROLLBACK IMPOSSIBLE: there was no running version to return to."; exit 2; fi
for svc in $SERVICES; do
  [ -n "${IMAGE_NAME[$svc]:-}" ] || continue
  docker tag "hms-release-rollback/$svc:latest" "${IMAGE_NAME[$svc]}"
  dc up -d --no-deps --no-build "$svc"
done
if wait_healthy; then log "ROLLED BACK: the previous version is running and healthy. Migrations from this release remain applied."; exit 1; fi
log "ROLLBACK FAILED: the previous version is not healthy either. Follow the recovery procedure."
exit 2
