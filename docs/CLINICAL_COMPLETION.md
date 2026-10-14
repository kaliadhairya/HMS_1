# HMS clinical completion: three final phases

Source of requirements: `~/Desktop/HMS_1_Clinical_Architecture_Blueprint.md`,
especially sections 1.4 and 3–5, plus the repository's clinical phase prompts.
Baseline: `c9940c82c40e75a5d3a9e803ea3842b40e125e62`.
Branch: `completion/clinical-final`; worktree: `../HMS_1-clinical-final`.

The owner initially authorized solo completion, then approved a split:
Claude owns A4/A7/A8/B2/B7/C2/C3/C6; Codex owns the other 16 packages.
Coordination: `docs/requests/clinical-final-coordination.md`. Mission Control is a separate product and is excluded. These
three completion phases close clinical Phases 0–7; they do not add a Phase 8.
Live deployment and hospital pilots retain the previously agreed approval
boundary. Clinical approvals, licensed content, device manuals, external
registration and target-environment evidence must be real; missing inputs
remain visible blockers and are never replaced with synthetic approval.

There are 24 delivery packages below. They are work groups, not equal-sized
units or a percentage estimate. A package is complete only when its code,
relevant acceptance checks and evidence are present. Engineering completion
and hospital go-live acceptance are recorded separately.

## Final phase A — close clinical workflows and foundations

| ID | Remaining work | Completion evidence | State |
|---|---|---|---|
| A1 | Trace blueprint requirements to code/tests; standardize Node 24 and PostgreSQL 18 deployment artifacts and CI; preserve PostgreSQL 16 upgrade verification | Versioned inventory, reproducible builds and controlled migration jobs | IN_PROGRESS |
| A2 | Add clinical facility identity/ownership, membership and scoped privileges; strengthen practitioner verification; preserve UUID/legacy identity mappings without demographic guessing | Cross-facility denial, expired/unverified credential tests, validated additive backfill | IN_PROGRESS |
| A3 | Introduce TypeScript domain/contracts and documented `/api/v2` adapters; keep one transaction, audit, receipt and outbox boundary; bounded retry and version semantics | Type checks, generated API contracts, compatibility and conflict tests | IN_PROGRESS |
| A4 | Finish private document upload/download, quarantine and integrity metadata; authenticated encryption with key IDs and legacy migration; truthful privacy/retention evidence | Unauthorized access, malicious upload, key rotation/decryption and legal-hold checks | OPEN |
| A5 | Complete shared observations, nursing assessments/care plans and signed discharge continuity; preserve historical records and accountable outstanding tasks | Observation/signature/amendment and discharge/handover acceptance | IN_PROGRESS |
| A6 | Connect Quick Consult and consultation to coded medicines and laboratory ordering; remove unsafe legacy writers; complete navigation, stable keys and hospital-date handling | Browser workflow, stable identities, preserved drafts, midnight/expiry tests | IN_PROGRESS |
| A7 | Close source-linked returns/credits, pricing approval and stock/financial reconciliation gaps; retain the documented manual payment path | Inventory and balanced financial invariants, replay and approval-separation tests | OPEN |
| A8 | Scope sockets/events to authorized facility/patient/worklists; complete event metadata, inbox deduplication and worker isolation | Wrong-scope subscriptions, revocation, replay, ordering and crash tests | OPEN |

Exit: clinical paths use governed identities and commands; unauthorized scope
and unsafe legacy mutation paths are rejected; existing workflows and the new
acceptance checks pass. Missing clinical content is explicitly unavailable.

## Final phase B — finish exchange, integrity and recovery

| ID | Remaining work | Completion evidence | State |
|---|---|---|---|
| B1 | Finish the 15 planned FHIR resource types and four document exports; preserve consent/provenance and current security scope | Capability coverage, profile validation, prescription/discharge exports | IN_PROGRESS |
| B2 | Complete terminology and ABDM contract/configuration validation, consent-at-use and imported-record reconciliation; licensed content and sandbox remain genuine external gates | Mock/failure tests plus separately recorded real exchange/content evidence | OPEN |
| B3 | Repair held-result acknowledgment, multigroup result IDs and analyzer actor propagation; validate transport lifecycle and message limits | Real PostgreSQL adapter-contract tests and error/replay fixtures; 92765a8, DEVICES.md | DONE (ENGINEERING) |
| B4 | Finish versioned departmental/device contract handling, identity/retry/owner queues and external-effect suppression; do not invent specialized clinical safety rules | Contract, duplicate, wrong-patient, failed-message and restore-isolation tests | IN_PROGRESS |
| B5 | Repair empty/incomplete remote checkpoint acceptance; verify complete chain manifests, pinned object versions, checksums and retention; preserve historical audit proofs | Tamper, missing-chain/checkpoint, version and retention negative tests | IN_PROGRESS |
| B6 | Repair WAL retry/permissions and restore evidence; verify actual logical/PITR artifacts, schema checksums, journals, stock, clinical links and documents | Corruption tests and isolated restores; unknown measurements cannot pass | IN_PROGRESS |
| B7 | Complete regional recovery tooling, old-writer fencing, session/security and delivered-effect reconciliation; supply HMS deployment/protection configuration | Local drills plus separately recorded target-region RPO/RTO and fencing evidence | OPEN |
| B8 | Replace destructive deployment with readiness/draining/compatible releases; supervise workers and expose measured operational health and backlog | Failed-readiness rollback, maintenance, migration and stale-evidence tests | OPEN |

Exit: implemented interfaces match the declared contracts; no silent success
for held results, missing checkpoints or unmeasured recovery. Test restores
cannot contact production integrations. Regional protection is claimed only
when real regional evidence exists.

## Final phase C — prove the release and finish readiness

| ID | Remaining work | Completion evidence | State |
|---|---|---|---|
| C1 | Cover every blueprint 5.3 acceptance category, including 50 concurrent same-bed/slot requests and transactional races, on real PostgreSQL | Requirement/scenario matrix and passing negative/concurrency tests | IN_PROGRESS |
| C2 | Finish shared query/cache, draft/failure recovery, keyboard access, accessible alerts and multilingual printing across clinical journeys | Browser/print artifacts and complete patient-to-department rehearsals | OPEN |
| C3 | Validate the stated 200-bed/1,000-visit/200-user envelope and latency/freshness targets with a repeatable workload | Measured distributions, failure/backlog observations and explicit environment limits | OPEN |
| C4 | Run fresh/upgrade PG16/18 migrations, full regression, type checks and builds against the exact final candidate | Commit-bound evidence, schema equality and invariant checks | OPEN |
| C5 | Complete/test the hazard register and evidence checker; bind each hazard to control, test, procedure and accountable role | Fail-closed checker tests and named, reviewed evidence when supplied | OPEN |
| C6 | Finish downtime distribution/reconciliation, incident/support procedures and staff rehearsal material | Offline/stale/return-to-service drills and owner-reviewed operational procedures | OPEN |
| C7 | Prepare OPD → ward → expansion gates, approved clinical configuration and supervised observation | Stage-specific acceptance; no automated clinical authorization or invented approvals | OPEN |
| C8 | Consolidate the reviewed clinical branch and issue a truthful completion/handoff report listing external blockers | Clean branch, final evidence index, compatibility/rollback instructions | OPEN |

Exit: all software checks pass on an identified release, and every remaining
external/hospital gate has an explicit owner and required evidence. Actual
clinical rollout is complete only after the hospital supplies approvals,
training, target-environment validation and successful monitored pilots.

## Execution and compatibility rules

- Work only in your assigned completion worktree. Preserve existing source branches
  and the unfinished Phase 7 originals. Claude uses its separate worktree,
  migrations 0150–0169 and ports 5074/5246/15574; B7 waits for B6-ready.
  Codex started with A6 and B3/B5/B6 because
  their defects have direct reproductions; perform dependent backfills before
  enforcing new scope constraints.
- Apply new numbered migrations only; reserve 0110–0149 here and never edit
  already applied migrations. Add ownership/FK/index/check/audit coverage.
- Backfill existing single-hospital records into the initial configured
  facility. Ambiguous identity, credential, catalogue and price decisions go
  to reviewed worklists; approved clinical values are not fabricated.
- New domain code uses TypeScript; legacy JavaScript remains through explicit
  adapters. V2 UUID identities map to retained legacy identifiers. Existing
  APIs call the same command services or expose labelled historical reads.
- Keep signatures, audit and stock/financial history immutable. Use linked
  corrections, exact decimal calculations and resumable migrations.
- Test only disposable `hms_p4_final_*` / `hms_verify_final_*` databases.
  API 5064, Vite 5236, second API 15544; separate PG18 uses 55464.
  Never migrate, seed or tamper with the shared database named `hms`.
- Evidence records candidate commit, migration checksums, environment and
  observed results. Redact secrets and patient payloads. Local/mocked evidence
  is not labelled as production, real-device or regional validation.
- No new payment provider, commercial tenant quotas, SaaS subscriptions,
  customer provisioning, warm slots or Mission Control frontend is introduced.

## Initial verified evidence and blockers

- The saved gap-fix report has 43 checks with exit 0, but its header names
  `468bd5e`, not this baseline; C4 must produce final-candidate evidence.
- B1 currently supports 9/15 planned primary FHIR resource types and 2/4
  document exporters.
- Scheduling currently races 20 requests; C1 requires at least 50 plus beds.
- Source-level controlled-dependency reproductions confirm five issues:
  P6-R01 held result marked processed; P6-R02 OBR/OBX identity collision;
  P6-R04 empty remote audit store accepted; P6-R05 incomplete manifest
  accepted; P6-R07 identical WAL retry fails. Reproductions are not live
  database/S3 acceptance; B3/B5/B6 require integration coverage.
- The Phase 7 originals are drafts with an empty assessment template. Their
  blocked result does not mean every clinical test failed; it means the
  required reviewed hospital evidence has not been supplied there.
