# Sprint 3 — Patient Service

Date: 2026-08-13

## Verdict

PASS for the Patient bounded context and its currently owned compatibility surface. Clinical/Lab/IPD visit enrichment remains an explicit downstream dependency and is not falsely claimed as extracted.

## Changes made

- Added independent `services/patient-service` with its own manifest/lockfile, configuration, PostgreSQL connection, service-scoped models, routes, validation, logging, health/readiness, tests, and graceful shutdown.
- Extracted patient profile/list/search/registration/update/delete and patient-owned allergies/chronic-condition/document metadata APIs.
- Added signed gateway context verification and public-path routing through the gateway; direct unauthenticated service API access is rejected.
- Preserved UHID generation, existing columns, existing sequences, Aadhaar encryption/masking, response compatibility, and the frontend’s report-registration workflow.
- Added explicit protected compatibility calls for initializing and cleaning legacy Lab report rows while Lab remains monolith-owned.
- Added transactional deletion of all Patient-owned child records and fixed sequence-backed metadata inserts.
- Added Patient Service to the one-command launcher, readiness checks, root test command, and environment documentation.

## Files changed

- `services/patient-service/**`
- `services/api-gateway/src/{app,config,server}.js`
- `services/api-gateway/test/gateway.test.js`
- `scripts/start-services.js`
- `package.json`
- `backend/routes/internalCompat.js`
- `backend/.env.template`
- this report and Patient Service README

## Service extracted

Patient Service on port `5102`. It starts without executing monolith application code and has no imports from legacy routes/models/middleware/server.

## Tables owned

| Service | Tables |
|---|---|
| Patient | `HMS_PATIENTS`, `HMS_ALLERGIES`, `HMS_CHRONIC_CONDITIONS`, `HMS_PATIENT_DOCUMENTS` |

Patient Service is the only extracted runtime writer for these tables on gateway-owned routes. `HMS_TEST_REPORTS` remains temporarily monolith/Lab-owned and is accessed only through an authenticated compatibility HTTP contract.

## Old monolith dependencies removed

Gateway-owned patient registration/list/search/profile/update/delete and patient metadata paths no longer execute `backend/routes/patients.js`. The legacy route remains mounted only as an internal fallback for non-owned/transition paths and is not used by the gateway for the extracted surface.

## Inter-service dependencies

```text
Frontend :4999 -> Gateway :5001
Gateway :5001 -> Identity :5101 (JWT/current RBAC validation)
Gateway :5001 -> Patient :5102 (patient-owned paths)
Patient :5102 -> PostgreSQL (four owned tables)
Patient :5102 -> Monolith compatibility endpoint (temporary Lab report initialization/deletion)
Gateway :5001 -> Monolith :5002 (visits and other unmigrated domain paths)
```

The compatibility dependency has timeout, service-token authentication, explicit failure, and compensating patient deletion on registration failure. It will be removed when Lab Service owns `HMS_TEST_REPORTS`.

## Tests run

- Patient unit/contract tests: 4 passed.
- Gateway contracts after Patient routing/readiness: 6 passed.
- Identity suite: 6 passed, integration skip by default.
- Patient syntax and production dependency audit: PASS, 0 vulnerabilities.
- Isolated PostgreSQL workflow: create, profile, allergy, chronic condition, update, delete all passed; sequence-backed IDs verified.

## Runtime checks

- `npm run services:start`: PASS; Identity migration runs first, then Identity 5101, Patient 5102, monolith 5002, gateway 5001.
- Gateway `/ready`: 200 with monolith, Identity, and Patient dependencies ready.
- Patient `/health` and `/ready`: 200.
- Graceful shutdown: PASS.
- Logs redact auth/context/service secrets.

## HTTP checks

- Live receptionist login through gateway: 200.
- Live patient list/search/today endpoints through gateway: 200.
- Live authenticated registration: 201 with patient ID and `reportId`.
- Live super-admin deletion: 200; receptionist deletion is rejected by Patient Service RBAC.
- Direct Patient API without signed context: 401.
- Gateway routes `/api/patients` to Patient and `/api/patients/.../visits` to the monolith transition path.

## Database checks

- Existing live patient rows remained available after routing switch.
- Isolated disposable PostgreSQL run created patient ID 5, allergy ID 2, chronic-condition ID 2, updated the profile, and deleted it.
- Final isolated counts for patient/owned children were all zero after deletion.
- Live cleanup verified patient row removal; the temporary Lab report cleanup contract was added to prevent report orphans.
- Existing PostgreSQL schema and data were not recreated.

## Frontend checks

- Existing frontend paths remain unchanged.
- `RegisterPatientPage` receives the existing `patient` and `reportId` response shape.
- Patient search/profile, Corporate lookup, allergy/condition panels, and report navigation paths remain compatible.
- Visit aggregation deliberately remains on monolith until Clinical/Lab extraction.

## Failures and fixes

1. Sequelize identifiers were quoted as uppercase and failed against PostgreSQL’s lowercase physical relation names; moved `quoteIdentifiers: false` to the correct Sequelize option level.
2. Express rate limiting rejected gateway-forwarded addresses; Patient Service now trusts the local gateway proxy explicitly.
3. Existing metadata tables use explicit sequences rather than identity defaults; inserts now allocate `hms_allergy_seq` and `hms_chronic_seq`.
4. Initial deletion left owned child orphans; deletion is now transactional across all Patient-owned child tables.
5. Registration initially omitted the frontend-required `reportId`; a protected temporary Lab compatibility contract now preserves it with timeout and compensation.

## Remaining blockers

- Patient visits still aggregate Clinical/Lab/User tables through the monolith; Clinical and Lab extraction must provide explicit read contracts.
- Patient documents have read compatibility but no upload route in the old mounted surface; document upload ownership remains follow-up work.
- Full browser automation and complete cross-service E2E coverage remain future evidence work.

## Evidence record

Sprint: 3 — Patient Service

Changes made: independent Patient service, gateway route ownership, signed context, sequence-safe data access, patient-owned metadata transactions, lab compatibility contract, launcher/tests/docs.

Files changed: listed above.

Service extracted: Patient.

Tables owned: `HMS_PATIENTS`, `HMS_ALLERGIES`, `HMS_CHRONIC_CONDITIONS`, `HMS_PATIENT_DOCUMENTS`.

Old monolith dependencies removed: gateway-owned patient CRUD/search/profile/metadata execution.

Inter-service dependencies: Identity, PostgreSQL owned tables, temporary explicit Lab compatibility, monolith visits transition.

Tests run: unit, service contract, gateway contract, isolated PostgreSQL workflow, live gateway workflow, syntax/audit.

Runtime checks: PASS.

HTTP checks: PASS.

DB checks: PASS.

Frontend checks: PASS for current patient registration/search/profile/report response compatibility.

Failures: all listed defects fixed and rerun.

Remaining blockers: Clinical/Lab/IPD aggregation extraction and browser/E2E coverage.

Verdict: PASS.
