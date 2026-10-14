# HMS clinical Phase 4: complete laboratory loop

Phase 4 implementation and review are complete on `phase4/laboratory`, based
on integrated Phase 2/3 `01c19aa`. All 30 verification suites have passing
results, including the affected-scope rerun after review fixes. No shared
deployment or production database migration has been performed.

## Implemented behavior

| Area | Behavior |
|---|---|
| Catalogue and ordering | Stable codes and immutable approved test/panel versions; explicit method, unit, specimen/container requirements and tariff reference; encounter finalization lock; care-team and practitioner checks; no display-name identity guesses |
| Legacy reconciliation | Existing free-text items remain quarantined for explicit reviewed mapping; original evidence retained; ungoverned sample/result/report write paths return 410 |
| Specimens | Actual opaque accession, patient identity, collector and collection/receipt times; multi-test links and multi-specimen requirements; custody trail, reasons, rejection/recollection and immutable aliquot lineage |
| Results and QC | Append-only raw/normalized result versions, explicit validated decimal conversion, author/method/analyzer run/QC provenance; stale If-Match gives 412; common order locking preserves concurrent analyte completion |
| Technical review | Current exact-version review with declared QC evidence; failed/repeat QC returns to processing; reviewed results require linked corrections; rejected/missing required specimens prevent verification and release |
| Report release | Separate time-limited clinical release privilege; exact immutable included versions; preliminary/final/amended states, retained originals, signed release actor/time and recipient events; final/amended reports require all active analytes |
| Clinical policy | Separate versioned approved intervals and critical policies; explicit comparator inclusivity; provenance, method/unit, sex/age context and effective dates; no normal flag for missing content; no guessed conversion or escalation timetable |
| Critical follow-up | Verified critical findings open durable tasks before report release; recipient/contact attempts, acknowledgment and clinical action are separate; configured escalation snapshots; unavailable recipients remain unresolved; corrected critical findings open a new cycle; discharge does not close tasks |
| Analyzer contract | Version 1 accession/patient/item matching; transactional inbox, canonical request fingerprints and stable message deduplication; validation failures enter reconciliation; imports stay provisional; original message/run and resulting version remain linked |
| Frontend | Orders, accession labels/custody, rejected-specimen worklist, provisional result editing, conflict-draft preservation, actual QC, technical review, authorized release/amendment, exact PDFs, critical communication/action, clinician review and reconciliation |
| Infrastructure integration | Explicit endpoint roles, required idempotency, inherited command transaction, audit triggers/read gating and transactional outbox; standalone escalation worker; migrations remain outside API startup |

Migrations `0050`–`0059` are additive. Every new application table has enforced
relationships, constraints and audit capture. Approved result/report/policy
versions and their children cannot be silently altered. Clinical configuration
and privilege tables are empty after migrations; all acceptance content is
synthetic and created only in throwaway tests.

The frontend workflow is:

`Coded order → label and identity confirmation → collection/custody → receipt
or rejection/recollection → provisional result → QC and technical review
→ authorized report release → clinician review and documented action`.

Critical communication branches from technical verification immediately.
Corrections retain originals and restart communication when the new finding
is critical. A lost response branches to reconciliation of the original save,
not an assumed success or a second command. Historical editors stay read-only.

See [OPERATIONS.md](OPERATIONS.md) for clinical operating steps, approved
configuration and the separately supervised escalation worker.

## Verification

Private testing uses PostgreSQL 16 at `127.0.0.1:5434`, databases `hms_p4_*`,
API `5022`, Vite `5194`, matching private signing material and isolated audit
checkpoint directories. Tests never target the shared database `hms`.

Restore the newest backup into a fresh Phase 4 copy; the PostgreSQL 18 dump's
unsupported `SET transaction_timeout = 0` setting is the sole statement
omitted during PostgreSQL 16 restoration. All data/schema errors are fatal.
Use a separate migrated foundation copy without a competing live dispatcher.

```sh
# Supply private DB_*, JWT_SECRET, audit and E2E_API/E2E_BASE configuration.
# DB_NAME and PHASE4_FOUNDATION_DB_NAME must start with hms_p4_.
export HMS_TEST_DATABASE=true
(cd backend && node migrate.js up)
(cd backend && DB_NAME="$PHASE4_FOUNDATION_DB_NAME" node migrate.js up)
node backend/scripts/phase4-test-fixtures.js
# Start isolated API with TZ=UTC and RATE_LIMIT_MAX_AUTH=1000.
# Start Vite with VITE_BACKEND_TARGET=http://localhost:5022, port 5194.
node backend/scripts/verify-phase4.js
(cd backend && bash scripts/verify-migrations.sh)
# Repeat migration verification on the separate private PostgreSQL 18 server.
(cd frontend && npm run build -- --outDir /tmp/hms-phase4-build --emptyOutDir)
```

The verifier runs the original foundation assertions with only their allowed
throwaway namespace adapted, all medication/laboratory workflows and every
Phase 1/2/3 regression. Audit runs last because its checkpoint scenario
deliberately tampers with the private audit history. Do not use that post-drill
copy as a clean clinical environment.

The legacy laboratory suite now checks retained historical reads/PDFs, scope,
role boundaries, retired writes and governed entry URLs. Full diagnostic safety
is covered by the new laboratory suites. OPD preserves its encounter/draft,
allergy, clinical and financial assertions while using the coded workspace
instead of the retired name-only investigation form.

## Checked results (14 October 2026)

Evidence and log hashes are in [verification.json](verification.json). The
full regression exposed a legacy dashboard field compatibility issue. Its
failed result remains recorded; the final targeted validation reran the full
lab safety, guard, browser, legacy compatibility and administration suites
after correction, plus real competing worker processes. No failures remain
in the latest results.

| Check | Result |
|---|---:|
| Laboratory diagnostic safety / evidence guards / browser / worker | 21/21, 8/8, 6/6, 3/3 (38 new scenarios) |
| Backend unit / original foundation transaction failures | 10 pass, 1 database suite skipped here; separately 16/16 |
| Medication / medication guards / medication browser | 20/20, 9/9, 6/6 |
| OPD / pharmacy / legacy lab compatibility / inpatient / administration | 20/20, 18/18, 10/10, 13/13, 28/28 |
| Authorization / sessions / idempotency / durability | 5/5, 7/7, 8/8, 11/11 |
| Frontend reliability / inpatient draft concurrency | 2/2, 2/2 |
| Patient identity / merge / practitioners / scheduling | 9/9, 8/8, 8/8, 6/6 |
| Care teams / triage / clinical documents / ADT / referrals | 10/10, 7/7, 8/8, 8/8, 8/8 |
| Audit | 7/7, deliberately tampered private copy afterwards |
| PostgreSQL 16 / 18 clean and legacy migration verification through 0059 | Both pass, 3,191 matching fresh/upgrade schema facts per engine |
| Production frontend build / undefined-variable and declaration-order checks / whitespace | Pass |

The historical two inpatient billing failures did not reproduce with this
run's fixtures. That does not complete Phase 5 or validate invoicing coded
medication/source charges. The revenue-cycle integration gate remains open.

Implementation commits: `d8aa608`, `f1db406`, `2a67e75`, `7f886b6`,
`e852dea`, `a1a76e2`, `dccf04f`. Private logs are under
`/tmp/hms-phase4-work/release-evidence` and `validation-evidence`.

## Review and integration gates

| Gate | Required action |
|---|---|
| Clinical content | Hospital/laboratory owners supply and validate terminology, specimen requirements, QC criteria, reference intervals, critical policies and escalation timetables; synthetic passes do not approve medical content |
| Existing consultation investigation form and doctor navigation | Integrate the Phase 4 workspace/coded versions into the files owned by Phase 2/3; request in `docs/requests/phase4-clinical-navigation.md`; use `/lab/governed?patient_id=<id>` until that integration |
| Clinical release privileges | Administrator records explicit scoped time-limited grants; an administrative account cannot sign a report |
| Existing name-based billing | Phase 5 must consume the coded tariff/source identity; laboratory provenance does not validate the revenue-cycle phase |
| Escalation operations | Deploy/supervise the dedicated worker with explicit polling cadence and an active authorized laboratory identity; monitor overdue open tasks and delivery failures |
| Regional/fleet operations | Mission Control tenancy, backups, recovery and service objectives remain their own architecture gates |
| Shared deployment | Owner-approved integration and backup precede deployment; this branch does not deploy or merge itself into the shared app |

Initial defects caught during verification included Sequelize comparator
parameter syntax, the nested-savepoint evidence-child guard, exact-boundary
inclusivity and an accessible label that blocked OPD catalogue selection, and the existing dashboard abnormal-count compatibility alias. Each
was corrected and tested again. These are implementation findings, not silently
accepted failures.
