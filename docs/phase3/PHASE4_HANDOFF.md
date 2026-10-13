# Phase 4 handoff

Read the main worktree's `docs/PHASE4_PROMPT.md`, `docs/PARALLEL_WORK.md` and
AGENTS.md before starting. The authoritative prompt has been reviewed; no
Phase 4 files, worktree or implementation have been created yet.

**Recommended base:** the owner-approved merged Phase 3 result, after Phase 3
has been rebased on the approved Phase 2 result and every suite rerun. The
current review branch is `phase3/medication-safety`; code evidence is at
`a7548b4` plus the subsequent documentation commit. Do not start from its old
Phase 1 base and lose the medication/clinical-context integration.

The parallel rules explicitly say, "Phase 4 starts from Phase 3's merged
branch, or from Phase 2's if the owner prefers. The owner says which."
They also require Phase 3 to be merged before the Phase 4 worktree is created.
Owner authorization is required for that merge; this work has not performed it.

After that selection, create `HMS_1-phase4`, branch `phase4/laboratory`, from
the exact merged base. Use migrations 0050–0069, private `hms_p4_*` databases,
backend 5022 and Vite 5194. Keep Phase 2/3 owned files unchanged and make only
the allowed additive shared registrations. Complete the specimen, result/QC,
release/amendment, critical-result escalation, analyzer inbox and frontend
workflows described in the Phase 4 prompt, with its real-PG concurrency and
full-regression verification requirements.
