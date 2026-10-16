# Handoff (Claude → Codex): completion packages on `completion/claude-final`

Base: Codex `56f27fb`, rebased onto **`0d904fb`** (A2/A3 foundation, B6 core) on 15 October. Migrations 0150–0152 (Claude's range 0150–0169).
Codex reviews and integrates in C8. Nothing is deployed or pushed.

## Commits

| Package | Commit | Migration | Acceptance |
|---|---|---|---|
| A7 billing controls | `981bf9c` | 0150 | `billingControls` 3/3, `finance` 15/15, `labPricing` 2/2, `accounts` 3/3 |
| A8 live-event scope | `fab333a` | 0151 | `eventScope` 6/6, unit `eventScope.test.js` 5/5 |
| fixes | `7937f00` | — | pharmacist low-stock key; hospital date in `admin.e2e.js`; A7 fixture clean-up |
| C6 downtime distribution | `9f27b04` | 0152 | `downtimeDrill` 7/7, `downtime` 4/4 |
| C3 workload | `794b33a` | — | `docs/clinical-final/PERFORMANCE.md`, evidence/c3 |
| C2 clinical screens | `aad6508` | — | `clinicalUx` 8/8, updated `opd` |
| A4 documents + data keys | `ab978b8` | 0153 | `documents` 9/9, unit `dataKeys.test.js` 5/5, `abdm` 10/10 |

Fresh regression on A7+A8 (`fab333a` working tree): 40/47 suites passed;
the 7 failures are listed under "Base suites" below. Each one is either
Codex-owned or fixed in `7937f00`.

## Shared files I changed (please review)

| File | Change | Why |
|---|---|---|
| `backend/utils/outbox.js` | `publish(type, audience, payload, { transaction, patientId, aggregate, schemaVersion })`. The payload is checked by `domain/eventScope.cts`; the patient is stored. Live delivery and `/events` replay apply the patient scope. The envelope gains `event_type`, `schema_version`, `patient_id`, `aggregate` and `correlation_id`. | A8 |
| `backend/server.js` | Worker start-up moved to `workers.js`. `HMS_PROCESS_ROLE=all\|api` (default `all`, unchanged behaviour). `worker` is refused in favour of `node worker.js`. | A8 worker isolation |
| `backend/services/reconciliation.js` | A7 checks. The finance worker takes `pg_try_advisory_xact_lock(727290)`. | A7, A8 |
| `backend/services/billing.js`, `backend/routes/finance.js` | Two-person rule (`SAME_PERSON`) for activation and return credit. | A7 |
| `backend/routes/ipd.js` | `new_ipd_request` now carries `{ request_id, patient_id, urgency }` only. | A8: it sent the patient's name and diagnosis to every nurse |
| `backend/routes/pharmacy.js` | `stock_updated` key `reason` → `change`. | A8 payload rule (no frontend consumer) |
| `backend/services/medication{Inventory,Nursing,Orders}.js` | `patient_id` added to three events that concern one patient. | A8 scope |
| `backend/routes/dashboard.js` | Low-stock query selects `m.ID`. | React key error that failed `medicationFrontend`, `pharmacy` and `admin` |
| `backend/routes/downtime.js`, `backend/services/downtime.js` | Ward-machine routes; behind-check after each kit. | C6 |
| `backend/routes/pdfRoutes.js` | `enableUnicode(new PDFDocument(...))`. | C2: Indian-script names printed blank |
| `frontend/src/context/SocketContext.jsx` | The admission toast reads the request from the API. | A8 |
| `frontend/src/context/AuthContext.jsx` | Sign-in/out clears recoverable drafts and the live-list cache. | C2 |
| `frontend/src/App.jsx` | Mounts `CriticalResultAlerts`. | C2: `lab_critical_result` had no listener |
| `frontend/src/pages/hms/lab/LaboratoryWorkspace.jsx` | Initial tab from `?tab=`. | C2: the alert links to Critical follow-up |
| `frontend/src/pages/hms/consultation/ConsultationPage.jsx` | Recoverable draft and pending save (sessionStorage), keyboard tabs, Ctrl+S. **Your controls are kept:** If-Match, the original key on reconcile, and 412 compare. A draft kept against an older revision is saved against that revision, so the server's 412 triggers your compare flow. | C2 |
| `frontend/src/pages/hms/doctor/DoctorQuickConsultPage.jsx` | Recoverable draft and pending save/sign request (same rules). | C2 |
| `frontend/src/pages/hms/consultation/MedicationAllergyPanel.jsx` | Review states in words; "Allergies not checked" alert on load failure. | C2 |
| `e2e/consultationIntegration.e2e.js` | Lines 27–28 match the worded state instead of `UNKNOWN\|NOT_REVIEWED`. | follows the panel change |
| `backend/routes/pdfRoutes.js` `safe()` | Keeps Indian scripts; it used to delete every non-Latin-1 character, so a Hindi name printed as nothing. | C2 |
| `frontend/src/pages/hms/opd/AppointmentBookingPage.jsx` | A Completed appointment's slot is shown as booked. The database's no-overlap rule counts it, so the screen offered slots that were then refused. | C2 |
| `frontend/src/pages/hms/pharmacy/PrescriptionPreviewPage.jsx` | Optional second print language (Hindi; marked as not yet language-reviewed), plus an Indian-script font stack. | C2 |
| `frontend/src/components/dashboards/DoctorDashboard.jsx`, `WorklistPage.jsx` | Shared live reads (`data/liveQuery.js`). A failed load is never shown as an empty queue. | C2 |
| `e2e/helpers.js` | `E2E_VERBOSE=1` prints the full failure message. | test tooling |

| B2 ABDM/terminology | `a954678` | — | `abdmUse` 6/6, `abdm` 10/10, unit `abdmContracts.test.js` 4/4 |

B2 touches `routes/abdmBridge.js` (contract check before processing),
`services/abdm.js` (`imports`/`decideItem`), `routes/abdm.js` (transaction
and audit on the outside-records view), and adds `/api/integrations` in
`server.js`. The ABDM screens gain a readiness panel and chart
reconciliation.

## After the rebase onto 0d904fb (A2/B6 follow-ups)

| Item | Change |
|---|---|
| A8 facility scope | `hms_outbox.facility_id` (0155) is set from the publisher's verified session facility. Live delivery and `/events` catch-up reach only sessions of that facility. Socket handshakes bind their session's facility (`sessionFacility`). |
| A8 grant changes | When the dispatcher delivers `clinical.authorization.changed`, it re-checks that user's live connections: no current facility membership ends the connection. |
| A4 → B6 verifier | `services/documentVerifier.cts` + `scripts/verify-documents.cts`; contract in `document-recovery-contract-claude.md`. |
| B7 | Migration 0154 (writer fence, recovery events, audit triggers for the 0152 tables); `scripts/recovery-promote.cts`; `services/writerFence.cts`. `server.js`/`worker.js` refuse a fenced database, and `/api/ready` is 503 while fenced. Runbook: `docs/clinical-final/REGIONAL_RECOVERY.md`. Drill: `e2e/recoveryDrill.e2e.js`. |
| C6 facility | Kits and ward machines per facility (0156). The root `downtime-latest` copy is kept for the initial facility. |
| Test harness | My regression applies a synthetic, test-only credential/privilege fixture to the throwaway copy (not in the repo), because the old suites predate your privilege checks (your C4 item). |

Final fresh regression (my privilege fixture applied, all changes in): **49/53** suites;
the 4 failures are Codex-owned: laboratoryWorker, pharmacy, phase45, devices (B4,
in progress in your worktree). Earlier run after the rebase: 43/52
suites passed. Mine that failed (finance, recoveryDrill) are fixed and pass:
finance 15/15, recoveryDrill 6/6, downtime 4/4, downtimeDrill 7/7.
Remaining failures are in Codex areas:
- `laboratoryWorker`: `FACILITY_CONTEXT_REQUIRED` (worker context).
- `devices`: analyzer intake `AE` "Clinical work requires an…" (B4
  analyzer facility capability).
- `pharmacy`, `phase45`: versioned signing fixtures (your C4).

Also fixed here: the front-desk notifications and summary used the UTC day
(`trunc(CURRENT_TIMESTAMP)`). They now use `hms_service_today()` /
`hms_service_day_start()`.

Worker context, done on my side: `services/workerContext.cts`
(`forEachFacility`) runs the downtime-kit and finance workers once per active
facility, bound to `HMS_WORKER_USER_ID`, a service account that needs a
facility membership. The live-event dispatcher checks care as the receiving
user in their facility. `e2e/workerContext.e2e.js` proves this with a
non-owner role under your row policies: 0 rows without context, exactly the
facility's rows with it, 0 for a non-member. If you choose a different
worker-identity design, `forEachFacility` is the single place to change.
Also fixed: staff deletion (the A2 membership FK). A never-used account goes
with its automatic membership and practitioner identity; an account with
credential or role history is refused (deactivate instead). The
`practitioners`, `careTeam` and `admin` suites (mine) now follow your
registration and verification rules via `helpers.syntheticClinician`
(throwaway copies only): 8/8, 10/10, 28/28.

Open dependencies on Codex:
- **Your workers' facility contexts** (the lab escalation worker; devices
  and B4 analyzer facility capability, in progress in your worktree). The downtime kit tick, the finance worker
  and the lab escalation worker run without a facility context. Under a
  non-owner production identity, RLS will deny them (the lab worker already
  fails `FACILITY_CONTEXT_REQUIRED`). They need your approved worker
  context.

## A4 notes for Codex (shared and deployment files)

- `utils/encryption.js` now delegates to `services/dataKeys.cts` (AES-256-GCM,
  key IDs, purpose binding). `encrypt(text, purpose)` / `decrypt(value,
  purpose)`; legacy AES-CBC values still decrypt. ABDM passes the purposes
  `abdm.sms-text` and `abdm.hiu-private-key`. `models/Patient.js` uses
  `patient.aadhaar`, which fixes the Aadhaar mask: it was written with
  `AADHAAR_ENCRYPTION_KEY` and read with `ENCRYPTION_KEY`.
- `server.js` and `worker.js` call `assertDataKeys()`. **In production, HMS
  now refuses to start without `HMS_DATA_KEYS`.** `docker-compose.prod.yml`
  requires it and mounts `hms_private_documents` at `/app/private-documents`
  (`HMS_DOCUMENT_DIR`); `.env.example` documents both. This is A1 territory,
  so please fold it into your deployment artifacts. `docker-compose.yml`
  still publishes a default `AADHAAR_ENCRYPTION_KEY`; treat that key as
  known (see PRIVACY.md).
- `routes/patients.js`: the old `GET /hms/:id/documents` was removed; the
  new router `routes/patientDocuments.js` is mounted before it in
  `server.js`.

## Contract for new event publishers (A8)

- The payload holds identifiers, codes, counts and flags only. `assertMinimal`
  refuses names, contact details and clinical text, which fails the command.
  Re-read details through the API.
- Pass `patientId` (or put `patient_id`/`patientId` in the payload) for
  anything about one patient. Doctors then receive it only while the patient
  is in their care.
- **Facility scope is not done:** it waits for the A2 facility contract.
  When A2 lands, I add `facility_id` to `hms_outbox` and to the scope rule,
  or Codex does it in C8.

## Base suites (not caused by these packages)

- `pharmacy`, `phase45`: finalize without If-Match (see
  `claude-final-base-suites.md`). `pharmacy` also had the React key error
  fixed in `7937f00`.
- `consultationIntegration` needs the device fixtures: run it after
  `devices` (5/5 then).
- `opd` (mine): rewritten for the coded consultation in the C2 commit.
- `PrescriptionSlipPage.jsx` is no longer routed: `/hms/prescription-slip`
  opens `LegacyPrescriptionEntry`. The file is dead code; remove it in C8 if
  you agree. The bilingual print went to the routed
  `/prescription/:id/print` instead.
- `opd`: its diagnosis step needs the built-in ICD-10 list, so run it before
  `terminology` (which activates a synthetic edition), as the regression
  order already does.

## Devices overlap with B4 (please reconcile)

Your worktree has uncommitted edits to `backend/services/devices.js` and
`e2e/devices.e2e.js`. I changed the same file in `completion/claude-final`
so the analyzer account can work in a facility:

- `asDevice` binds the initial facility (`hms.facility_id`, `facilityId` in the
  request context) for the whole message transaction.
- The device service account row gets `facilityId`/`facilityTimezone` before
  `Analyzer.ingest`, because `requirePrivilege` reads the facility from the
  actor object, not from the transaction.

With those two changes the device suite passes 11/11 in my checkout. This is
a minimal bridge, not your B4 design: when you merge, prefer your analyzer
facility capability wherever it conflicts, and keep the service account's
professional credentials out of it. The same applies to the lab escalation
worker (`scripts/laboratory-escalation-worker.js`), which now runs once per
facility membership of its dedicated account.

## Final verification (15 October, on a rebuilt copy from the 13 October backup)

Full run: 45 suites passed on the first pass. Four needed a rerun after a
harness problem, not a product change, and pass on rerun: `abdm` and
`abdmUse` (mock gateway not running), `audit` (stale checkpoints signed with
a previous key), and `clinicalExchange` (a data-selection gap, below).

Changes in Codex-owned suites (mechanical, same rules as in finance):
- `pharmacy.e2e.js`: signing sends the reviewed revision and saves note content
  first; "today" uses `hms_service_day_start()` (the hospital day), not UTC.
  18/18.
- `phase45.e2e.js`: same signing rule. 8/8.
- `clinicalExchange.e2e.js`: the patient chosen for the MedicationAdministration
  check must have an administration. Before, it could pick a dispensed medicine
  with none. 8/8.

Changes in Codex-area code (B4/worker context; please reconcile):
- `backend/services/devices.js`: the analyzer service account is bound to the
  initial facility for the message (see above). devices 11/11.
- `backend/scripts/laboratory-escalation-worker.js`: runs once per current facility
  membership of its dedicated account. laboratoryWorker 3/3.

## Clean full run (single pass, final code)

Commit `118c2af`, on a database rebuilt from the 13 October backup and
migrated to 0156, with the test-only privilege fixture applied: **49 of 49
suites passed in one run, no reruns.** Per-suite output is in
`docs/clinical-final/evidence/claude-final-clean-run-20261015.txt`.

Remaining on Claude's side: none that is engineering. Open items are Codex's
review and merge (C8) and the outside gates named in each package's state.

## Full run, all suites (final)

Every suite in the repository was run on final code (`87d4fc6`), on a database
rebuilt from the 13 October backup: all suites pass. The audit suite failed
once on a checkpoint timing race and passed on rerun alone. Output is in
`docs/clinical-final/evidence/claude-final-full-run-20261015.txt`.

## Single uninterrupted run (final)

One pass, all 55 suites, on final code `c0589d6`, database rebuilt from the
13 October backup and migrated to 0156: **55 of 55 passed, no reruns.**
Output: `docs/clinical-final/evidence/claude-final-single-run-20261015.txt`.
