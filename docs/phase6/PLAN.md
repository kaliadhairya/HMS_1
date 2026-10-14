# Phase 6 plan: interoperability and operations

Blueprint sections 3.11, 3.12 (audit storage), 3.13 (resilience) and the
Phase 6 row of 5.1. Brief: `docs/NEXT_PHASES_PROMPT.md`, "Phase 6".

**Status (2026-10-14): all nine work packages built and verified; see
README.md for results and what still needs the owner.** Building started from the
combined Phase 4 + Phase 5 branch (`integration/phase4-phase5`); Phase 6
is rebased onto it. Branch `phase6/interop-ops`, worktree `../HMS_1-phase6`.

## Exit criteria (blueprint 5.1)

1. Profile validation and exchange tests pass.
2. Consent revocation is enforced.
3. Restore and failover targets (RPO ≤ 5 min, RTO ≤ 60 min) are demonstrated
   by drills.
4. Every message the system could not process sits on a worklist with a named
   owner.

## What exists today

| Area | Today | Gap |
|---|---|---|
| ABHA | `hms_patient_identifiers` accepts ABHA number/address typed by staff; 14-digit format check only | No verification with ABDM. The blueprint says "an ABHA field alone is not integration" |
| FHIR | Nothing | No FHIR endpoint, capability statement or profile validation |
| ICD-10 | `backend/data/icd10-common.json`: **21 hand-picked codes**, no edition, searched in memory | No edition, no release record, no history of which edition a diagnosis used |
| SNOMED / LOINC | Phase 3 products and Phase 4 lab catalogue already store `code_system` + `code` | No releases loaded, no licence, no mapping review |
| Units | Phase 4 has approved unit conversions for lab results | Not a shared coded-unit list (UCUM) |
| Incoming messages | `utils/inbox.js` (dedupe by source + message ID); Phase 4 analyzer contract v1 with unmatched-message reconciliation | Only the lab analyzer, and only one push-style contract. No acknowledgement/retry policy, no general worklist |
| Outgoing events | `utils/outbox.js` (delivered at least once) | Nothing sends to an outside system yet |
| Backups | `scripts/backup-db.sh` (nightly-style full dump) + `restore-check.sh` | A dump loses everything since it ran. RPO 5 min needs continuous WAL archiving. No standby, no drill evidence |
| Audit checkpoints | Signed every minute into `AUDIT_CHECKPOINT_DIR` (a folder on the same server) | A database administrator can delete them. Need write-once storage under separate control, and a check that notices a missing one |
| Downtime | Nothing | No read-only summaries, paper procedures or reconciliation afterwards |

## What we need from the owner (outside the code)

These block parts of the work. The code can be built and tested against
local stand-ins, but **an exchange with ABDM or a real device is not
"working" until it has run against the real thing.**

| # | Needed | Blocks | Notes |
|---|---|---|---|
| O1 | ABDM sandbox registration for the hospital (client ID and secret, facility in the Health Facility Registry, HIP and HIU IDs) | 6C–6E against the real sandbox | Registration is done by the hospital, not by us. Until then we test against a local mock gateway |
| O2 | SNOMED CT licence and India release (through NRCeS, the national release centre) | Loading SNOMED | Free in India for registered users, but still needs the licence agreement. Do not download it on the hospital's behalf |
| O3 | LOINC account and acceptance of the LOINC licence | Loading LOINC | Free, but terms must be accepted by a named person |
| O4 | Which ICD-10 edition to use for reporting (for example WHO ICD-10 2019) and who maintains it | 6A | The code cannot choose the edition |
| O5 | List of analyzers, imaging (PACS), blood bank, theatre and bedside devices actually in use, with make, model and interface manual | 6F adapters | Each device has its own protocol (ASTM, HL7 v2, DICOM). No adapter is written without the real manual |
| O6 | Hosting decision: AWS Mumbai (as the blueprint proposes) or the hospital's own server | 6G regional failover | Regional failover needs a second region; locally we can only rehearse a standby takeover |
| O7 | Write-once storage for audit checkpoints, owned by someone other than the database administrator (for example an S3 bucket with Object Lock in a separate account) | 6H in production | Locally we test with MinIO in Object Lock mode |
| O8 | Named owners: privacy/security lead (consent, exports), engineering/operations lead (backups, drills), and someone to own each worklist | Exit criterion 4 | Blueprint 5.4 |

## Work packages

Phase 6 migrations use `0090`–`0119`. Test databases `hms_p6_*`, API 5052,
Vite 5224 (5042/5214 are taken by the Phase 4+5 integration).

### 6A. Terminology releases (first, others depend on it)

- Tables for code systems and **releases** (system, edition/version, date,
  licence note, who loaded it, file checksum) and their concepts. Loading a
  release is an import job, not a migration, and never overwrites an older
  release.
- Every coded value stores system + code + release + display, and keeps the
  clinician's original text. Old records keep the release they were coded
  with.
- Local-to-standard **mappings** (for example a local lab test to LOINC)
  are proposed, reviewed and approved by a named person. Unreviewed mappings
  are not used in exchange.
- ICD-10: replace the 21-code JSON with a loaded edition (O4); search moves to
  the database. Existing diagnoses are tagged "edition unknown (legacy)", not
  guessed.
- Coded units: UCUM unit list; Phase 4 lab units are mapped, not rewritten.
- Screens: releases, mapping review queue.

### 6B. FHIR R4 boundary (read and export first)

- `GET /fhir/metadata` capability statement: lists exactly what is supported.
- Read and search for Patient, Practitioner/PractitionerRole, Organization,
  Location, Encounter, Condition, Observation (vitals and released lab
  results), AllergyIntolerance, MedicationRequest/Dispense/Administration,
  ServiceRequest, Specimen, DiagnosticReport. Built from the domain tables;
  FHIR is only how data is shown to outside systems.
- Signed documents (visit summary, discharge summary, prescription, lab
  report) as a document Bundle with a Composition, following the ABDM
  profiles (IG 6.5.0).
- **No generic FHIR writes.** Anything coming in goes through the same
  commands and checks as the screens (or into reconciliation, see 6E).
- Same login, care-team scope and audit as the rest of the app; every FHIR
  read or export is an audited access with a purpose.
- **Profile validation:** run the official HL7 FHIR validator (Java, already
  available on this machine) with the ABDM IG package against every resource
  type and document we produce. It runs in the test suite; a profile error
  fails the build.

### 6C. ABDM M1: ABHA

- Create and verify ABHA through ABDM (Aadhaar or mobile OTP flows as the
  current ABDM APIs define them) and link the verified ABHA to the patient.
- A verified ABHA is stored as a **verified** identifier with when and how it
  was verified; staff-typed ABHAs stay "unverified" until checked.
- Scan-and-share at registration (patient shares their profile by QR).
- No automatic chart merge on ABHA match. A match against a different local
  patient goes to the Phase 2 duplicate review.

### 6D. ABDM M2: the hospital shares records (HIP)

- **Care contexts**: each visit or admission becomes a care context linked to
  the patient's ABHA, with the link status kept.
- Respond to discovery and link requests from the ABDM gateway.
- When a valid consent arrives, export the matching documents (6B) encrypted
  as ABDM requires, and record exactly what was sent, to whom, under which
  consent.
- All calls to and from the gateway go through the outbox/inbox: retried
  safely, deduplicated, and every failure lands on a worklist.

### 6E. ABDM M3: the hospital requests records (HIU) + consent

- Staff request records from other hospitals with a purpose, date range and
  record types; the patient approves in their ABHA app.
- **Consent is enforced on every read and export**, not just when it is
  granted: purpose, scope, validity dates and revocation are checked at the
  moment of use. A revoked or expired consent stops further exports and hides
  imported data that depended on it, where the rules require.
- Imported data is shown as **outside information** with its source. An
  imported medicine or allergy never becomes an active local order or allergy
  by itself; a clinician reconciles it (accept, reject, or mark as seen).

### 6F. Device and departmental adapters

- Generalise Phase 4's analyzer contract into one adapter framework:
  - versioned contract per device type;
  - raw message kept exactly as received;
  - deduplication by (source, message ID) through `utils/inbox.js`;
  - acknowledgement and retry rules per contract;
  - patient/specimen/order matching, with **no guessing**: anything
    unmatched or ambiguous goes to a reconciliation worklist with an owner.
- Protocol layers: ASTM E1394 / LIS2 and HL7 v2 (lab analyzers), DICOM
  worklist and HL7 v2 (PACS), plus blood bank, theatre and bedside devices,
  **only for the devices listed in O5**.
- The Phase 4 analyzer endpoint keeps working; it becomes one contract inside
  the framework. Claude builds it; Codex (who wrote the Phase 4 analyzer
  contract) reviews compatibility before merge.
- The blueprint is explicit: a basic interface does not replace the safety
  functions of a real PACS, blood bank or theatre system.

### 6G. Backups, restore and failover

- **Point-in-time restore:** turn on continuous WAL archiving (PostgreSQL
  `archive_mode` with a tool such as pgBackRest or WAL-G) plus regular base
  backups. Target: lose at most 5 minutes of data.
- **Drills, written down with real timings:**
  - restore to a chosen minute into a throwaway database, then check the row
    counts, audit chains and journal balance;
  - standby takeover: a streaming standby is promoted and the app reconnects.
    Measure the data lost and the time to recover against RPO ≤ 5 min and
    RTO ≤ 60 min.
- **Regional failover** is only possible once O6 is decided. Until then it is
  reported as "not demonstrated", not as passed.
- Health page and alerts: last archived WAL, standby lag, last base backup,
  last successful drill.
- `restore-check.sh` stays for the nightly dump.

### 6H. Write-once audit checkpoints

- Ship each signed checkpoint to write-once storage (S3 Object Lock in
  compliance mode, or MinIO in Object Lock mode for tests) with credentials
  that can add files but not delete or change them.
- The local folder stays as a buffer; shipping is retried via the outbox
  until confirmed.
- `audit-verify.js` gains three checks: every minute has a checkpoint in the
  remote store, every checkpoint signature is valid, and the chain heads in
  the database match the checkpoints. A gap or mismatch becomes an exception
  with an owner (same exceptions list as Phase 5 reconciliation, or a new one).

### 6I. Downtime kit

- A read-only emergency summary per admitted patient (identifiers, allergies
  and allergy-review state, active medicines and due doses, active problems,
  latest critical results), encrypted, printable, with a clear "as of" time.
  It refreshes on a schedule; a stale summary says so in large print.
- Paper procedures: ordering, medicine administration record, specimen
  labels, receipts, plus pre-printed identifier stock.
- Recovery worklist: orders, doses given, specimens, receipts and temporary
  IDs created on paper are entered back with their **actual** times, then
  reconciled. Nothing from downtime is silently dropped.
- It is **not** a second database that staff can write to.

## Acceptance tests (blueprint 5.3)

| Test | Proves |
|---|---|
| Every produced resource and document passes the HL7 validator with the ABDM IG | Profiles |
| Discovery → link → consent → export against the mock gateway; same flow against the real sandbox once O1 exists | Exchange |
| Revoke a consent, then export again: refused; expired consent the same | Consent revocation |
| Imported medicine/allergy is not active until a clinician accepts it | Import safety |
| Same device message twice; same ID with different content; messages out of order; unknown patient or specimen | Adapter dedupe and worklists |
| Gateway or device down: retries, then a worklist item with an owner | Failed downstream service |
| Restore to a chosen minute; data loss ≤ 5 min, time recorded | PITR |
| Standby takeover; RPO/RTO measured | Failover (local) |
| Delete or change a remote checkpoint, or skip a minute: the check reports it | Missing checkpoint |
| Downtime summary older than its refresh window is marked stale; paper-era entries reconcile | Downtime |
| Unauthorised FHIR read or export, wrong patient, no consent: refused and audited | Authorization |

Every existing suite plus `verify-migrations.sh` must still pass.

## Order of work

1. 6A terminology (everything else codes through it).
2. 6B FHIR read/export + validator in tests. 6G backups and 6H audit storage
   run in parallel: they touch no clinical code.
3. 6C ABHA → 6D HIP → 6E HIU and consent, against the mock gateway.
4. 6F adapters, as device manuals arrive (O5).
5. 6I downtime kit last (it reads from everything above).
6. Real ABDM sandbox runs and the regional drill when O1 and O6 are ready.

## Ownership (proposal, needs the owner's OK)

| Package | Suggested owner | Why |
|---|---|---|
| 6A, 6B, 6C, 6D, 6E | Claude | Patient identity (Phase 2) is Claude's; FHIR reads every domain |
| 6F adapters | Claude (agreed 2026-10-14) | Codex reviews compatibility with its Phase 4 analyzer contract |
| 6G, 6H, 6I | Claude, or split with Codex if both are free | No clinical file overlap |

Codex works on Phase 7 (hazard log, acceptance checks, training and
rollout gates) in its own worktree. Same rules as before: separate worktree
per agent, own migration numbers (Claude `0090`–`0109`, Codex `0110`–`0119`
only if needed), requests in
`docs/requests/`, STOP notice in AGENTS.md while building.

## Not in Phase 6

- The controlled rollout, training and hazard log (Phase 7).
- FHIR R5 (only if a real partner needs it, as a separate adapter).
- Writing payer rules or clinical content (still owner-approved
  configuration).
- Deploying anything to the shared Docker app without the owner's approval
  and a backup first.
