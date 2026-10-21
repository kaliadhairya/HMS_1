# Phase 6: interoperability and operations

Branch `phase6/interop-ops` (worktree `../HMS_1-phase6`), based on the
combined Phase 4 + 5 branch `integration/phase4-phase5` (0a90745).
Migrations 0090–0095. **Not merged and not deployed.** Plan: `PLAN.md`.

## What changed, in plain terms

| Part | What it does now |
|---|---|
| **6A Code lists** | ICD-10, SNOMED CT, LOINC and UCUM releases are loaded from the licensed files (with source, licence acceptance and checksum) and never edited; one release per system is active. A local code maps to a standard one only after a second person approves. A diagnosis keeps the ICD-10 release it was coded with; older ones are marked "edition unknown". |
| **6B FHIR** | Read-only FHIR R4 at `/api/fhir` on the ABDM guide (ndhm.in 6.5.0): patients, practitioners, the hospital, visits and admissions, diagnoses, allergies, vital signs, released lab results and reports, specimens. Same sign-in, roles and care-team limits as the app; every read is audited with its purpose. No FHIR writes. |
| **6C ABHA (M1)** | Front desk verifies or creates an ABHA through ABDM with the patient's OTP. Login IDs, Aadhaar numbers and OTPs are encrypted for ABDM and never stored. The ABHA is attached only if ABDM's name, sex and year of birth agree with the chart; otherwise, or if it is on another chart, it waits on the worklist. Profiles shared from the patient's ABHA app at the counter wait for staff to choose the chart. Identifiers now record whether staff or ABDM verified them; only ABDM-verified ABHAs are used with ABDM and FHIR. |
| **6D Sharing (M2)** | Finished visits become care contexts and are linked to the ABHA (by staff with a link token, or by the patient with an OTP the hospital sends). ABDM discovery finds a patient only by an ABDM-verified ABHA, never by name. A request for records is checked against the consent when it arrives and again just before the encrypted records leave: status, expiry, dates, visits and record types. Records go out as ABDM document bundles (consultation note, lab report); each document sent is recorded. |
| **6E Requesting (M3)** | Doctors ask for records from other facilities with the patient's consent. What arrives is shown as outside information for review; it never becomes a local order or allergy by itself. When the consent is revoked or expires, the records are withdrawn and erased. |
| **6F Devices** | Analyzers and other devices connect under an approved, versioned contract (drafted by one person, approved by another) that names the interface manual and maps device test codes to catalogue tests. HL7 v2 over HTTP or MLLP, and ASTM. Every message is kept as received and accepted once; analyzer results go to the Phase 4 analyzer contract and stay provisional until technical review. Unmapped codes, unknown specimens or a different patient are held on the worklist, never guessed. Other device kinds are received and kept for a person to act on. |
| **6G Backups** | Continuous WAL archiving (in `docker-compose.yml`, takes effect at the next approved deployment), base backups, and a point-in-time restore drill that checks the restored database (migrations, audit chains, journal balance) and reports RPO/RTO. A recovery lab proves exact-moment restore and standby takeover. |
| **6H Audit storage** | Each signed audit checkpoint is copied to write-once storage (S3 Object Lock) and counts only when the store confirms the lock. A periodic check reports forged, changed, missing or late checkpoints. |
| **6I Downtime** | An encrypted, printable emergency summary of every admitted patient (identifiers, location, allergy status, active medicines and doses due, problems, open critical results) is refreshed every 15 minutes for wards to keep; it opens without the app and says STALE when old. Paper records made during a downtime are logged with their actual time, entered afterwards, and checked by a second person before the downtime can close. |
| **Worklist** | One accountable worklist for everything the system could not finish by itself (failed or unmatched messages, audit storage problems, ABHA mismatches, outside records to review, downtime reconciliation), each with an owner, closed only with a note. |
| **Message log** | One log of messages to and from outside systems: outgoing ones retry with growing waits and end on the worklist if they keep failing; incoming ones are kept as received and accepted once. |

Screens: Terminology, Worklist, ABDM (front desk), Outside records (doctors),
Device interfaces, Downtime.

## How it was verified

On 2026-10-14, on a fresh copy of the newest Docker backup
(`~/hms-backups/20261013-150841`) migrated with this branch, in the test
database `hms_p4_p5_p6_e2e` (the Phase 4 and 4/5 suites accept only
`hms_p4_*` names), API 5052, Vite 5224, a throwaway MinIO in Object Lock
mode and the local ABDM mock gateway:

- `verify-migrations.sh`: PASS, fresh and upgraded schemas identical (4,681 facts).
- Backend unit tests 15/15 (including the HL7/ASTM parsers); frontend build passes.
- Original Phase 1 failure suite 16/16.
- Every end-to-end suite in one run, 39 checks in total, all passing:
  laboratory 21/21, laboratoryGuards 8/8, laboratoryWorker 3/3,
  medication 20/20, medicationGuards 9/9, medicationFrontend 6/6,
  laboratoryFrontend 6/6, pharmacy 18/18, opd 20/20, lab 10/10, ipd 13/13,
  admin 28/28, authorization 5/5, sessions 7/7, idempotency 8/8,
  durability 11/11, frontendReliability 2/2, ipdDrafts 3/3,
  patientIdentity 9/9, patientMerge 8/8, practitioners 8/8, scheduling 6/6,
  careTeam 10/10, triage 7/7, clinicalDocuments 8/8, adt 8/8, referrals 8/8,
  finance 15/15, phase45 8/8, and the Phase 6 suites:
  **terminology 10/10, fhir 8/8, auditWorm 5/5, abdm 10/10, devices 7/7,
  downtime 4/4**, then audit 7/7.
- FHIR output and the ABDM documents validated with the official HL7
  validator 6.10.4 against ndhm.in 6.5.0: **0 errors** (tooling in
  `~/hms-tools/fhir`).
- Recovery lab (`scripts/verify-recovery.sh`): restore to just after marker
  25 of 40 kept exactly markers 1–25 (RPO 0.1 s, restore 1.4 s; audit chains
  and journal intact); standby takeover after killing the primary mid-write
  lost 0 acknowledged writes, app ready 1.1 s later. Small lab database and a
  scripted switch-over: real timings will be longer.
- New screens (ABDM, Outside records, Device interfaces, Downtime, Worklist,
  Terminology) at 1440 px and 390 px: no script errors, no page overflow.

Evidence: `~/hms-verification/phase6-final-20261014T084459Z` and
`~/hms-verification/phase6-recovery-*`.

Test infrastructure the suites need: `backend/scripts/abdm-mock-gateway.js`
(ABDM stand-in), an S3-compatible bucket with Object Lock (`AUDIT_WORM_*`),
`DOWNTIME_KIT_DIR`/`DOWNTIME_KIT_KEY`, `DEVICE_MLLP=on`.

## What is not done, and why (owner decisions)

| Item | Status |
|---|---|
| **ABDM sandbox** | Built and tested end to end against a local mock gateway. ABDM's exact URL paths, payloads and the record-encryption key format must be confirmed in the ABDM sandbox once the hospital is registered (plan O1). Until then ABDM is off. |
| **SNOMED CT / LOINC / ICD-10 content** | No codes are loaded. The hospital chooses the ICD-10 edition and accepts the SNOMED and LOINC licences (O2–O4). |
| **SMS provider** | Patient-initiated linking sends the OTP through an SMS provider (`SMS_PROVIDER_URL`); none is configured, so those messages fail onto the worklist. |
| **Real devices** | The framework is in place; no device is configured. Each needs its manual and code map (O5). |
| **Regional failover** | Proven only as a standby takeover on one machine. A second region needs the hosting decision (O6). |
| **Write-once storage** | Tested with a local MinIO in Object Lock mode. Production needs a bucket owned by someone other than the database administrator (O7). |
| **Downtime kit distribution** | The kit is written on the server; copying it to ward machines (and the kit key) is an operational step. |
| **Encryption key for stored secrets** | `utils/encryption.js` falls back to a development key when `ENCRYPTION_KEY` is unset (pre-existing). Set it before go-live. |
