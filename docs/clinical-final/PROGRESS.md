# Clinical completion progress

Worktree: `HMS_1-clinical-final`; branch: `completion/clinical-final`.
Plan: [three final phases](../CLINICAL_COMPLETION.md). Original source is the
Industrial HIS clinical blueprint; Mission Control remains separate.

## First implementation increment — 14 October 2026

- A6: consultation and Quick Consult use the governed medication workflow;
  consultation laboratory selection sends approved version IDs. Panels retain
  drafts across tabs. Unknown saves retain their original request key; refresh
  errors do not turn a confirmed command into an unknown outcome.
- A6: chart banners use explicit allergy-review state; the legacy standalone
  composer opens coded prescribing with its exact patient/encounter context.
  Historical prescriptions cannot be hard-deleted. Role navigation links the
  medication and laboratory workspaces, and low-stock rows use medicine IDs.
- A6: remaining pharmacy/laboratory service-day boundaries use the hospital
  calendar; browser dates no longer depend on the user's computer time zone.
- B3: held results produce an error acknowledgment/worklist item; result IDs
  distinguish order groups; transaction-local device actors reach database
  audit triggers. Retired/replaced listeners reconcile their ports, queues and
  buffers are bounded, and production MLLP requires an explicit IP allowlist.
- B5: checkpoint validation requires the complete manifest; an empty remote
  store cannot pass. Shipment/read verification checks immutable versions,
  checksums, approved retention mode and expiry.
- B6: WAL archive retries verify identical bytes, refuse replacement/corruption
  and use atomic creation. Deployment configuration initializes the archive
  directories with private PostgreSQL ownership.
- C1: scheduling now races 50 requests; a separate real PostgreSQL/HTTP race
  proves exactly one of 50 admissions acquires a synthetic bed.

## Checks actually run

Environment: Node 24.13.0, PostgreSQL 16 disposable database
`hms_p4_final_20261014a`, API 5064, Vite 5236, separate local MinIO Object Lock
bucket. This is local/synthetic evidence, not hospital or regional validation.

| Check | Latest observed result |
|---|---|
| Backend unit tests | 27 passed, 1 DB integration suite skipped here |
| Frontend production build | Passed; temporary artifact under `/tmp/hms-clinical-final-build` |
| Consultation browser/API integration | 5/5, including lost committed response/reconciliation, preserved drafts and immutable history |
| Device PostgreSQL/HTTP/MLLP suite | 11/11, including actor attribution, held results, multigroup IDs and port replacement |
| Local Object Lock audit suite | 5/5, with a complete-manifest mismatch fixture |
| Scheduling | 6/6; exactly one of 50 slot requests succeeds |
| Clinical bed concurrency | 2/2; exactly one of 50 admissions succeeds and physical/occupancy state agrees |

Initial new-fixture errors (audit table naming, worklist key/count scope,
allergy-state locator, and automatic HTTP retries in the lost-response test)
were corrected and the affected checks rerun. No failed check is relabelled
as passing. Subsequent edits require their appropriate checks before release.

This increment is not completion of all three phases. Foundation, exchange,
privacy/recovery, full regression/performance, readiness tools and actual
hospital/target-environment gates remain tracked in the plan.
