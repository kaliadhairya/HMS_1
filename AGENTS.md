# Instructions for coding agents (Codex, Claude, others)

## Parallel work in progress (2026-10-13): read docs/PARALLEL_WORK.md first

- **Phase 2 (Claude):** this main folder, branch `phase2/patient-journey`, migrations 0010–0018 in use.
  Do not edit files Phase 2 owns, and do not switch branches in this folder.
- **Phase 3 (Codex):** your own worktree `../HMS_1-phase3`, branch `phase3/medication-safety`,
  migrations 0030–0049. Prompt: `docs/PHASE3_PROMPT.md`.
- **Phase 4 (Codex, after Phase 3):** worktree `../HMS_1-phase4`, migrations 0050–0069.
  Prompt: `docs/PHASE4_PROMPT.md`.
- **Phase 5 (Claude):** worktree `../HMS_1-phase5`, branch `phase5/revenue-cycle`
  from `integration/phase2-phase3`, migrations 0070–0089. Plan: `docs/phase5/PLAN.md`.
- No one deploys to the shared Docker app without the owner's approval.

### Session log
- 2026-10-13 Claude: Phase 2 part 1 (patient identity) committed fcb87c7; part 1 deployed to Docker 2026-10-13; part 2 (duplicate review and merge) finished and tested; not deployed yet.
- 2026-10-13 Claude: Phase 2 parts 3–9 built (practitioners 0012, scheduling 0013, care teams 0014, triage 0015, clinical documents 0016, beds/ADT 0017, referrals 0018); see docs/phase2/README.md. Not deployed. Appointment slot resolver now follows the scheduling exclusion rule. The durability e2e suite starts a second backend on port 15103 by default; that port is used by Codex's `hms_p3_final` server, so run it with `E2E_SECOND_PORT=15203`.
- 2026-10-13 Claude: merged Phase 3 onto Phase 2 on `integration/phase2-phase3` (not deployed). Medication routes now follow care-team scope; old /api/ipd/mar writes return 410; tests run on any throwaway DB. Full regression passes except the two known IPD-billing steps. See docs/INTEGRATION_PHASE2_PHASE3.md. Codex: start Phase 4 from this branch only when the owner says so.
- 2026-10-14 Claude: Phase 5 (revenue cycle) finished on `phase5/revenue-cycle` (worktree `../HMS_1-phase5`, head 36a1fac, migrations 0070–0076). Full regression passes, including the two IPD billing steps. Not merged, not deployed. Phase 4 and Phase 5 share base 01c19aa; whichever merges second re-runs all suites. See docs/phase5/README.md on that branch.

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

## Phase 5 (Claude)

STOP: Phase 5 billing files are owned by Claude in `HMS_1-phase5` on
`phase5/revenue-cycle` (see `docs/phase5/PLAN.md`, "Ownership"). Other agents
leave this worktree unchanged.
- 2026-10-14: started from `01c19aa`. Billing accounts, charge capture,
  invoices, journal, deposits/payments/refunds, insurance and reconciliation.
  Lab and medicine charges are captured by database triggers, so Phase 3 and
  Phase 4 files are not edited. Test databases `hms_p5_*`, API 5032, Vite 5204.
  No shared deployment.
- 2026-10-14: migrations 0070–0076, services/billing.js, insurance.js,
  reconciliation.js, routes/finance.js; /api/billing rewired; old IPD
  draft/generate endpoints return 410; billing screens (account workspace,
  billing desk, reconciliation, price list). Touched shared files additively:
  server.js (mount + worker), utils/idempotency.js (/api/finance), App.jsx,
  navConfig.js. Also routes/receptionist.js (Phase 2, own). Not deployed.
  See docs/phase5/README.md.



## Phase 4 (Codex)

Phase 4 implementation and review completed in `HMS_1-phase4` on
`phase4/laboratory`; integration/deployment remain owner-controlled.
- 2026-10-13: started from integrated Phase 2/3 `01c19aa`; read Phase 4 prompt,
  parallel rules, foundation/medication evidence and laboratory blueprint.
  Implementing laboratory-owned routes/UI, migrations 0050–0069 and tests;
  shared changes limited to additive registrations. Private test databases
  `hms_p4_*`, API 5022 and Vite 5194. No shared deployment.

- 2026-10-14: resumed actual implementation; building coded catalogue and specimen migrations/services, followed by versioned result/release and critical follow-up workflows.

- 2026-10-14: completed coded laboratory/backend/frontend/worker implementation and review; 38 new lab scenarios and all 30 suites have passing latest results, PG16/18 migration checks through 0059 pass (3191 facts), build/static checks pass. Evidence: docs/phase4/verification.json. No shared deployment; clinical-navigation ownership request copied to main docs/requests.

## Phase 4/5 integration (Codex)

Integration completed in `HMS_1-phase4-phase5` on
`integration/phase4-phase5`. Phase source worktrees remain unchanged.
- 2026-10-14: owner authorized combining Phase 4 and Phase 5 only; remaining
  feature/go-live gaps remain with the owner. Resolving merges and validating
  clinical/financial interoperability; no shared deployment. Tests use
  dedicated `hms_p4_p5_*` copies, API 5042 and Vite 5214.

- 2026-10-14: completed both merges and reviewed the combined workflows; all 32 suites have passing latest results (full private application regression plus a clean audit recheck with isolated checkpoints), PG16/18 schemas match through 0076 (4092 facts), both source-branch upgrade paths and frontend build pass. Remaining gaps reserved for the owner; no shared deployment. See docs/INTEGRATION_PHASE4_PHASE5.md and docs/integration-phase45/verification.json.

## Phase 6 (Claude)

STOP: Phase 6 (interoperability and operations) is owned by Claude in
`HMS_1-phase6` on `phase6/interop-ops`, based on `integration/phase4-phase5`
(2a07ca8). Plan: `docs/phase6/PLAN.md`. Other agents leave this worktree
unchanged; Codex (Phase 7) asks through `docs/requests/`.
- 2026-10-14: started 6A (terminology releases). Migrations 0090–0109, test
  databases `hms_p6_*`, API 5052, Vite 5224. No shared deployment.
- 2026-10-14: 6A terminology (0090), 6B FHIR read boundary, 6H write-once
  audit checkpoints + accountable worklist (0091), 6G PITR/standby drills
  committed (5d28c9e, 58d8b61, e1eee19, 215b907). Full regression on
  hms_p4_p5_p6_e2e (name chosen so the Phase 4/5 suites' guards accept it)
  passes; new suites terminology, fhir, auditWorm. Codex's 4+5 integration
  independently re-verified: 32/32 suites, evidence in
  ~/hms-verification/claude-review-phase45-20261014-2a07ca8. Not deployed.
- 2026-10-14: 6C-6E ABDM (0092 interface log, 0093 ABDM), 6F device
  contracts (0094), 6I downtime kit (0095) committed. All nine Phase 6
  packages done; final regression 39/39 on hms_p4_p5_p6_e2e, FHIR/ABDM
  documents 0 validator errors. Results and owner items: docs/phase6/README.md.
  Not merged, not deployed. STOP notice remains until the owner decides the merge.
