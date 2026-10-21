#!/usr/bin/env bash
# One command that tests the whole HMS end to end and prints a plain pass/fail report.
# It starts a throwaway PostgreSQL 18 server in docker (never the hospital database), runs the
# full regression (scripts/e2e-regression.sh: every suite, from registration through discharge,
# billing, laboratory, medication, FHIR/ABDM, backups and security), prints one line per area
# tested, then removes the throwaway server.
#
# Needs: docker; Node 24 with backend, frontend and e2e dependencies installed; Playwright
#   Chromium; Java 17+ and the FHIR validator (tools/fhir-validator/build.sh).
# Usage: scripts/test-everything.sh [report-dir]
# Exit 0 only if every suite passed.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/test-reports/$(date +%Y%m%d-%H%M%S)}"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
PG_PORT="${TEST_PG_PORT:-55438}"
PG="hms-test-everything-$$"
say() { echo "== $*"; }

# ── Check the machine has what the run needs ──
missing=()
command -v docker >/dev/null || missing+=("docker")
command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 24 ] || missing+=("Node 24")
command -v java >/dev/null || missing+=("Java 17+")
command -v psql >/dev/null || missing+=("psql (PostgreSQL client)")
for d in backend frontend e2e; do [ -d "$ROOT/$d/node_modules" ] || missing+=("npm install in $d/"); done
VALIDATOR="${HMS_FHIR_VALIDATOR_DIR:-$HOME/hms-tools/fhir/validator-6.10.4}"
[ -d "$VALIDATOR/classes" ] || missing+=("FHIR validator (run tools/fhir-validator/build.sh)")
if [ ${#missing[@]} -gt 0 ]; then
  echo "Cannot start, missing: ${missing[*]}" >&2; exit 2
fi
if ss -ltn 2>/dev/null | grep -q ":$PG_PORT "; then
  echo "Port $PG_PORT is in use; set TEST_PG_PORT to a free port" >&2; exit 2
fi

# ── Throwaway database server ──
cleanup() { docker rm -f -v "$PG" >/dev/null 2>&1 || true; }
trap cleanup EXIT
say "starting a throwaway PostgreSQL 18 server on port $PG_PORT"
docker run -d --name "$PG" -p "127.0.0.1:$PG_PORT:5432" -e POSTGRES_PASSWORD=postgres postgres:18-alpine >/dev/null || exit 2
for _ in $(seq 1 60); do docker exec "$PG" pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done

# ── Full regression ──
say "running every suite (about an hour); live progress in $OUT/summary.txt"
start=$(date +%s)
DB_HOST=127.0.0.1 DB_PORT="$PG_PORT" DB_USER=postgres DB_PASSWORD=postgres HMS_FHIR_VALIDATOR_DIR="$VALIDATOR" \
  "$ROOT/scripts/e2e-regression.sh" "$OUT" > "$OUT/run.log" 2>&1
code=$?
mins=$(( ($(date +%s) - start) / 60 ))

# ── Report ──
{
  echo "HMS end-to-end report"
  echo "Commit: $(git -C "$ROOT" rev-parse --short HEAD)   Date: $(date '+%Y-%m-%d %H:%M')   Took: ${mins} min"
  echo
  if [ -s "$OUT/summary.txt" ]; then
    # summary lines look like: "<suite> exit=<n> :: <What was tested>: <a>/<b> steps passed"
    sed -E 's/^([^ ]+) exit=([0-9]+) :: ?(.*)$/\2|\1|\3/' "$OUT/summary.txt" | while IFS='|' read -r ex suite what; do
      [ "$ex" = 0 ] && mark="PASS" || mark="FAIL"
      printf '%-5s %s\n' "$mark" "${what:-$suite (no result, see r-$suite.log)}"
    done
    echo
    total=$(grep -c ' exit=' "$OUT/summary.txt"); bad=$(grep -vc ' exit=0 ' "$OUT/summary.txt")
    echo "$((total - bad)) of $total areas passed."
    [ "$bad" -gt 0 ] && echo "Details of each failure: $OUT/r-<suite>.log"
  else
    echo "The run stopped before any test ran. Last lines of the log:"
    tail -n 20 "$OUT/run.log"
  fi
} | tee "$OUT/REPORT.txt"
echo
echo "Report saved to $OUT/REPORT.txt"
exit "$code"
