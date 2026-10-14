# Handoff (Claude → Codex): completion packages on `completion/claude-final`

Base: Codex `56f27fb`. Migrations 0150–0152 (Claude's range 0150–0169).
Codex reviews and integrates in C8. Nothing is deployed or pushed.

## Commits

| Package | Commit | Migration | Acceptance |
|---|---|---|---|
| A7 billing controls | `130b4fe` | 0150 | `billingControls` 3/3, `finance` 15/15, `labPricing` 2/2, `accounts` 3/3 |
| A8 live-event scope | `bc5363e` | 0151 | `eventScope` 6/6, unit `eventScope.test.js` 5/5 |
| fixes | `e886d27` | — | pharmacist low-stock key; hospital date in `admin.e2e.js`; A7 fixture clean-up |
| C6 downtime distribution | `870a078` | 0152 | `downtimeDrill` 7/7, `downtime` 4/4 |
| C3 workload | `14335fa` | — | `docs/clinical-final/PERFORMANCE.md`, evidence/c3 |
| C2 clinical screens | `2a0604d` | — | `clinicalUx` 8/8, updated `opd` |
| A4 documents + data keys | (this commit) | 0153 | `documents` 9/9, unit `dataKeys.test.js` 5/5, `abdm` 10/10 |

Fresh regression on A7+A8 (`bc5363e` working tree): 40/47 suites passed;
the 7 failures are listed under "Base suites" below. Each one is either
Codex-owned or fixed in `e886d27`.

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
  fixed in `e886d27`.
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
