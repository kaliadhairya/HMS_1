# Authorized clinical release closeout

Owner accepted the final closeout plan on 17 October 2026. Source: the
Industrial HIS clinical blueprint and `docs/CLINICAL_COMPLETION.md`.
Mission Control remains a separate product. Work continues with one agent.

## Delivery

Finish all open engineering packages, review the eight Claude deliveries,
verify the exact candidate, merge into local `main`, and update the existing
Docker application with its data preserved. The owner selected updating the
existing Docker installation rather than leaving only a parallel demo.
This newer authorization supersedes the historical local no-merge/no-deploy
restriction for this closeout only. No remote publication or hospital pilot
is authorized by this instruction.

## Dependency order

1. Review/test/save pending B4; review the four later Claude commits. Preserve
   newer facility/audit authorities when incorporating handoff changes.
2. A2/A3/A5/A6: finish clinical privileges, native command adapters and browser
   consumers, shared observations, signed nursing/discharge continuity and
   removal of unsafe legacy writers. No invented clinical thresholds.
3. B1/B6/B8/A1: scoped exchange, durable backup/document restore validation,
   restricted API/worker identities, supervised workers, readiness/draining,
   compatible Node 24/PostgreSQL 18 images and CI.
4. C1/C4/C5/C7/C8: blueprint acceptance matrix; exact-candidate fresh/upgrade
   PG16/18 and complete regression; tested evidence checker and hazard gates;
   review and consolidate all delivered packages.
5. Back up the existing local app and rehearse its actual data upgrade into
   isolated PostgreSQL 18. Retain keys, files, audit evidence and old volumes.
   Do not attach PG18 to PG16 data or silently replace it with an empty volume.
6. Merge the accepted candidate into local main, drain/fence the old writer,
   validate the final consistent copy, switch to the tested images and verify
   the frontend/API/workers and restart persistence. Preserve original branches
   and untracked work. After new writes, rollback requires reconciliation.
7. Deliver the tested workflow guide and evidence-based product/SaaS assessment,
   launch/backup/recovery instructions and explicit external gates.

## Completion rules

Small tested commits are save points, not requests to restart the work. A
package closes only with code, acceptance checks and evidence. Required skips
do not count as passes. Migrations are additive; applied SQL is immutable.
Tests use owned disposable databases, never the existing shared `hms` writer.
The current app stays running until upgrade rehearsal passes.

Evidence identifies candidate commit/content, migration checksums, environment,
image digests and actual results. Separate software completion, working local
delivery and hospital acceptance. Real credentials, clinical approvals,
licensed content, target-network/regional drills and pilots cannot be replaced
with synthetic evidence. Unconfigured external integrations stay disabled.

The final report covers every module and the full OPD, medication, laboratory,
inpatient, stock, finance, exchange, downtime and recovery journeys. Assess
clinical usefulness, UX, security, integrity, performance, operations and SaaS
customer isolation using observed evidence; do not reuse the original baseline
maturity score as a current assessment.
