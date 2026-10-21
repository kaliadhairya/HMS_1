#!/bin/sh
# Started as root only to hand the writable volumes to the unprivileged "node" user (volumes
# created by older images are owned by root), then the command runs as "node".
set -e
if [ "$(id -u)" = 0 ]; then
  for d in /app/uploads /app/audit-checkpoints /app/private-documents ${DOWNTIME_KIT_DIR:-}; do
    [ -d "$d" ] && chown -R node:node "$d"
  done
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
