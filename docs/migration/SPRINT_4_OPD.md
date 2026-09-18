# Sprint 4 — OPD / Appointment Service

Date: 2026-08-13

## Verdict

PASS for OPD directories, appointment scheduling, and token queue ownership. Clinical encounter paths remain monolith-owned by design and are not claimed as migrated.

## Changes made

- Added independent `services/opd-service` with its own manifest/lockfile, configuration, PostgreSQL access, scoped models, routes, signed-context authentication, health/readiness, tests, logging, and graceful shutdown.
- Extracted department and doctor directory endpoints, appointment booking/list/reschedule/status, and token creation/queue/status endpoints.
- Added Identity internal user-directory contracts and Patient internal lookup contract; OPD never imports those services’ models.
- Added gateway route ownership and OPD readiness dependency, plus one-command launcher startup on port `5103`.
- Preserved existing response paths and normalized legacy doctor references supplied as either Identity user IDs or HMS doctor IDs.
- Added PostgreSQL advisory locks for appointment slot conflict and token-number allocation.
- Preserved legacy orphan appointment/token visibility by returning null patient enrichment instead of failing the whole queue.
- Added explicit Identity audit contract calls for appointment and token mutations; audit rows are written without cross-domain ORM access.

## Tables owned

| Service | Tables |
|---|---|
| OPD / Appointment | `HMS_APPOINTMENTS`, `HMS_TOKENS`, `HMS_DOCTORS`, `HMS_DEPARTMENTS` |

Patient rows are accessed through Patient Service; users through Identity Service. No OPD route writes those domains directly.

## Inter-service dependencies

```text
Frontend -> Gateway :5001
Gateway -> Identity :5101 (JWT and current context)
Gateway -> Patient :5102 (patient-owned paths)
Gateway -> OPD :5103 (appointments/tokens/directories)
OPD -> Patient :5102 (internal patient lookup)
OPD -> Identity :5101 (internal doctor/user lookup)
OPD -> PostgreSQL (four owned tables)
Gateway -> Monolith :5002 (Clinical and remaining routes)
```

## Tests run

- OPD unit/contract tests: 4 passed.
- Gateway, Identity, and Patient suites after OPD wiring: gateway 6 passed; Identity 6 passed with one opt-in integration skip; Patient 4 passed.
- OPD syntax and production dependency audit: PASS, 0 vulnerabilities.
- Existing gateway readiness tests updated for the OPD dependency and passed.

## Runtime / HTTP checks

- `npm run services:start`: PASS; OPD listens on `127.0.0.1:5103`.
- Gateway `/ready`: 200 with monolith, Identity, Patient, and OPD ready.
- Department and doctor directory through gateway: 200.
- Existing appointment list with stale legacy patient IDs: 200, preserving rows with `patient: null`.
- New appointment: 201.
- Duplicate appointment slot: 400.
- Reschedule/status update: 200.
- New token: 201.
- Token queue: 200.
- Token status update: 200.
- Legacy user-ID doctor input accepted for both appointment and token creation.
- Direct OPD API without signed gateway context: 401.
- Appointment and token mutations produced Identity audit rows (`CREATE|appointment|13` and `CREATE|token|13`); verification rows were then removed while audit evidence was retained.

## Database checks

Live PostgreSQL verification created appointment/token rows using existing sequences and then removed only the explicitly identified verification rows. Advisory-lock paths executed successfully. Existing appointments were not rewritten. No patient/user table writes were performed by OPD.

## Frontend checks

The existing `/api/hms/*` paths remain unchanged. Doctor and department directory response shapes, appointment response fields, token queue fields, and status endpoints remain compatible. Frontend production build remains green from the previous gate; no frontend route rewrite was needed.

## Failures and fixes

1. Existing appointment rows referenced absent patient records; list enrichment now tolerates missing cross-service records while creation remains strict.
2. Frontend/legacy data uses both Identity user IDs and HMS doctor IDs; OPD now resolves either form to the owned doctor row.
3. Gateway readiness initially omitted OPD; it now treats OPD as an essential dependency.
4. Department creation lacked a guaranteed sequence in the legacy schema; OPD falls back to a safe max-ID allocation when that sequence is absent.

## Remaining blockers

- Encounter/diagnosis/prescription flows still use monolith Clinical routes.
- Queue realtime events still originate in the monolith Socket.IO path and must be moved or explicitly published during Clinical/Realtime work.
- Queue realtime events still originate in the monolith Socket.IO path and must be moved or explicitly published during Clinical/Realtime work.

## Evidence record

Sprint: 4 — OPD / Appointment

Changes made: independent OPD service, four-table ownership, gateway route/readiness integration, Identity/Patient contracts, lock-protected scheduling/queues, compatibility normalization.

Service extracted: OPD / Appointment.

Tables owned: `HMS_APPOINTMENTS`, `HMS_TOKENS`, `HMS_DOCTORS`, `HMS_DEPARTMENTS`.

Old monolith dependencies removed: gateway-owned OPD directory, appointment, and token execution.

Inter-service dependencies: Identity and Patient HTTP contracts; PostgreSQL owned tables.

Tests run: service tests, gateway tests, live HTTP workflow, PostgreSQL effects, dependency audits.

Runtime checks: PASS.

HTTP checks: PASS.

DB checks: PASS.

Frontend checks: PASS for path/response compatibility.

Failures: fixed and retested as listed above.

Remaining blockers: Clinical extraction and realtime migration.

Verdict: PASS.
