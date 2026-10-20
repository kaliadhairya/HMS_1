# Hazard checker and controlled rollout preparation (C5/C7)

Engineering reviewed on 17 October 2026. The catalogue covers all 18 historical
blueprint findings and 18 release hazards, with accountable hospital roles,
controls, real test paths, procedures and applicable OPD/WARD/EXPANSION stages.
Every linked procedure and heading is checked; missing runbooks were completed.
The assessment template retains null owner names and no supplied approvals.

Six checker tests pass: empty assessment stays blocked; malformed sections and
supersession return INVALID; stale/wrong-release/wrong-reviewer/missing/tampered/
future evidence fails; symlinks/absolute/escaped artifacts fail; an unresolved
failure blocks until explicitly superseded by a valid newer same-scope review;
hazards need accepted linked owner evidence and catalogue links must exist.

Even a synthetic fixture with complete evidence returns REVIEW_REQUIRED and
authorization=false. These fixtures exercise checker mechanics only and are
never used as the hospital's assessment. The real unfilled template remains
BLOCKED for every stage. Verification does not deploy or authorize care.

The rollout runbook defines separate OPD, ward and expansion scope decisions,
staff competency, reconciliation, observed pilot evidence, escalation/stop,
downtime and return-to-service responsibilities. Rehearsals cover R01–R12;
the 6F review preserves the actual analyzer v1 and machine custody boundaries.

## External inputs still required

Hospital owner supplies actual named leads/deputies, clinical configuration,
qualifications/policy approvals, licensed content, real device/exchange and
target-environment validation, staff rehearsals and supervised pilot decisions.
The register deliberately does not invent names or close their dispositions.
Final integrated candidate evidence remains C4/C8; actual rollout is separate
from the authorized local application upgrade.
