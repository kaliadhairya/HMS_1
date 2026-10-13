# Phase 4: complete laboratory loop

Status: started; implementation and acceptance verification are pending.
Worktree: `HMS_1-phase4`; branch: `phase4/laboratory`.
Base: integrated Phase 2 and Phase 3 commit `01c19aa` on
`integration/phase2-phase3`, inspected on 13 October 2026.
No shared deployment or clinical database migration has been performed.

## Initial inspection

The laboratory findings in the blueprint remain present in this base:

- `routes/hms/investigationOrders.js` identifies tests by display names. Its
  encounter-state check is outside the write transaction; new ordering must
  share the encounter finalization lock and use the Phase 2 care-team check.
- `routes/lab.js` derives samples, barcodes, specimen types, collector and
  storage descriptions from investigation items. These are not evidence of
  an actual accession, collection, receipt or custody event.
- Result entry reads state before its transaction, writes mutable item
  columns and calculates completion without locking the order aggregate.
  It does not require an expected result version or technical verification.
- `abnormalFlag()` parses a user-entered range. It has no approved method,
  unit or patient-context configuration and cannot determine critical status.
- `routes/reports.js` has an independent writable report path and permits
  caller-supplied status. It must become read-only when governed release is
  introduced. Historical reports must remain readable and labelled.
- Existing laboratory PDF routes need care-team authorization and exact
  report-version selection before streaming a released report.
- The integrated base provides care teams, practitioner records, versioned
  migrations, transaction inheritance, idempotency, audit and outbox/inbox.
  These mechanisms will be reused rather than replaced.

## Implementation sequence

| Step | Deliverable | Required verification | Status |
|---|---|---|---|
| 1 | Coded catalogue, specimen requirements, panels, price references and legacy reconciliation | No guessed legacy links; approved catalogue revisions retain provenance | Pending |
| 2 | Accession/specimen links, custody, aliquots, rejection and recollection | Wrong-patient refusal; multi-test specimen; multi-specimen order; rejected specimen cannot satisfy collection | Pending |
| 3 | Immutable result versions, analyzer/QC evidence and technical review | Real PostgreSQL races: stale writer rejected; concurrent analytes preserve aggregate completion | Pending |
| 4 | Preliminary/final/amended report versions and scoped release privileges; retire legacy writes | Exact included result versions; original retained; unauthorized release refused | Pending |
| 5 | Separate approved reference intervals, critical policies and explicit conversions | Missing configuration visible; unit mismatch refused; configuration empty by default | Pending |
| 6 | Critical delivery, acknowledgment, configured escalation, clinical action and result review | Preliminary critical finding; unavailable recipient; missed acknowledgment; post-discharge follow-up; amendment starts new communication | Pending |
| 7 | Versioned analyzer adapter, transactional inbox and reconciliation | Duplicate message creates one outcome; mismatched identity quarantined; imported result remains provisional | Pending |
| 8 | Collection/result/release/critical/doctor-review frontend workflows | Preserved conflict draft; truthful save status; original-key reconciliation; visible missing intervals and QC failure | Pending |
| 9 | Full regression, PG16/18 upgrade verification, build and review | All new scenarios and existing suites; document the two known Phase 5 IPD billing failures separately if reproduced | Pending |

## Frontend workflow

`Coded order → collection worklist → patient/specimen identity confirmation
→ accession label → collection and custody → laboratory receipt or rejection
→ provisional result → QC and technical review → authorized report release
→ responsible clinician review and documented action`.

Rejection branches to a durable recollection task. A verified critical finding
branches immediately to communication and follow-up before final report release.
Correction creates a new result/report version and a fresh communication cycle;
original reports and unresolved tasks remain visible.

Clinical owners supply reference intervals, critical thresholds, QC rules and
escalation timetables with provenance and effective versions. Production
configuration ships empty; acceptance-test content is synthetic.

## Isolation and verification boundaries

- New migrations: `0050`–`0069`; never edit committed migrations.
- Docker PostgreSQL port `5434`, throwaway databases `hms_p4_*` only.
- Backend port `5022`; Vite port `5194`.
- Dependency installation: separate locked `npm ci` completed in `backend`,
  `frontend` and `e2e` on 13 October 2026.
- Initial inspection and dependency installation are complete. No Phase 4
  feature tests have run, and no Phase 4 completion claim is made.
- Shared app ports `4999`/`5001`, database `hms`, Phase 2 and Phase 3 worktrees
  remain outside this phase's test/mutation scope.

Follow the authoritative instructions in the main worktree:
`HMS_1/docs/PHASE4_PROMPT.md` and `HMS_1/docs/PARALLEL_WORK.md`.
