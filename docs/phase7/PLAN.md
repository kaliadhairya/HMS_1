> Preserved preparation draft. Current owner-authorized scope and execution
> are governed by `../CLINICAL_COMPLETION.md`; old ownership/deferred-work
> statements below describe the original draft, not the completion checkout.

# Phase 7: controlled clinical rollout preparation

Owner-authorized scope (14 October 2026): hazard register, acceptance gates,
staff rehearsals and staged rollout preparation. Branch
`phase7/clinical-readiness`, worktree `../HMS_1-phase7`, from integrated
Phase 4/5 base `0a90745`. No clinical deployment is authorized by this package.

1. Trace every blueprint finding and current release risk to a control,
   acceptance test, procedure and accountable hospital role.
2. Keep engineering test results separate from clinical approval, target
   deployment evidence, operational drills and staff competency.
3. Record Phase 6 dependencies as unresolved until its owner supplies actual
   evidence. Claude owns all Phase 6 packages, including 6F. Codex reviews 6F
   against the Phase 4 analyzer contract when the implementation is ready.
4. Prepare one named OPD service, then a named ward, then additional services.
   Each transition requires a separate review of scope, defects, training,
   stock/financial reconciliation, operational evidence and approvals.
5. Supply a local checker which validates register completeness and evidence
   bindings, reports blockers and never authorizes or deploys a release.

Hospital staff remain responsible for policy values, clinical risk judgments,
named approvals, training and real drills. No clinical rule, observation
window, escalation interval or acceptable incident rate is invented here.
The RPO/RTO targets come from the blueprint: 300 and 3,600 seconds.

Preparation is complete when this package is traceable and tested. Clinical
rollout remains blocked until its evidence and human approvals are complete.
This branch changes readiness tools/documents only; schema slots 0110–0119
are reserved and unused. Future application tests use `hms_p7_*`, API 5062,
Vite 5234 and second API 15542. Phase 6 uses 5052/5224.

Phase 6's worktree is left unchanged. Requests live in this branch's
`docs/requests/`. Existing Phase 4/5 feature gaps remain owner work.
