# Final evidence index (completion C4)

Branch `integration/complete-hms`. Recorded 21 October 2026 on the developer workstation,
throwaway databases only. Local and mocked evidence; not production, real-device, regional or
hospital validation.

## Candidate

| Commit | What it is |
|---|---|
| `c985abe` | Evidence candidate: every check below ran on exactly this commit |
| `1dc3a42` | Final code commit. Differs from `c985abe` only in test tooling (`e2e/helpers.js`, `e2e/backupRestore.e2e.js`, `e2e/recoveryDrill.e2e.js`, `scripts/e2e-regression.sh`); the suites it changes were rerun on it on both engines |

Commit IDs: on 21 October the unpushed history was rewritten to remove "Co-Authored-By"
lines from commit messages (owner's request). Only messages changed; every commit's tree is
identical, so the evidence holds unchanged. The checks ran when the candidate was `491c924`
(now `c985abe`) and the final code commit `26ae041` (now `1dc3a42`); the raw logs keep the IDs of
the time. Old to new: `evidence/final-20261021/commit-map-before-message-rewrite.txt`.

Migrations: 0001–0160 (`backend/migrations`); a release-candidate artifact in CI records their
SHA-256 sums.

## Results

| Check | Engine | Result | Record |
|---|---|---|---|
| Fresh migrations, second run a no-op, `migrate.js check`, legacy-database upgrade, unattributed-grant and audit-trigger checks, fresh = upgraded schema | PostgreSQL 16.15 | PASS, 6256 identical schema facts | `evidence/final-20261021/migrations-pg16-c985abe.txt` |
| Same | PostgreSQL 18.6 | PASS, 6256 identical schema facts | `evidence/final-20261021/migrations-pg18-c985abe.txt` |
| Full end-to-end regression on databases built from the migrations and the demo seed (the CI configuration, `scripts/e2e-regression.sh`) | PostgreSQL 18.6 | 83/85 suites. The two failures were the test-tooling defect fixed in `1dc3a42` (database copies made on the wrong server); both pass on `1dc3a42` | `seeded-pg18-c985abe.txt`, `reruns-1dc3a42.txt` |
| Full end-to-end regression on the backup-derived test database (the standard local pass) | PostgreSQL 16.15 | 84/85 suites, 606/607 steps. The one failed step was a browser wait timeout in patient identity; the suite passed 9/9 twice on rerun against the same database and 9/9 on PostgreSQL 18: intermittent, recorded as such | `snapshot-pg16-c985abe.txt`, `reruns-1dc3a42.txt` |
| v2 contract conformance (every recorded v2 command response and sampled reads against `backend/contracts/v2.openapi.json`) | both runs | 2/2 | in the regressions above |
| Strict TypeScript (server and browser contracts), generated contract check, requirement inventory check (53 acceptance rows, 12 interfaces), frontend production build, production compose validation | — | PASS on `1dc3a42` | this document |

The official HL7 FHIR validator 6.10.4 (ndhm.in 6.5.0) ran inside the FHIR and clinical
exchange suites with zero errors in both regressions.

## How to reproduce

- Migrations: `DB_HOST=… DB_PORT=… backend/scripts/verify-migrations.sh` against a server where
  throwaway databases may be created (PostgreSQL 16 and 18).
- CI-configuration regression: `DB_HOST=… DB_PORT=… scripts/e2e-regression.sh <out-dir>` with
  Node 24, Playwright Chromium, docker, Java and the validator from
  `tools/fhir-validator/build.sh`. CI runs the same on PostgreSQL 18 (job `e2e-regression`).
- Requirement inventory: `node scripts/requirements-inventory.cjs --check`.

## Not covered by this evidence

- The CI workflow itself has not run on GitHub: that needs a push (owner decision).
- The running Docker application still serves older code on PostgreSQL 16; nothing here was
  deployed. Its data upgrade to PostgreSQL 18 needs a rehearsal on a copy first.
- External gates listed in `HANDOFF.md`.
