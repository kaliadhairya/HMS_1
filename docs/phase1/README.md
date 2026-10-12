# Phase 1: integrity and security foundation

Branch `phase1/integrity-foundation`, started from `phase0/safety-fixes`.

| Part | Status |
|---|---|
| 1. Versioned migrations and honest startup | **Done** (see below) |
| 2. Find and repair broken links in existing data; enforce relationships in the database | Not started |
| 3. Revocable sessions (logout, deactivation and password change end a session at once) | Not started |
| 4. Action and patient-scope authorization | Not started |
| 5. Transactional, tamper-evident audit trail | Not started |
| 6. Idempotency for retried clinical and financial commands | Not started |
| 7. Durable state: settings and IPD draft charges out of process memory; outbox for events | Not started |
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

### Not yet applied

The local PostgreSQL 18 database (`backend/.env`) has not been migrated. A server started against it now refuses to start until `cd backend && npm run migrate` is run. The same upgrade was verified on a copy of it.
