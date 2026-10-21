# Clinical completion handoff (completion C8)

21 October 2026. Branch `integration/complete-hms`, final code commit `26ae041`. Requirements
source: `HMS_1_Clinical_Architecture_Blueprint.md` (clinical Phases 0–7). Mission Control is a
separate product and is not part of this work.

## Where it stands

All 24 completion packages are engineering-done (`docs/CLINICAL_COMPLETION.md`). Engineering
completion is not hospital go-live: the external gates below need real hospitals, vendors,
licences and environments, and no synthetic approval stands in for them. Nothing has been merged
to `main`, pushed or deployed.

Evidence for the exact candidate: `EVIDENCE_INDEX.md` (migrations on PostgreSQL 16 and 18;
full regressions on both; contract, inventory, type and build checks).

## What this round delivered

| Package | Delivered | Commits |
|---|---|---|
| A3 | Every blueprint 3.10 interface on `/api/v2` (scheduling, admissions, transfers, discharge, laboratory, billing, payments, deposits, credit notes, refunds, events, medication), each calling the legacy command; medication screens on v2; published contract checked against recorded responses | `7076ce2` `13c5530` `142a553` `47eeda6` `eed1a2d` `e6684e9` |
| A5 | The database refuses a discharge without its signed document; discharge and handover keep the observations current at the time | `03a4427` `f26f511` (audit trigger) |
| A6 | Legacy writers confirmed retired; redirect-only prescription screen removed; registration makes no free-text report draft | `185d681` |
| B6 | Backups carry the encrypted document store; a restore verifies every stored document | `c6b4acd` |
| B8 | Release script with automatic rollback; drain-safe stop; separate supervised worker | `8273b90` |
| C1 | The three missing 5.3 scenarios tested; matrix brought up to date | `20142a4` |
| B1 | FHIR reads follow the chart rules; prescriptions and discharge summaries delivered to ABDM; provenance in every document | `4a2db87` `efb67ad` |
| A1 | Requirement-to-test inventory; CI end-to-end regression on seeded databases; validator build | `f26f511` |
| C4 | Exact-candidate evidence | `491c924` `26ae041`, `EVIDENCE_INDEX.md` |
| — | Security: password-reset codes could be guessed (no attempt or rate limit); fixed | `3fcde18` |
| — | Repository: machine-local `node_modules` symlinks were tracked; removed | `491c924` |

Earlier packages (A2, A4, A7, A8, B2–B5, B7, C2, C3, C5–C7) are described with their commits
in `CLINICAL_COMPLETION.md`.

## Decisions for the owner

1. **Merge** `integration/complete-hms` into local `main`.
2. **Before any push**: 91 of the 144 commits not yet on GitHub end with a
   "Co-Authored-By: Claude" line, which GitHub shows as a contributor (all 144 are authored by
   the owner). Those lines can be removed from the unpushed history before pushing; commits from
   `eed1a2d` on have none. Already-pushed history was left unchanged at the owner's request.
3. **Push to GitHub.** This is also the first time the new CI jobs (`e2e-regression`, the
   inventory check) will run; nothing deploys automatically from CI.
4. **Update the running Docker application.** It serves older code on PostgreSQL 16 (including
   the password-reset weakness fixed in `3fcde18`). The production compose now specifies
   PostgreSQL 18, the restricted runtime identity and the separate worker. Rehearse the data
   upgrade on a copy first (dump/restore into PostgreSQL 18, `migrate.js up`,
   `scripts/restore-check.sh`), then release with `scripts/release.sh`. The `Jenkinsfile` still
   force-removes and rebuilds the containers; replace that stage with `scripts/release.sh` before
   using Jenkins for releases.
5. **Shared database cleanup** of the fake test records in `hms` (backup at
   `~/hms-backups/cleanup-20261020/hms-before-cleanup.dump`).
6. **Rotate the secrets** that appear in the public repository's history.

## Releasing and rolling back

- Release: `scripts/release.sh [compose-file]` (backup, build, migrate, grant, replace worker →
  backend → frontend, health check, automatic rollback). Procedure and outcomes:
  `OPERATIONS.md` section 10.
- Migrations only add (tables, columns, functions, triggers); a rollback does not undo them and
  the previous version runs on the newer schema. New since the last release: 0157–0160.
  0159 adds a deferred check that refuses any change of an admission to Discharged without its
  signed discharge document; older discharged admissions are unaffected.
- Restore: `scripts/restore-check.sh <backup-dir>` verifies row counts and every stored patient
  document; `RECOVERY.md` covers point-in-time restore and the document step after it.

## Open engineering items

- A keyboard-only end-to-end OPD journey test (keyboard handling is tested in `clinicalUx`).
- One intermittent browser timeout seen once in `patientIdentity` (passes on rerun).
- "Step found" rows of the acceptance matrix still need a line-by-line assertion review before
  the hospital release.

## External gates (not engineering, not done)

- ABDM sandbox registration and certification (mock gateway only so far).
- Licensed terminology content.
- A real virus scanner deployment (a protocol fixture is used in tests).
- Production storage and key custody for write-once audit evidence; target-region recovery
  drills (RPO/RTO) and fencing.
- Hospital owner reviews (OPERATIONS.md, hazards, clinical configuration), named owners,
  language review of printed text, staff rehearsals and supervised pilots.
- A release rehearsal on the target host and target-environment performance measurement.
