#!/bin/sh
# PostgreSQL archive_command: retries are safe, existing segments are never
# overwritten, and a corrupt or different stored segment causes a failure.
set -eu
umask 077
source=${1:?WAL source is required}
segment=${2:?WAL segment name is required}
directory=${HMS_WAL_ARCHIVE_DIR:-/wal-archive}
case "$segment" in ''|.*|*[!A-Za-z0-9._-]*) echo 'Invalid WAL archive name' >&2; exit 2;; esac
destination="$directory/$segment.gz"
same_segment() {
  gzip -t "$destination" && gzip -dc "$destination" | cmp -s "$source" -
}
if [ -e "$destination" ]; then
  same_segment || { echo 'Stored WAL segment is corrupt or differs from the source' >&2; exit 1; }
  exit 0
fi
temporary=$(mktemp "$directory/.wal-$segment.XXXXXX")
trap 'rm -f "$temporary"' EXIT HUP INT TERM
gzip -c "$source" > "$temporary"
gzip -t "$temporary"
sync
# Hard-link creation is atomic and cannot replace another archiver's copy.
if ! ln "$temporary" "$destination" 2>/dev/null; then
  same_segment || { echo 'Concurrent WAL archive differs from the source' >&2; exit 1; }
fi
sync
