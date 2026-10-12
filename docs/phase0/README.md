# Phase 0: establish truth and contain unsafe behaviour

Phase 0 of the HMS_1 Clinical Architecture Blueprint. Branch `phase0/safety-fixes`, started from `main` at `1639d15`.

## What changed

| Blueprint item | Change | How it was verified |
|---|---|---|
| F01: reset token accepted as a session | Session tokens carry purpose, issuer and audience, and HTTP and socket auth reject anything else. Reset tokens are single-use. A configured Identity Service no longer falls back to local checks. | `npm test` (7 token tests). Live probe before the fix: a reset token opened the API and the socket. After the fix both are refused, normal login works, and the full forgot-password flow works once and refuses a replay. |
| Published secrets (found during Phase 0) | Signed gateway headers are ignored unless `TRUST_GATEWAY_AUTH_CONTEXT=true`. The server refuses to start with a missing, short or published `JWT_SECRET` / `INTERNAL_SERVICE_SECRET`. Compose files read secrets from `.env`. | Live probe before the fix: forged headers signed with the secret committed to this public repo returned super-admin data. After the fix they return 401. Startup with the old default exits with an error. |
| F02: public uploads | Only `uploads/logo` is served publicly. | A probe file under `uploads/` returned 200 before and 404 after. The logo still returns 200, and `../` traversal returns 404. |
| F04: patient deletion | `DELETE /api/patients/:id` returns 405, and the delete buttons are removed. | API returns 405 and the patient row remains. |
| F07: invented stock batches | New stock needs the batch number and an unexpired expiry from the pack. The medicine form asks for both. | API: no lot gives 400, an expired or invalid date gives 400, and real lot details are stored exactly as entered. Edits to an existing batch are unchanged. |
| F13: fake backup and compliance score | The backup endpoints say the app does not take backups, and the trigger returns 501. The hard-coded 72% score is removed, and checks that claimed a pass without enforcement are corrected. | Endpoints checked live. The compliance list now shows 2 pass, 7 warn and 4 fail. |
| Recoverable baseline | `scripts/backup-db.sh` and `scripts/restore-check.sh`. | Both databases were backed up and restored with every table's row count matching. A tampered backup makes `restore-check.sh` fail. |
| Schema and API manifests | `backend/scripts/schema-report.js` and `backend/scripts/api-report.js`. | See [SCHEMA_DRIFT.md](SCHEMA_DRIFT.md) and [API_ACCESS.md](API_ACCESS.md). The API report was spot-checked live with a lab-technician login. |

## Exit criteria

| Criterion | Status |
|---|---|
| Reset tokens rejected by HTTP and socket sessions | Met |
| Authenticated document access | Met for the static path. Patient-document upload is not built yet, and document *metadata* endpoints check sign-in only (see API_ACCESS.md). |
| Real backup and restore demonstrated | Met (scripts plus a tamper test) |
| Documented schema differences | Met |
| Repeatable environment startup | Partly met. Startup now fails on bad secrets, but the backend still starts in "mock mode" when the database is unreachable while reporting healthy, and it alters the schema at startup (F18, Phase 1). |

## Workflow regression run

The existing `e2e/` suites ran against a throwaway copy of the Docker database (backend on UTC, matching Docker):

| Suite | Result |
|---|---|
| OPD | 20/20 |
| Pharmacy | 18/18 |
| Laboratory | 10/10 |
| Administration | 28/28 |
| Inpatient | 11/13. The 2 IPD-billing steps (advance not applied) fail identically on the original `main` code, so this is an existing defect (blueprint F10/F11, Phase 5). |

Notes for running the suites:
- The demo data has free beds only in Maternity, so the inpatient suite needs two free General, ICU or Private beds.
- Running the backend on a host in India-time shifts lab waiting times by 5 h 30 min (time-zone handling, Phase 1).
- Running all suites back to back trips the login rate limit unless `RATE_LIMIT_MAX_AUTH` is raised.

## Found during Phase 0 and not fixed yet

- **The GitHub repo is public and its history contains working secrets**: the production database password, JWT secrets, the internal service secret and the Aadhaar encryption key. Removing them from current files does not remove them from history. Any server that used them needs new values, and the Aadhaar key needs a migration that keeps existing data readable.
- `CREDENTIALS.md` and `HMS_ALL_LOGIN_CREDENTIALS.txt` (demo passwords for every role) are tracked in the public repo.
- **Deploying `main` now needs a `.env` on the server.** `docker-compose.prod.yml` no longer carries secrets, and the GitHub Actions deploy runs `docker compose -f docker-compose.prod.yml up` on EC2. See `.env.example`.
- Any signed-in user can read any patient's details, visits, allergies and bills, and can **add** allergies and chronic conditions (API_ACCESS.md lists 61 such endpoints). Phase 1 adds action and patient-scope authorization.
- `DELETE /api/doctor/prescriptions/:id` hard-deletes a prescription even after dispensing (F05, Phase 3).
- `POST /api/auth/emergency-reset` resets demo accounts to known passwords. It is limited to super-admins, but any signed-in user can call it when `NODE_ENV=development`.
- The Security screen still shows simulated data for integrations (fake request counts) and data-governance purge dates.
- `CORS_ORIGIN=*` in both compose files.

## Re-running the checks

```bash
cd backend && npm test                      # token rules
node backend/scripts/schema-report.js       # code vs. database
node backend/scripts/api-report.js          # who can call what
scripts/backup-db.sh && scripts/restore-check.sh ~/hms-backups/<timestamp>
```
