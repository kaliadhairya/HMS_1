# HMS clinical Phase 3: medication safety and nursing

Worktree: `HMS_1-phase3`; branch: `phase3/medication-safety`.
Base: Phase 1 `09df78e`. The main Phase 2 worktree was not used for implementation.
No shared Docker deployment, production database migration or merge was performed.
This is the clinical medication phase, not Mission Control's fleet-operations phase.

## Implementation

| Area | Implemented behavior |
|---|---|
| Products and formulary | Coded ingredients/composition, product strength/concentration, route/form, base/pack conversion and precision; immutable approved identities and versioned formulary/rule packs; draft legacy identities and reconciliation queue |
| Medication orders | Stable UUID and immutable signed versions; explicit patient/encounter/admission relationships; structured interval and PRN fields; separate sign/hold/resume/discontinue/amend commands; 428/412 expected-revision handling |
| Allergy/CDS | Explicit review state separate from allergies; coded ingredient checks, duplicate therapy and configurable interaction/dose/route/age/weight/renal checks; input snapshot, coverage and exact-version assessment; reasoned permitted overrides approved by an independent pharmacist |
| Verification and supply | Exact-version verify/clarification tasks; authorized substitution; FEFO available-lot selection; locked remaining balance; atomic stock movement, supply and exact-decimal immutable charge |
| Location inventory | Audited balances/movements; real supplier/manufacturer-lot/expiry provenance; quarantine of undocumented stock; recall preservation; fractional base units and explicit pack conversion; ward approval/pick/in-transit/acknowledgment |
| Returns and retail | Quarantine and separate pending credit; approved formulary permission plus a recorded pharmacist review for counter sales; known ingredient allergies and controlled drugs cannot bypass coded prescribing |
| Nursing/eMAR | Verified schedules and explicit PRN occurrences; bedside scan/manual evidence; durable claim before administration; one outcome per occurrence; actual versus recorded time; exceptions/reassessment tasks; pending documentation and exact prescriber-reviewed late documentation |
| Controlled drugs | Independent authenticated witness requests/attestations, exact action snapshot and expiry/one-command use; supply/administration/return/wastage/transfer register; shift counts, investigation and closure |
| Handover and UI | SBAR and task transfer only after receiver acknowledgment; consultation, pharmacy, stock, catalogue, nursing, controlled and witness screens; confirmed save state, preserved conflicts, stale observations and original-key reconciliation |
| Foundation integration | Explicit endpoint roles, mandatory idempotency, one inherited Sequelize transaction, transactional outbox, audited tables and before-first-byte clinical-read auditing; migration execution stays outside startup |

Migrations `0030`–`0043` are additive; previously committed migrations were not
changed. Every new application table has indexed relationships, constraints
and an audit trigger. Knowledge packs are not seeded with production clinical
rules. Synthetic test values and approved fixture content live only in tests.

The legacy dispense aliases reject free-text supply. Name-based medicine linking
and demographic patient-history unions were removed. Legacy note creation
checks patient/encounter identity and cannot spoof supply status; note mutations
share the encounter finalization lock. Historical free text stays readable.

## Blueprint finding coverage

| Finding | Control and evidence |
|---|---|
| F05 | Stable coded order/version IDs, signing immutability, expected revisions and guarded transitions; legacy patient/encounter validation and finalization serialization; medication and additional guard suites |
| F06 | No name-derived medicine binding; legacy supply rejected; coded product/strength/form/route and authorized substitution checked; partial fill and concurrency scenarios |
| F07 | Actual manufacturer-lot/expiry source records, no guessed identity approval, undocumented lot quarantine and reviewed release; provenance and inventory scenarios |
| F08 | Verified schedules, supplied patient/product, scan/manual bedside checks, one outcome, durable post-dose documentation, linked corrections and reviewed late documentation; backend/browser scenarios; old-MAR retirement remains a Phase 2 integration gate |
| F14 | Explicit unknown/none-known review state, server assessments and declared missing coverage, immutable rule provenance, reasoned independent override review; no production clinical content seeded |
| F17 | Deterministic stock locking, real-PG receipt/dispense races and invoice idempotency, atomic source charges, witnessed register/count/discrepancy and approved retail boundaries; revenue-cycle integration remains Phase 5 |

## Frontend workflow

`Review identity/allergies → coded draft → assessment preview → prescriber sign
→ independent pharmacist review → partial FEFO supply → verified occurrence
→ bedside identity/dose/route/time checks → documentation claim → recorded
outcome → reassessment/escalation → acknowledged handover`.

The catalogue and stock workflows retain source evidence. Controlled actions
branch to an independent witness inbox. A lost post-dose response branches to
pending documentation and reconciliation, never another dose. The operations
manual is [OPERATIONS.md](OPERATIONS.md).

## Verification environment and reproducible commands

Tests use Docker PostgreSQL 16 on `127.0.0.1:5434`, private Phase 3 databases,
backend `5012`, and Vite `5184`. The foundation suite uses a separate migrated
`hms_p3_*` database without a live dispatcher so its ordering fixture has no
competing allocator. Backend and test runner share a private JWT secret;
credentials are not in this repository or report.

Restore the newest `~/hms-backups/<timestamp>/hms.dump` into fresh throwaway
copies. The PostgreSQL 18 dump is restored into PostgreSQL 16 with only its
unsupported `SET transaction_timeout = 0` session setting omitted. The restore
runs with `ON_ERROR_STOP`; no data/schema errors are ignored. Retain an isolated
checkpoint directory for each clinical test database.

```sh
# Set private DB_*, JWT_SECRET, E2E_API/E2E_BASE and audit environment values.
# DB_NAME and PHASE3_FOUNDATION_DB_NAME must both start with hms_p3_.
export HMS_TEST_DATABASE=true
node backend/scripts/phase3-preflight.js
(cd backend && node migrate.js up)
# Apply the same chain to the separate foundation copy.
(cd backend && DB_NAME="$PHASE3_FOUNDATION_DB_NAME" node migrate.js up)
node backend/scripts/phase3-test-fixtures.js
# Start the own-worktree backend with TZ=UTC and RATE_LIMIT_MAX_AUTH=1000.
# Start Vite with VITE_BACKEND_TARGET=http://localhost:5012, port 5184.
node backend/scripts/verify-phase3.js
(cd backend && bash scripts/verify-migrations.sh) # PostgreSQL 16 test server
# Repeat verify-migrations.sh with the private PostgreSQL 18 DB_HOST/DB_PORT.
(cd frontend && npm run build -- --outDir /tmp/hms-phase3-build --emptyOutDir)
```

The full verifier runs unit tests with database cases disabled, then the
unchanged Phase 1 assertions through the namespace-safe harness with explicit
database opt-in, every new medication/browser suite, and all existing regression
suites. It runs audit last because its final scenario deliberately rewrites a
throwaway audit chain to prove protected-checkpoint detection. Do not use that
post-drill database as a clean clinical environment.

The bed-fixture script adds two free synthetic beds to the existing private
ward in the restored test copy. It never changes occupied beds or real
admissions. Regression changes preserve clinical/financial assertions while
using decimal-aware quantities, the governed supply/retail paths, a synthetic
historical-invoice compatibility fixture and a signed-order amendment as the
outbox trigger. Replica settings are checked within the documented refresh
interval; the Phase 3 replica uses port `15112`.

Final candidate results and command evidence are recorded in
[verification.json](verification.json). All 17 verifier suites passed:

| Suite | Result |
|---|---:|
| Backend unit tests | 10 passed, 1 database suite skipped here and run separately |
| Phase 1 failure/transaction integration | 16/16 |
| Medication safety | 20/20 |
| Provenance, timing, identity and retail guards | 9/9 |
| Medication browser workflows | 6/6 |
| Pharmacy | 18/18 |
| OPD | 20/20 |
| Laboratory | 10/10 |
| Inpatient | 13/13 in this restored fixture run |
| Administration | 28/28 |
| Authorization / sessions / idempotency | 5/5, 7/7, 8/8 |
| Durability | 11/11 |
| Frontend reliability / IPD drafts | 2/2, 2/2 |
| Audit | 7/7 |
| PostgreSQL 16 and 18 migration verification | Both pass: 2,118 matching fresh/upgrade schema facts through 0043 |
| Production frontend build / static checks / whitespace check | Pass |

The two historically known inpatient billing failures did not occur with this
run's fixtures. That observation does not complete Phase 5 or validate new
medication-charge invoicing. No such phase-completion claim is made.

Verification source commits: backend `e8c3037`, safety hardening `6bb3be5`,
frontend `9107801`, regression adaptation `a7548b4`. Logs are private local
artifacts in `/tmp/hms-phase3-work/candidate-evidence`; the committed JSON keeps
results, commands, timestamps and log hashes without raw patient data.

## Review and clinical go-live gates

| Gate / limitation | Required next action |
|---|---|
| Phase 2 branch integration | Rebase onto its owner-approved merged result and rerun all checks; apply its care-team authorization/practitioner mapping and shared patient banner |
| Existing `/api/ipd/mar` writes | Phase 2 owns the file and must reject/remove the free-text writes before clinical enablement; keep labelled historical reads |
| Existing role navigation / dashboard keys | Owner integrates medication routes and changes name-based pharmacist dashboard keys to stable medicine IDs; requests are in `docs/requests/` |
| Legacy identity ambiguity | Draft products/free-text lines stay unapproved and unlinked; an authorized clinician must reconcile them. The preflight blocks blank/unsupported numeric identities or missing controlled classification before the first migration; it never repairs them by guessing |
| Historical draft-note reconciliation | Some old legacy lines are referenced by reconciliation records; their destructive replacement is rejected. Use the coded order workflow and retain historical evidence rather than deleting referenced lines |
| Clinical knowledge | Hospital/clinical owners must supply and validate rule packs, formulary permissions, terminology and local protocols; passing synthetic scenarios is not approval of clinical content |
| Corrections | Linked corrections retain original administrations and create review tasks; dose/stock corrections and current effective usage need domain reconciliation, not silent edits |
| Revenue / credits | Phase 5 must invoice source charges once, retain explicit episode relationships, and handle pending return credits. This branch does not claim the revenue-cycle phase is complete |
| Wider fleet / compliance | Tenant infrastructure, regional recovery, production performance and formal clinical/compliance validation remain their own roadmap gates; no such service-level claim is made by these tests |

[PARALLEL_WORK.md](</home/kalmaf/Desktop/projects all i made/HMS_1/docs/PARALLEL_WORK.md>) is supplied in the main worktree; see
`HMS_1/docs/PARALLEL_WORK.md` for the authoritative ownership and merge rules.
The owner decides the merge/deployment. Phase 4 should start from the reviewed,
merged Phase 3 result after Phase 2 integration, as that file requires.
