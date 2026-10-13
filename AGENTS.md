# Instructions for coding agents (Codex, Claude, others)

## Parallel work in progress (2026-10-13): read docs/PARALLEL_WORK.md first

- **Phase 2 (Claude):** this main folder, branch `phase2/patient-journey`, migrations 0010–0029.
  Do not edit files Phase 2 owns, and do not switch branches in this folder.
- **Phase 3 (Codex):** your own worktree `../HMS_1-phase3`, branch `phase3/medication-safety`,
  migrations 0030–0049. Prompt: `docs/PHASE3_PROMPT.md`.
- **Phase 4 (Codex, after Phase 3):** worktree `../HMS_1-phase4`, migrations 0050–0069.
  Prompt: `docs/PHASE4_PROMPT.md`.
- No one deploys to the shared Docker app without the owner's approval.

### Session log
- 2026-10-13 Claude: Phase 2 part 1 (patient identity) committed fcb87c7; part 1 deployed to Docker 2026-10-13; part 2 (duplicate review and merge) finished and tested; not deployed yet.

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
