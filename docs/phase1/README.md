# Phase 1: integrity and security foundation

Branch `phase1/integrity-foundation`, started from `phase0/safety-fixes`.

| Part | Status |
|---|---|
| 1. Versioned migrations and honest startup | **Done** (see below) |
| 2. Find and repair broken links in existing data; enforce relationships in the database | **Done** (see below) |
| 3. Revocable sessions (logout, deactivation and password change end a session at once) | **Done** (see below) |
| 4. Action and patient-scope authorization | **Done for roles**; patient scope needs Phase 2 care teams (see below) |
| 5. Transactional, tamper-evident audit trail | **Done** (see below) |
| 6. Idempotency for retried clinical and financial commands | **Implemented and failure-tested**; claims, changes and responses commit atomically |
| 7. Durable state: settings and IPD draft charges out of process memory; outbox for events | **Implemented and failure-tested**; versioned settings and paginated delivery sequences |
| 8. Readiness checks | **Done** with part 1 |

## Part 1: versioned migrations

- **`backend/migrations/`** is now the only definition of the schema. Each numbered SQL file runs once, in order, in its own transaction, and is recorded in `schema_migrations` with a checksum.
  - `0001_baseline.sql` is the schema that `init_database.js` and the startup ALTERs used to create, written idempotently. On an existing database it adds only what is missing.
  - `0002_default_permissions.sql` holds the role permission matrix that every install needs. It is inserted only into an empty table.
- **`backend/migrate.js`** has three commands. `up` applies pending files, guarded by a PostgreSQL advisory lock so two runners cannot collide. `status` lists applied and pending files. `check` fails if any file is pending, missing or has been edited after it was applied.
- **Docker Compose** runs a one-shot `migrate` service before the backend. In development it then loads demo data (`SEED_DEMO_DATA`, default `true`). Production applies migrations only and never loads demo accounts.
- **The server no longer changes the schema.** It refuses to start if the database is unreachable (there is no more "mock mode") or if a migration is pending.
- **Readiness:** `/api/health` reports that the process is alive. `/api/ready` returns 503 when the database does not answer within 2 s. Container health checks and the Jenkins smoke test use `/api/ready`.
- **Demo data** lives in `seed_demo_data.js`. `init_database.js` is removed.
- **Docker image:** `backend/.dockerignore` now excludes `.env`, which was being copied into the image along with the local secrets in it.

### Verification

- `backend/scripts/verify-migrations.sh` (also in CI, on PostgreSQL 16 and 18):
  - On an empty database the migrations apply, a second run is a no-op, and `check` passes.
  - A database built by the old `init_database.js` (commit `1639d15`) upgrades to the identical schema: 743 columns, constraints, indexes, sequences, functions and triggers.
- Copies of both existing databases (Docker PostgreSQL 16 and local PostgreSQL 18) upgrade to that same schema with every row kept. The local copy gained the missing discharge-summaries table and supplier-number column, and its temperature column became decimal.
- Two runners started at once: one applies, the other waits and finds nothing to do.
- Editing an applied file makes `check` fail.
- The server refuses to start against a database with a pending migration and against an unreachable one.
- With the server running, cutting the database off turns `/api/ready` to 503 while `/api/health` stays 200; restoring it returns `/api/ready` to 200.
- The live Docker database was backed up (`~/hms-backups/20261012-143017`) and migrated. The backend reported "schema is current", and login works.

## Part 2: relationships and integrity rules

- **One meaning for "doctor" (F16).** Every `*DOCTOR_ID` column holds the doctor's user ID, except `HMS_REFERRALS.FROM_DOCTOR_ID` and `HMS_DEPARTMENTS.HEAD_DOCTOR_ID`, which hold the profile ID as their code always has. Older appointments and tokens stored the profile ID; migration 0003 converts them, and stops for a manual review if a value could mean two different doctors. `utils/doctorIdentity.js` resolves a doctor sent as either ID to the user ID before tokens and appointments are saved. Seven routes that searched by both IDs now use the one ID.
  - This fixed an existing bug: the doctor's schedule queried appointments by profile ID and so missed every booking made through the current booking screen.
- **Foreign keys (F03).** `0003_relationships.sql` adds 97 foreign keys, each with an index on the referencing column. Rows whose references are already broken move to the `quarantine` schema with a reason (`quarantine.log` summarises), rather than being deleted or guessed.
  - The Docker database had none.
  - A copy of the local database moved 128 rows: appointments, tokens, visits, prescriptions, lab orders, bills and dispensing records of about 20 patients deleted by the old patient-delete action, plus their line items.
- **Integrity rules (F03, F17).** `0004_integrity_rules.sql` enforces:
  - one active admission per patient and per bed;
  - the known bed and admission statuses;
  - unique bed numbers per ward, token numbers per doctor and day, permission rows, doctor profiles per user, and medicine lots per medicine (two concurrent first receipts of the same lot can no longer create two batches);
  - non-negative stock, prices, bill amounts and line quantities;
  - positive payments and advances.
- **Prescription deletes.** Deleting a prescription removed its lines and then the prescription outside a transaction, so a refused delete left the lines gone. Both steps now run in one transaction. A dispensed or administered prescription is refused with a clear 409 message, both on delete and when its lines are replaced.

### Verification (part 2)

- Both database copies end with all 97 foreign keys validated. On the Docker copy every table keeps its row count.
- The database refuses a prescription for a missing patient, negative stock, and a second active admission for a patient.
- A token or appointment sent with a profile ID is stored with the user ID, an unknown doctor gets 400, and the doctor's schedule shows the booking.
- Workflow suites on a migrated copy: OPD 20/20, pharmacy 18/18, laboratory 10/10, administration 28/28, inpatient 11/13 (the known IPD-billing defect, unchanged).
- `verify-migrations.sh` passes on PostgreSQL 16 and 18 (932 schema facts).
- Applied to the live Docker database after a backup (`~/hms-backups/20261012-154927`): 97 foreign keys validated, 0 rows quarantined.

## Part 3: revocable sessions

- **Server-side sessions** (`0005_sessions.sql`, `utils/sessions.js`). Each sign-in creates an `hms_sessions` row, and the token carries its ID. Every request and socket handshake checks that the session is live.
  - Signing out (`POST /api/auth/logout`) ends the session.
  - Ending a session elsewhere drops its socket.
- **Sessions end immediately when:**
  - the user signs out;
  - the user changes their password (other devices only);
  - the password is reset through the forgotten-password flow or by an administrator;
  - the role changes or the account is deactivated;
  - a super admin uses "End session". This used to lock the account for one minute, after which the old token worked again.
- **Idle timeout:** the per-role timeouts on the Security screen are now enforced. A session idle longer than its role's limit is ended.
- **Cookie, not browser storage:**
  - Browsers receive the session only as an `HttpOnly; SameSite=Strict` cookie, so page scripts cannot read it. It is `Secure` behind HTTPS, or with `COOKIE_SECURE=true`.
  - A state-changing request authenticated by the cookie must carry `X-Requested-With: XMLHttpRequest`, which the app's API client always sends and a cross-site form cannot.
  - Scripts and services request a bearer token with `X-Auth-Transport: bearer`.
- **Removed** `POST /api/auth/emergency-reset`, an unused endpoint that set accounts to known passwords.
- **Session list:** the Security screen's session list shows each user's live session count and last activity.

### Verification (part 3)

- `npm test` passes (8 token tests). Tokens without a session ID are rejected.
- `e2e/sessions.e2e.js` passes 7/7:
  - logout ends the token;
  - a password change keeps this device and signs out the other;
  - forced logout ends HTTP access and drops a connected socket, and the token cannot open a new one;
  - deactivation ends sessions, and reactivation does not revive them;
  - an idle session times out and stays dead;
  - a browser login gets an HttpOnly SameSite cookie and no token;
  - a cookie POST without the header is refused.
- Workflow suites: OPD 20/20, pharmacy 18/18, laboratory 10/10, administration 28/28 (the forced-logout step now expects the account to stay usable rather than locked), inpatient 11/13 (known billing defect).
- Live Docker app after a backup (`~/hms-backups/20261012-160641`), through the production nginx on port 4999: sign-in sets the cookie, the cookie works, logout ends it, the live socket connects with the cookie and is refused without it.

## Part 4: action authorization

- **Every endpoint now checks the caller's role.** 59 endpoints that accepted any signed-in account got an explicit role list. The only ones left open to any signed-in user are `GET /api/auth/me`, `POST /api/auth/logout` and `POST /api/auth/change-password`. `docs/phase0/API_ACCESS.md` is regenerated: 5 public, 3 signed-in, 244 role-checked, 3 internal.
- **How the roles were chosen.** Each endpoint is open to exactly the roles whose screens call it, traced through every import from the routes in `App.jsx`. Where that left a choice:
  - Chart contents (visits, documents, conditions, vitals history, lab reports): front desk, clinicians and admins. Lab technicians are included where their screens read them; pharmacists are not.
  - Allergies stay readable by every role, because pharmacists check them when dispensing. Adding allergies or chronic conditions is limited to doctors, nurses, front desk and admins, who are the roles whose screen offers it.
  - Bills: front desk, clinicians and admins. No longer lab technicians or pharmacists.
  - Doctor-only clinical actions (creating, editing or deleting a referral, deleting a prescription) are doctors only. Administrators can no longer do them, because administrative access is not clinical authority.
  - Endpoints no screen uses (for example creating a doctor profile) are admin-only.
- **Screens match the server.** The four original lab-module pages (`/register`, `/edit`, `/search`, `/report`), which every role could open, now allow the same roles as their endpoints.
- **Patient scope is not done.** Limiting a clinician to patients in their care needs the care-team and encounter-assignment model that Phase 2 builds. Until then, every chart read and every refusal is recorded (part 5), so access can be reviewed.

### Verification (part 4)

- `e2e/authorization.e2e.js` passes 5/5:
  - for 48 endpoints, every role outside the list gets 403 (writes included; the refusal happens before the handler);
  - every role inside the list gets past the check;
  - a lab technician cannot read a bill or add an allergy, and no row is written;
  - administrators cannot create referrals or delete prescriptions;
  - signed-out callers get 401.
- All 29 route files load.
- Workflow suites: OPD 20/20, pharmacy 18/18, laboratory 10/10, administration 28/28, sessions 7/7, inpatient 11/13 (known billing defect).

## Part 5: transactional, tamper-evident audit

- **Row changes are recorded by the database** (`0006_audit.sql`). A trigger on every application table writes `audit.row_changes` in the same transaction as the change: inserts keep the new row, deletes the old row, updates only the changed columns. Passwords and one-time codes are never copied. A committed change always has its entry, and a rolled-back one never does. No code path can skip it.
- **Attribution.** `utils/auditContext.js` gives every request an ID (returned as `X-Request-Id`). Before a pooled connection runs a query, it sets `hms.actor_user_id`, `hms.session_id` and `hms.request_id` on that connection, and the triggers record them. After a successful sign-in, the login's own updates are attributed to that user.
- **Reads and refusals.** `middleware/accessAudit.js` records every GET of patient data (with the patient ID where the route has one) and every 401 and 403 in `audit.access_events`.
- **Append-only.** `audit.row_changes`, `audit.access_events` and `hms_audit_logs` refuse UPDATE, DELETE and TRUNCATE. The only exception is the sealer filling the chain columns of an unsealed entry.
- **Hash chains.** Every 5 seconds the server's sealer (`utils/auditSealer.js`) links committed entries of each table into a SHA-256 chain, and `audit.verify()` recomputes it.
- **Signed checkpoints.** Once a minute the server writes the chain heads, signed with `AUDIT_CHECKPOINT_KEY`, to `AUDIT_CHECKPOINT_DIR`. `node scripts/audit-verify.js <dir>` checks the chains and every checkpoint.
  - **Operational requirement:** a checkpoint only protects against a database superuser when it is stored where that person cannot rewrite it, for example a bucket with S3 Object Lock in a separate account. In development it lands in `./audit-checkpoints`.
- **Activity log fixes.** The readable activity log no longer tries the external identity service unless one is configured. Values too large for its `RECORD_ID` column (which caused the "out of range for type integer" failures) are kept in the details instead of failing the write.
- **CI** fails if any application table lacks an audit trigger, apart from sessions, idempotency keys, the outbox and the inbox, which are not clinical events.

### Verification (part 5)

- `e2e/audit.e2e.js` passes 7/7:
  - an allergy added through the API appears in `audit.row_changes` with the nurse's user ID, session ID and the response's `X-Request-Id`;
  - a rolled-back insert leaves no entry, and no entry contains a password hash;
  - UPDATE, DELETE and TRUNCATE on audit tables are refused;
  - a chart read and a 403 appear in `audit.access_events`;
  - the sealer chains everything and verification passes;
  - a superuser who disables the guard and edits a sealed entry is caught by the chain;
  - a superuser who edits an entry and recomputes the entire chain afterwards passes the chain check but is caught by the signed checkpoint.
- Every suite passes with auditing active: OPD 20/20, pharmacy 18/18, laboratory 10/10, administration 28/28, authorization 5/5, sessions 7/7, audit 7/7, inpatient 11/13 (known billing defect).
- That run produced 269 row changes and 598 access events with no sealing errors. The only changes without a user are sign-in bookkeeping before authentication, and those are now attributed after a successful sign-in.
- `verify-migrations.sh` passes on PostgreSQL 16 and 18. It now compares the `audit` schema too and checks audit-trigger coverage, which was confirmed to catch a deliberately unaudited table.

## Completion work — 13 October 2026

### Atomic command receipts

Authenticated clinical mutations require an `Idempotency-Key`. Authorization precedes claiming the key. The request hash uses canonical JSON, query parameters and uploaded-file checksums, excluding query credentials.

A request holds its key inside the same PostgreSQL transaction as its clinical/financial changes, row-change audit and outbox events. The exact JSON response is stored before committing and before sending HTTP output. Existing Sequelize route transactions become savepoints of this transaction; ordinary queries inherit its client through the request context. Queries cannot escape into autocommit or continue after the command has finished.

There is no timeout-based takeover and no inference of complete success from an arbitrary audit row. Concurrent retries wait briefly and receive `IDEMPOTENCY_IN_PROGRESS`. A process/database-connection failure rolls back both claim and domain changes. A committed result is replayed exactly. Legacy incomplete receipts remain blocked with `IDEMPOTENCY_OUTCOME_UNKNOWN` until reviewed; they are never automatically deleted or executed again.

One-time API-key secrets are not retained in receipts. A repeated creation request returns `ONE_TIME_SECRET_ALREADY_ISSUED` with nonsecret metadata; an operator can revoke and replace a key whose original response was lost.

### Durable configuration and events

Migration `0009_phase1_completion.sql` adds setting revisions and stable event delivery sequences without editing prior applied migrations.

Settings transforms read the current database value under a lock. Cache updates occur only after a confirmed outer commit, and older refresh results cannot overwrite newer revisions. IP-rule pairs commit together; repeated list edits retain both changes. The frontend marks IP-rule saves as pending and prevents overlapping submissions.

Events are inserted with the domain transaction and assigned a monotonically ordered delivery sequence only after becoming visible. Dispatch uses bounded batches. `GET /api/events?after_sequence=<cursor>` returns `data`, `next_sequence`, `latest_sequence`, and `has_more`. Clients fetch every page; live events do not advance past missing ranges, repeated deliveries are suppressed, and logout cancels in-flight replay. Event IDs remain stable; sequence gaps from aborted allocators are allowed. The old `after=<event_id>` interface is retained for compatibility, but new clients use delivery sequences. Socket emission is not evidence that a human has acknowledged a clinical result.

Inbox deduplication requires the same transaction as message processing. An aborted consumer can receive the message again.

### Audit, sessions and frontend failure behavior

Access audit is persisted before the first HTTP response byte, including streamed PDFs. If it cannot be persisted, clinical content is withheld with a typed 503. Rejected client commands are audited. Server-generated request IDs prevent caller-provided correlation IDs from impersonating another operation. Readable action audit stays in the tenant database transaction rather than publishing a potentially rolled-back action to an external service.

Password updates and session revocation commit together. Reset credentials are consumed under a user-row lock, so simultaneous reset attempts cannot both succeed. Settings and socket-revocation callbacks run only after successful commits, including when Sequelize reports a commit failure.

Application replicas share their tenant's signing material and session database. Connected sockets are revalidated without renewing idle leases; outbound notifications are checked against current sessions, and logout on one replica disconnects sockets on another. Patient/facility/worklist scoping remains Phase 2 work.

The frontend preserves the active screen and draft on HTTP 503. Network retries and typed ambiguous-commit responses reuse the original request key. Cancellation and authentication calls are not automatically retried. A fresh user action has a new key; clients must reuse the original key when reconciling an uncertain previous action.

Signed checkpoint files are written atomically and fsynced. Checkpoint verification accepts only known chains and validates signatures. Production checkpoint storage and signing-key governance must remain outside the database administrator's write boundary; local checkpoint files demonstrate functionality, not that production isolation requirement.

### Reproducible checks

- `npm test` runs token and browser replay unit tests. With `HMS_TEST_DATABASE=true` and an isolated `DB_NAME` beginning `hms_phase1`, `hms_test`, `hms_ci`, or `hms_verify`, it also runs real database failure tests.
- The failure suite covers atomic response receipts, nested rollback, rejected commands, stalled originals, terminated connections, lost HTTP responses, streaming audit failure, stale refreshes, failed commits, concurrent resets, revocation rollback, late event commits, paginated backlogs, and inbox rollback.
- CI now runs these transaction acceptance tests on a fresh PostgreSQL 18 database. Migration compatibility remains checked on PostgreSQL 16 and 18.
- End-to-end suites cover OPD, pharmacy, lab, administration, IPD, authorization, sessions, audit, idempotency, durability, and frontend reliability. Run them only against an isolated database; audit tests deliberately tamper with history.

Final regression and deployment evidence is in **Phase 1 completion** below. The two established IPD billing failures remain Phase 5 release blockers. Patient identity reconciliation, care-team authorization and the other clinical release gates remain mandatory before clinical go-live.

## Phase 1 completion

Parts 6 and 7 were first built by Claude, reviewed by 4 independent reviewers
with 3 adversarial verifiers per finding (29 confirmed defects), then largely
redesigned by Codex (13 October: one transaction per command, sequenced event
delivery, versioned settings). Claude then fixed what remained:

- **Bill generation dropped charges.** It billed the browser's list and deleted every
  saved draft, so a charge added after the page loaded was lost. It now bills
  exactly the saved drafts; a page whose list differs gets 409 and nothing is
  lost. Adding, changing or removing a draft locks the admission first, so no
  draft can be orphaned on a just-billed admission (`e2e/ipdDrafts.e2e.js`).
- Two Security handlers without error handling (notification rules,
  licenses) could crash the process on a failed save; both now answer 500, and
  `server.js` logs any stray unhandled rejection instead of exiting.
- Alias command paths (`/api/lab/results/RES-<id>`, `/api/pharmacist_lms/*`)
  now require an Idempotency-Key.

### Verification (13 October 2026, throwaway databases only)

| Check | Result |
|---|---|
| `npm test` | 10 passed, 1 skipped (the database suite, run separately) |
| `tests/phase1.integration.test.js` (`HMS_TEST_DATABASE=true`) | 16/16 |
| `verify-migrations.sh`, PostgreSQL 16 and 18 | Pass (1131 schema facts) |
| OPD / pharmacy / lab / admin | 20/20, 18/18, 10/10, 28/28 |
| Authorization / sessions / audit | 5/5, 7/7, 7/7 |
| Idempotency / durability / frontend reliability / IPD drafts | 8/8, 11/11, 2/2, 2/2 |
| Inpatient | 11/13: the two known IPD-billing failures (Phase 5) |

Deployment to the Docker app is recorded in the commit that applies it.
