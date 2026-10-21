#!/usr/bin/env bash
# Full end-to-end regression (completion A1) on throwaway databases built from the migrations and
# the demo seed, the same way on a workstation and in CI. It starts its own API, frontend, virus
# scanner fixture, ABDM mock and write-once storage, runs every suite in the order their fixtures
# need, and writes one line per suite to <out-dir>/summary.txt. Exit 0 only if every suite passed.
#
# Needs: a PostgreSQL superuser reachable at DB_HOST/DB_PORT/DB_USER/DB_PASSWORD; psql/createdb;
#   Node 24 with backend, frontend and e2e dependencies installed and Playwright Chromium; docker
#   (MinIO for the write-once audit suite); Java and the FHIR validator for the FHIR suites
#   (HMS_FHIR_VALIDATOR_DIR, see tools/fhir-validator/build.sh).
# It only ever creates and drops the databases named by E2E_DB_NAME (hms_p4_p5_*) and
# E2E_TEMPLATE_DB (hms_verify_*); every key it uses is generated for the run.
# Usage: scripts/e2e-regression.sh [out-dir]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$(mktemp -d)}"; mkdir -p "$OUT"; OUT="$(cd "$OUT" && pwd)"
WORK="$OUT/work"; rm -rf "$WORK"; mkdir -p "$WORK/docstore" "$WORK/kit" "$WORK/ckpt"; chmod 700 "$WORK"

export DB_HOST="${DB_HOST:-127.0.0.1}" DB_PORT="${DB_PORT:-5432}" DB_USER="${DB_USER:-postgres}" DB_PASSWORD="${DB_PASSWORD:-postgres}"
export PGPASSWORD="$DB_PASSWORD"
DB_NAME="${E2E_DB_NAME:-hms_p4_p5_ci}"; TEMPLATE="${E2E_TEMPLATE_DB:-hms_verify_ci_template}"
[[ "$DB_NAME" =~ ^hms_p4_p5_ ]] || { echo "E2E_DB_NAME must start with hms_p4_p5_" >&2; exit 2; }
[[ "$TEMPLATE" =~ ^hms_verify_ ]] || { echo "E2E_TEMPLATE_DB must start with hms_verify_" >&2; exit 2; }
API_PORT="${E2E_API_PORT:-5099}"; VITE_PORT="${E2E_VITE_PORT:-5299}"; MOCK_PORT="${E2E_MOCK_PORT:-9399}"
CLAM_PORT="${E2E_CLAMAV_PORT:-13399}"; MINIO_PORT="${E2E_MINIO_PORT:-9411}"
export E2E_SECOND_PORT="${E2E_SECOND_PORT:-15599}"
rand() { node -e "process.stdout.write(require('crypto').randomBytes($1).toString('hex'))"; }
log() { echo "[e2e] $*"; }

# ── Databases: migrations and the demo seed, nothing copied from any hospital database ──
pg() { psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -v ON_ERROR_STOP=1 "$@"; }
for D in "$DB_NAME" "$TEMPLATE"; do
  dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists --force "$D"
  createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$D"
  (cd "$ROOT/backend" && DB_NAME="$D" HMS_TEST_DATABASE=true node migrate.js up >/dev/null && DB_NAME="$D" HMS_TEST_DATABASE=true node seed_demo_data.js >/dev/null)
done
log "databases $DB_NAME and $TEMPLATE built from migrations and the demo seed"

# ── Settings for this run only ──
export DB_NAME PHASE4_FOUNDATION_DB_NAME="$TEMPLATE" TZ=UTC
export JWT_SECRET="$(rand 32)" HMS_DATA_KEYS="cfa:$(rand 32)" DOWNTIME_KIT_KEY="$(rand 32)" BACKUP_ENCRYPTION_KEY="$(rand 32)" AUDIT_CHECKPOINT_KEY="$(rand 32)"
export HMS_DOCUMENT_DIR="$WORK/docstore" DOWNTIME_KIT_DIR="$WORK/kit" AUDIT_CHECKPOINT_DIR="$WORK/ckpt"
export CLAMAV_HOST=127.0.0.1 CLAMAV_PORT="$CLAM_PORT"
export E2E_API="http://localhost:$API_PORT/api" E2E_BASE="http://localhost:$VITE_PORT"
FAC=$(pg -d "$DB_NAME" -Atc "SELECT hms_initial_facility()"); ADMIN=$(pg -d "$DB_NAME" -Atc "SELECT id FROM hms_users WHERE username='admin'")
export HMS_WORKER_USER_ID="$ADMIN" HMS_ABDM_SERVICE_USER_ID="$ADMIN" HMS_ABDM_FACILITY_ID="$FAC"
export HMS_EXTERNAL_EFFECTS=enabled HMS_ABDM_IDEMPOTENCY_SUPPORTED=true ABDM_WORKER=off
export ABDM_MOCK_URL="http://127.0.0.1:$MOCK_PORT" ABDM_GATEWAY_URL="http://127.0.0.1:$MOCK_PORT" ABDM_ABHA_URL="http://127.0.0.1:$MOCK_PORT" ABDM_GATEWAY_JWKS_URL="http://127.0.0.1:$MOCK_PORT/certs"
export ABDM_BRIDGE_PUBLIC_URL="http://127.0.0.1:$API_PORT/abdm" ABDM_CLIENT_ID=synthetic-ci ABDM_CLIENT_SECRET="$(rand 16)" ABDM_CM_ID=sbx ABDM_HIP_ID=HMS-HIP ABDM_HIU_ID=HMS-HIU

# ── Write-once audit storage (MinIO with Object Lock), private to this run ──
MINIO="hms-e2e-minio-$$"
PIDS=()
cleanup() {
  for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
  docker rm -f "$MINIO" >/dev/null 2>&1 || true
}
trap cleanup EXIT
ROOT_PW=$(rand 16); SHIP_PW=$(rand 16)
docker run -d --name "$MINIO" -p "127.0.0.1:$MINIO_PORT:9000" --tmpfs /data:size=256m -e MINIO_ROOT_USER=e2eroot -e MINIO_ROOT_PASSWORD="$ROOT_PW" \
  minio/minio:RELEASE.2025-09-07T16-13-09Z server /data >/dev/null
for _ in $(seq 1 60); do curl -sf "localhost:$MINIO_PORT/minio/health/live" >/dev/null && break; sleep 1; done
mc() { docker exec "$MINIO" mc "$@"; }
mc alias set local http://127.0.0.1:9000 e2eroot "$ROOT_PW" >/dev/null
mc mb --with-lock local/hms-audit >/dev/null; mc retention set --default COMPLIANCE 1d local/hms-audit >/dev/null
docker exec -i "$MINIO" sh -c 'cat > /tmp/ship.json' <<'J'
{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:PutObject","s3:GetObject","s3:GetObjectVersion","s3:GetObjectRetention","s3:ListBucket","s3:GetBucketObjectLockConfiguration"],"Resource":["arn:aws:s3:::hms-audit","arn:aws:s3:::hms-audit/*"]}]}
J
mc admin policy create local ship-only /tmp/ship.json >/dev/null; mc admin user add local shipper "$SHIP_PW" >/dev/null; mc admin policy attach local ship-only --user shipper >/dev/null
export AUDIT_WORM_BUCKET=hms-audit AUDIT_WORM_ENDPOINT="http://127.0.0.1:$MINIO_PORT" AUDIT_WORM_REGION=us-east-1 AUDIT_WORM_ACCESS_KEY=shipper AUDIT_WORM_SECRET_KEY="$SHIP_PW" AUDIT_SHIP_INTERVAL_MS=3000

# ── Services ──
start() { local name=$1; shift; ( "$@" > "$OUT/$name.log" 2>&1 < /dev/null ) & PIDS+=($!); }
start clamav  bash -c "cd '$ROOT/e2e' && exec node fixtures/clamavFixture.js"
start mock    bash -c "cd '$ROOT/backend' && PORT=$MOCK_PORT exec node scripts/abdm-mock-gateway.js"
sleep 2
start api     bash -c "cd '$ROOT/backend' && DEVICE_MLLP=on RATE_LIMIT_MAX_AUTH=1000 RATE_LIMIT_MAX_API=100000 INTERNAL_SERVICE_SECRET= CORS_ORIGIN= PORT=$API_PORT exec node server.js"
start vite    bash -c "cd '$ROOT/frontend' && VITE_BACKEND_TARGET=http://localhost:$API_PORT exec npx vite --port $VITE_PORT --strictPort"
for _ in $(seq 1 60); do curl -sf "localhost:$API_PORT/api/ready" >/dev/null && break; sleep 1; done
curl -sf "localhost:$API_PORT/api/ready" >/dev/null || { log "API did not become ready"; tail -n 20 "$OUT/api.log"; exit 1; }
for _ in $(seq 1 60); do curl -sf -o /dev/null "localhost:$VITE_PORT" && break; sleep 1; done
log "API :$API_PORT, frontend :$VITE_PORT, ABDM mock :$MOCK_PORT, scanner :$CLAM_PORT, MinIO :$MINIO_PORT"

# ── Suites, in the order their fixtures need ──
cd "$ROOT/e2e"
node fixtures/clinicianFixture.js > "$OUT/clinician.log" 2>&1
: > "$OUT/summary.txt"
failed=0
run() {
  local s=$1 code=0
  timeout 1500 node "$s.e2e.js" > "$OUT/r-$s.log" 2>&1 < /dev/null || code=$?
  local line; line="$s exit=$code :: $(grep -E 'steps passed' "$OUT/r-$s.log" | tail -1 || true)"
  echo "$line" | tee -a "$OUT/summary.txt"
  [ "$code" -eq 0 ] || failed=$((failed + 1))
}
FIRST="facilitySessions facilityLifecycle medication medicationFrontend medicationGuards pharmacy devices phase45"
LAST="auditWorm v2Contract"
for s in $FIRST; do run "$s"; done
for s in $(ls *.e2e.js | sed 's/\.e2e\.js$//'); do
  case " $FIRST $LAST " in *" $s "*) continue ;; esac
  run "$s"
done
for s in $LAST; do run "$s"; done
total=$(grep -c ' exit=' "$OUT/summary.txt")
log "$((total - failed))/$total suites passed (logs in $OUT)"
[ "$failed" -eq 0 ]
