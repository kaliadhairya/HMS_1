# Instructions for coding agents (Codex, Claude, others)

## Status (2026-10-13): Phase 1 complete — you may work

Phase 1 is committed on branch `phase1/integrity-foundation` (head of the
branch) and deployed to the local Docker app (migrations 0001–0009). Evidence:
`docs/phase1/README.md`, section "Phase 1 completion".

Known and accepted:
- Two IPD-billing e2e steps fail (Phase 5 work).
- `audit-checkpoints/audit-checkpoint-2026-10-12T20-07-04-990Z.json` is empty:
  a checkpoint lost when the machine went down mid-write, before writes were
  made atomic. Do not delete it; `audit-verify.js` reports it as one problem.
- The local PostgreSQL 18 database (`backend/.env`) is not migrated; ask the
  owner before migrating it (it will quarantine 128 orphaned rows).
- The public GitHub history still contains old secrets; rotation is the
  owner's decision.

When you start, put your own STOP notice here and remove it when you finish.

## Next work (for Codex and other agents)

The prompt for Phases 2–7 is in `docs/NEXT_PHASES_PROMPT.md`. Start with
Phase 2 on a new branch cut from `phase1/integrity-foundation`.

## Standing rules

- Schema changes only through new files in `backend/migrations/`; never edit an applied one.
- Run tests only against throwaway databases (`hms_e2e`, `hms_phase1*`, `hms_test*`, `hms_verify*`), never `hms`.
- Never claim a deployment, test pass or evidence file you have not checked exists.
- Do not delete backups in `~/hms-backups/` or any AI tool's session data.

## Phase 3 (Codex)

Phase 3 feature branch completed and reviewed in `HMS_1-phase3`, branch
`phase3/medication-safety`. Phase 2 integration and owner-approved merge remain
required; leave Phase 2's implementation files unchanged.
- 2026-10-13: read Phase 3 and parallel-work instructions; implementing migrations
  0030–0049, medication orders/CDS, inventory, eMAR and nursing workflows;
  touching Phase 3-owned files and additive route/idempotency registrations.
- Tests use `hms_p3_*` on Docker PostgreSQL 5434, backend 5012, Vite 5184.
- No shared-app deployment or merge.

- 2026-10-13: paused at owner request; progress recorded in docs/phase3/RESUME.md.

- 2026-10-13: resumed; reviewing medication schema and implementing Phase 3-owned domain services, routes, UI and acceptance tests.

- 2026-10-13: completed medication/backend/frontend implementation and review; all 17 verifier suites pass, PG16/18 migrations match through 0043, build passes. Evidence: docs/phase3/verification.json. No shared deployment/merge. Phase 4 awaits the merged base required by the main parallel-work rules.
