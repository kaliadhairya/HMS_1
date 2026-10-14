# Active clinical completion checkpoint

Continue all 16 Codex-owned packages; the owner's goal remains active. No
pause or final completion has been requested. Checklist:
`docs/CLINICAL_COMPLETION.md`; source is the Industrial HIS clinical blueprint.
Mission Control remains excluded. No shared deployment/pilot is authorized.

Current branch `completion/clinical-final`, code increment **584e169** and
evidence/coordinator increment **e5b8ebf**. See PROGRESS.md for actual test
results and open A2/A3 integrations. New applied migrations 0113–0122 must
not be edited; continue in 0123–0149.

Private environment file: `/tmp/hms-clinical-final.env` (do not print secrets).
Assigned PG16 database `hms_p4_final_20261014a` at 5434, API 5064, Vite 5236.
Assigned PG18 database `hms_verify_final_backup18_20261015` at 55464. Both are
through 0122. The API was restarted after receipt version 2; current exec
session 96224. Do not use the shared database `hms` or another agent's ports.

Most recent checks: facility/grant isolation 19/19 on each engine, scoped
receipt HTTP 4/4, financial idempotency 8/8, Phase 1 failure acceptance 16/16
on PG18, credential administration browser 4/4, session facility 5/5, type
check/build passed. The backend aggregate before the final receipt-policy
assertion was 52 passed/2 skipped. All test database credentials/verification
fixtures are synthetic; no hospital credential or approval is established.

Continue with complete A2/B4 operational ownership and clinical gates:

- Remaining lab approval/reconciliation/run/review and financial child tables
  still need reviewed facility ownership; do not blindly scope genuinely
  shared patient identity/safety facts or hospital terminology identities.
- LaboratoryCommon now checks professional LAB_PROCESS/LAB_RELEASE; analyzer
  service accounts need a separate approved ANALYZER facility capability.
  Do not invent professional credentials for a machine. Device intake must
  bind the contract's explicit service actor/facility for the entire message
  transaction, not only the result savepoint. Preserve AE/AR, stable group IDs
  and the exact analyzer contract v1 adapter.
- Nursing, dispensing, generic note/sign and remaining legacy clinical
  writers need the facility privilege boundary. Configure facility switching
  and membership administration with current-session validation and drafts.
- Provision a safe runtime identity in local/deployment tooling; production
  now refuses an owner/superuser/BYPASSRLS identity. Do not weaken that check
  or set production to development to bypass it. Worker contexts remain open.
- Implement A3 v2 UUID adapters/API contract through the same transaction,
  receipt/audit/outbox service boundary; current public UUIDs are additive.
- C4 must strengthen final schema/permission evidence and run full fresh/
  upgrade/regression. Old physician fixtures need explicit synthetic verified
  credentials and privileges; old sign calls need saved nonempty content and
  the reviewed If-Match. Do not disable safety checks to make old suites pass.

Claude's worktree is now present at `../HMS_1-claude-final`, head **870a078**.
Only read it. A7 130b4fe, A8 bc5363e, fixes e886d27, C6 870a078 are committed;
C2/C3 and storage are in progress there. The handoff is in that worktree's
uncommitted `docs/requests/claude-final-handoff.md`; none are merged here.
Read `docs/requests/codex-foundation-followup.md`. A8's facility integration
still waits for our newly committed contract. Shared changes must be reviewed
and merged into this checkout; never edit Claude's files in its worktree.

B6 encrypted logical/physical evidence is committed at a59850b and B7 has its
core handoff. B6 still needs A4 exact private object versions and final C4;
local RPO/RTO is not regional proof. B5 historical key proof, B8 release/drain,
A1 traceability, A5 continuity, B1 exchange, C1 coverage and C5/C7/C8 readiness/
consolidation remain open. Mark complete only with implementation and relevant
acceptance evidence, and retain real external/hospital gates explicitly.
