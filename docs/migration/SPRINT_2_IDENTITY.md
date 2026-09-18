# Sprint 2 — Auth / Identity

Date: 2026-08-13

## Verdict

PASS for the extracted authentication, authorization, account-state, staff-session, and audit boundary. Patient and domain read/report aggregation remains intentionally transitional and is assigned to later bounded-context sprints.

## Changes made

- Added independently executable `services/identity-service` with its own manifest, configuration, database access, routes, validation, logging, health/readiness, migration, tests, and graceful shutdown.
- Moved public login, session validation, password flows, user/permission reads, staff provisioning/update, force logout, and account unlock behind Identity-owned HTTP routes.
- Added gateway-to-Identity validation on every authenticated request, including current active/locked status and permissions.
- Added signed gateway context verification in the monolith and stripped forgeable external identity/internal headers.
- Replaced monolith authentication and audit writes with explicit Identity HTTP contracts.
- Added safe audit idempotency migration and redacted structured logging.
- Secured Socket.IO authentication through Identity; client role joins are derived from the validated account.
- Removed query-string JWT use from frontend clients; compatibility is disabled by default.
- Added compensating Identity cleanup when doctor-profile provisioning fails downstream.

## Files changed

Sprint-owned additions include `services/identity-service/**`, `backend/utils/identityClient.js`, `backend/middleware/trustedContext.js`, `backend/routes/internalCompat.js`, and the gateway/launcher/auth/audit/socket/configuration changes documented in the repository diff. Existing unrelated user changes were preserved.

## Service extracted

Identity / Auth / RBAC / Audit Service on port `5101`. It starts without executing monolith application code and has no imports from `backend/routes`, `backend/models`, `backend/middleware`, or `backend/server`.

## Tables owned

| Service | Tables |
|---|---|
| Identity | `HMS_USERS`, `HMS_PERMISSIONS`, `HMS_AUDIT_LOGS` |

The monolith no longer performs runtime writes to these tables for mounted authentication/staff/session/audit flows. Transitional domain reporting may still read identity columns through legacy joins; those reads are explicit migration debt, not ownership transfers.

## Inter-service dependencies

```text
Frontend :4999 -> Gateway :5001
Gateway :5001 -> Identity :5101 (JWT/state/RBAC validation)
Gateway :5001 -> Monolith :5002 (unmigrated domain routes)
Monolith :5002 -> Identity :5101 (audit and compatibility contracts)
Identity :5101 -> PostgreSQL (owned tables only)
```

## Tests run

- Identity unit/config suite: 6 passed, integration skipped by default.
- Disposable PostgreSQL Identity integration suite: 1 passed.
- Gateway contract suite: 6 passed (including Identity-unavailable 503 handling).
- npm production dependency audits: 0 vulnerabilities for gateway and Identity.
- Changed-service syntax checks: PASS.

## Runtime checks

- `npm run services:start`: PASS; migration runs before services.
- Gateway `/health` and `/ready`: 200.
- Identity `/health` and `/ready`: 200.
- Graceful SIGINT shutdown: PASS.
- Logs show Authorization, internal secret, signed context, password, and OTP redaction.

## HTTP / security checks

- Login and `/me`: 200.
- User and permission reads: 200.
- Receptionist access to admin-only endpoint: 403.
- Five failed logins: four 401 responses followed by 423 lock; correct password while locked: 423.
- Inactive account and forged context: 401.
- Missing internal secret: 401.
- Force logout invalidates the token; unlock restores access.
- Query-string token and direct monolith auth/user routes: 401/404.
- Authenticated PDF and Socket.IO connection: PASS; unauthenticated socket: rejected.

## Database checks

Against disposable database `hms_sprint2_test_20260813`, the isolated gateway/monolith/Identity flow created and verified patient, appointment, encounter, prescription, lab order, dispensing, stock, bill, and audit effects. Audit rows carried non-null actor IDs. Identity migration added the audit idempotency column/index while preserving existing live rows. Doctor provisioning was verified in `HMS_USERS` and the doctor compatibility record.

The disposable database contained only test data and is removed after the evidence run.

## Frontend checks

- Vite proxy continues to target gateway `5001`.
- Frontend production build passed previously after converting direct backend URLs and protected downloads to gateway-relative authenticated requests.
- Existing login, patient search, PDF download/preview, and Socket.IO behavior remain compatible.

## Failures and fixes

- Account lock comparison initially used mixed timezone semantics; it was corrected to database UTC time with row locking.
- Doctor provisioning exposed a missing auto-increment model definition; the sequence behavior was corrected and retested.
- Gateway originally returned generic proxy failures when Identity was unavailable; it now returns structured 503 `IDENTITY_UNAVAILABLE`.
- Identity dependency audit exposed a transitive `uuid` advisory; a scoped `uuid` override removed the production audit finding.

## Remaining blockers

- Security-center/reporting read aggregations remain in the monolith until Admin/Reporting extraction.
- Patient and clinical tables remain monolith-owned until their respective sprints.
- Browser automation and the complete cross-service E2E suite remain future evidence work.

## Evidence record

Sprint: 2 — Auth / Identity

Changes made: independent Identity service, gateway validation, trusted context, explicit audit/provisioning contracts, secure socket authentication, frontend token/download cleanup.

Files changed: see repository diff and service README.

Service extracted: Identity / Auth / RBAC / Audit.

Tables owned: `HMS_USERS`, `HMS_PERMISSIONS`, `HMS_AUDIT_LOGS`.

Old monolith dependencies removed: mounted auth/users/staff/session/audit writes and direct runtime authentication model imports.

Inter-service dependencies: gateway and monolith call Identity over authenticated HTTP.

Tests run: unit, integration, gateway contract, isolated workflow, dependency audit, syntax checks.

Runtime checks: PASS.

HTTP checks: PASS.

DB checks: PASS.

Frontend checks: PASS for build/proxy/workflow compatibility.

Failures: fixed and rerun as listed above.

Remaining blockers: later domain extraction and broader E2E/browser coverage.

Verdict: PASS.
