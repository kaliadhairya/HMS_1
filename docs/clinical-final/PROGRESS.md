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

## Second increment — signed records and exchange

- Added checked TypeScript medication/exchange and consultation command domains.
- Added all six missing primary FHIR resource mappings and prescription/signed
  discharge document exports; unsigned drafts and active-admission discharge
  exports are refused. Linked corrections and immutable signatures are retained.
- Added nursing/care/discharge document types with patient/context FKs and
  expected revisions. Consultation saves now use a row lock and revision;
  finalization creates a digest-bound signature, updates queue/appointment and
  publishes one event in the same transaction. A database guard preserves
  finalized clinical content. Linked amendments remain separate signatures.
- Consultation UI preserves drafts on conflict or lost committed responses,
  offers explicit comparison and reuses the original request during reconcile.
- Prepared Node 24/PostgreSQL 18 artifacts with distinct new volumes and WAL
  archive initialization. CI publishes verification metadata without deploying.
- Owner authorized the Claude/Codex split, recorded at ef97130.

Latest observed checks: consultation notes 7/7 (including real save/sign race
and browser response loss, plus Quick Consult save/sign), clinical exchange 8/8 (three official validator
fixtures, zero errors with offline terminology/narrative warnings), existing
clinical documents 8/8, coded consultation UI 5/5, medication 20/20, laboratory
21/21, existing FHIR 8/8 and frontend build/typecheck. PG16/PG18 fresh/legacy
schemas match through 0112 (4727 facts), including the final-record guards. The initial FHIR run failed because its required released report had
not been prepared; laboratory prerequisites were run and FHIR then passed.
The new exchange fixture initially omitted referenced resources; complete
fixture closure was added and validator checks rerun successfully.

The full original regression has not yet been rerun against this increment.
Older OPD fixtures assume the retired free-text writer/unversioned notes and
need to exercise the governed workflow. A5/B1 are partial packages; shared
observations, full continuity integration and consent/ABDM delivery remain.

## Third increment — recovery artifacts (a59850b)

B6 core now produces encrypted, snapshot-consistent logical exports with
signed manifests and verifies them by restoring into a separate disposable
database. Corrupt artifacts/manifests, unavailable keys and unsafe writer
targets are refused. Physical backups verify their actual backup manifest,
artifact checksums, migration checksums and database invariants during PITR.
The recovery lab uses isolated resources and does not contact integrations.

- Logical backup/restore integration: 7/7 on PostgreSQL 16 and 18.
- Complete physical recovery lab: passed on both engines. Latest evidence:
  `~/hms-verification/clinical-final-b6-20261015-full` and
  `~/hms-verification/clinical-final-b6-pg18-20261015`.
- Local PITR measurements were approximately 0.10 seconds RPO and 2.28
  seconds RTO; these small same-host fixtures do not prove regional recovery
  or production capacity.
- Status is `VERIFIED_DATABASE`, not complete clinical protection. Exact
  private document version verification still depends on A4; B7 target-region
  evidence remains separate. B7 engineering may build on a59850b.

## Fourth increment — facility authority and scoped receipts (584e169)

Migrations 0113–0122 add explicit clinical facilities, initial single-hospital
ownership backfills, UUID identity mappings, memberships, professional roles
and independently governed action privileges. Session state binds the facility;
caller headers cannot switch it. Pooled SQL and service dates follow verified
request context. No professional credentials or privileges are manufactured
by the conversion.

Facility-owned tables have row policies and immutable ownership guards.
Production refuses a runtime identity that owns clinical tables, can assume
their owner, bypasses RLS or can create schemas. Audit change capture uses a
fixed-path trigger authority, so the runtime needs no direct row-audit grants.
Professional privileges check current credentials/membership and retain row
locks during commands. Role/privilege approval and revocation carry reasons,
expected revisions, transactional audit and authorization-change outbox events.
Administrator screens record verification references and reasons, distinguish
professional roles from clinical actions, and retain uncertain requests for
reconciliation.

Command receipt version 2 binds facility and the reviewed If-Match value.
Historical hashes remain intact. Old receipts lacking revision evidence are
held for explicit reconciliation; cross-facility/cross-actor receipt reads are
blocked by database policy.

Latest observed checks on the private stack:

| Check | Result |
|---|---|
| Real facility/credential/grant policy integration, PostgreSQL 16 | 19/19 |
| Same integration, PostgreSQL 18 | 19/19 |
| Facility session HTTP scope and revocation | 5/5 |
| Administrator credential/privilege browser flow | 4/4 |
| Scoped receipt HTTP replay and revision/legacy conflicts | 4/4 |
| Financial idempotency, concurrent duplicate and crash reconciliation | 8/8 |
| Previously skipped Phase 1 transaction/failure suite on PostgreSQL 18 | 16/16 |
| Backend aggregate before the final receipt-policy assertion | 52 passed, 2 skipped; the new assertion passed in both focused runs |
| Type check and frontend production build | Passed |

The original schema fingerprint matched 5,336 facts through 0121 on both
engines. This is structural evidence, not the final fresh/legacy release
verification required by C4. The first browser run failed on labeling and an
assumed display name; both were corrected and the real flow rerun 4/4. The
first grant test exposed millisecond truncation of Date objects, which was
fixed before its successful rerun.

A2/A3 remain IN_PROGRESS. Remaining integration includes complete ownership
coverage for financial/device/lab approval children, all clinical action gates,
facility switching/configuration, approved machine identities and explicit
worker contexts, production runtime role provisioning, v2 UUID adapters and
full clinical regression with explicit synthetic approvals. RLS is not a claim
that every old route/worker has finished its integration. Local tests use the
disposable databases and do not establish hospital approvals or a deployment.
