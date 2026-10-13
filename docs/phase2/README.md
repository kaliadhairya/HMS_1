# Phase 2: patient journey, identity and ADT

Branch `phase2/patient-journey`, cut from `phase1/integrity-foundation`.
Migrations 0010–0018. See `docs/PARALLEL_WORK.md`.

| Part | Status |
|---|---|
| 1. Patient identity | **Done**, deployed to Docker 13 Oct (see below) |
| 2. Duplicate review and merge | **Done** (see below) |
| 3. Practitioners | **Done** (see below) |
| 4. Scheduling reservations | **Done** (see below), not deployed |
| 5. Encounters, care teams and patient scope | **Done** (see below), not deployed |
| 6. Emergency triage | **Done**, switched off until a protocol is approved (see below), not deployed |
| 7. Versioned, signed clinical documents | **Done** (see below), not deployed |
| 8. Bed occupancy, transfers and discharge planning | **Done** (see below), not deployed |
| 9. Referrals and acknowledged handoffs | **Done** (see below), not deployed |

## Part 1: patient identity (`0010_patient_identity.sql`, `routes/patientIdentity.js`)

### Identity status

- `hms_patients.identity_status` is `registered`, `temporary` or `merged`.
- `birth_date_estimated` records that a birth date is an estimate.
- Ages 0–130 are enforced by the database. The gender `Unknown` is allowed.

### Unknown or unconscious arrivals

- `POST /api/patients/hms/temporary` registers a temporary identity. It needs
  only an estimated age: no name, phone or payment. The patient gets a UHID
  and a `TEMPORARY` identifier.
- `POST /api/patients/hms/:id/confirm-identity` records the real details. It
  keeps the record and UHID and retires the temporary identifier (the
  identifier is kept, not deleted).

### Newborns

- `POST /api/patients/hms/newborn` registers the baby at age 0 and links the
  mother as guardian and emergency contact.
- Ordinary registration (both the HMS and the legacy paths) no longer rejects
  age 0. The check had treated 0 as "missing".

### Identifiers (`hms_patient_identifiers`)

- Supported systems: UHID, ABHA number or address, temporary, external record
  number, employee number and passport. Each identifier records its issuer,
  verification state and validity period.
- A verified, current identifier is unique within its issuer (a partial
  unique index).
- Verification is limited to front desk and administrators. An identifier
  already verified for another patient is refused, with a "review as possible
  duplicates" message; it is never merged.
- Retiring needs a reason and keeps the history. The UHID cannot be retired.
- A trigger records every new patient's UHID as a verified identifier, so
  every registration path is covered.

### Related persons (`hms_related_persons`)

- Guardians, emergency contacts and a newborn's mother (linked by patient ID),
  with validity periods. Ending a relationship keeps its history.

### Backfill

- Every UHID becomes a verified identifier.
- Employee numbers are recorded as unverified identifiers.
- Emergency contacts become related persons.
- The old columns stay (expand only).

### Screens

- **New patient** offers General, **Unknown / emergency patient** and
  **Newborn**.
- The **patient profile** has an **Identity and contacts** tab, and a
  **Temporary identity** banner with a Confirm form.

### Verification (part 1)

- `e2e/patientIdentity.e2e.js` passes 9/9:
  - backfill completeness;
  - a temporary registration without a name, phone or payment;
  - role refusal;
  - confirmation keeping the UHID;
  - a newborn at age 0 linked to the mother, with a male "mother" refused;
  - age-0 registration through the ordinary path;
  - identifier validation, verification roles and the duplicate refusal;
  - two people verifying the same ABHA at once: exactly one succeeds;
  - retirement history and related persons;
  - a browser walkthrough of the new screens.
- On a copy of the local database (100 patients), the backfill created 100
  UHID identifiers, 53 employee numbers and 100 contacts.
- `verify-migrations.sh` passes, including audit-trigger coverage.
- Full regression passes, apart from the two known IPD-billing steps:

| Suite | Result |
|---|---|
| OPD | 20/20 |
| Pharmacy | 18/18 |
| Lab | 10/10 |
| Admin | 28/28 |
| Authorization | 5/5 |
| Sessions | 7/7 |
| Audit | 7/7 |
| Idempotency | 8/8 |
| Durability | 11/11 |
| Frontend reliability | 2/2 |
| IPD drafts | 2/2 |
| Patient identity | 9/9 |

## Part 2: duplicate review and reversible merge (`0011_patient_merge.sql`, `routes/patientMerge.js`)

Blueprint 3.3 requires reviewed, reversible merges and never an automatic
union of charts on matching names or phones.

### Candidate detection

`find_duplicate_candidates()` proposes pairs, with evidence, when any of
these hold:

- the same non-UHID identifier (ABHA, external number, passport…);
- the same phone **and** a similar name (trigram similarity ≥ 0.6);
- the same date of birth and a similar name (≥ 0.7);
- a nearly identical name (≥ 0.9) with the same sex and age within a year.

A shared phone alone never qualifies; families share phones. Measured on
real names, family members sharing a surname score 0.36–0.41 and typos
0.77–0.89.

### Proposals

Pairs are proposed:

- when a patient is registered (the response carries `possibleDuplicates`);
- when the same identifier is presented for two patients at verification
  (answered 202: not verified, sent to review);
- by staff report (`POST /api/patients/duplicates`);
- by a scan (`POST /api/patients/duplicates/scan`).

A pair that is open or dismissed is not proposed again.

### Decisions

- Front desk and admins review and mark pairs as different people, with a
  reason.
- **Only admins merge or unmerge**, and both need a reason.

### Merge (`merge_patients`)

- The merge locks both patients. It is refused if both have an active
  admission.
- It finds every foreign key that references `hms_patients`, including tables
  added later, and moves those rows to the kept patient, recording each move.
- An identifier the kept patient already holds is retired on the duplicate,
  not duplicated.
- A relationship between the two patients is ended.
- The duplicate becomes `identity_status = 'merged'` with
  `merged_into_patient_id`. It is never deleted, and its old UHID identifier
  moves to the kept patient, so the old number still finds the record.

### Unmerge (`unmerge_patients`)

- Unmerge reverses exactly the recorded moves and restores the duplicate's
  previous status (`registered` or `temporary`).
- Rows added to the kept patient after the merge stay with it.

### Search and profiles

- Merged records are excluded from patient search and the command palette.
- A merged record's profile shows where it went.

### Screens

- **Patients → Possible duplicates**, for super admin, admin and front desk.
  Tabs: To review, Merged, Different people, Unmerged.
- Each case shows the evidence and both records side by side (UHID, sex and
  age, date of birth, phone, visits, admission), with Different people,
  Keep <UHID> (admins) and Undo merge (admins).

### Verification (part 2)

- `e2e/patientMerge.e2e.js` passes 8/8, also on a database that earlier runs
  had already used:
  - a duplicate registration is proposed, while a family member on the same
    phone is not paired;
  - nurses cannot see the queue and front desk cannot merge;
  - a merge moves the records, keeps the old UHID pointing to the kept
    patient, hides the duplicate from search and points its profile to the
    kept patient;
  - unmerge returns the records and cannot run twice;
  - a dismissed pair stays out of the queue after a rescan;
  - a merge is refused while both patients are admitted;
  - a verification clash returns 202 and opens a case;
  - a browser walkthrough of merge and undo.
- Hand check on a copy of the local data (100 patients):
  - a planted typo duplicate was found, while a family member on the same
    phone was not;
  - the merge moved the duplicate's records and the undo restored every
    count exactly.

## Part 3: practitioners and registrations (`0012_practitioners.sql`, `routes/practitioners.js`, `utils/practitioners.js`)

Blueprint 3.3: a practitioner is separate from the login. A login is
`hms_users.id`; a practitioner is `hms_practitioners.id`. They are never
interchangeable, and the doctor columns still hold the login ID, as settled in
part 2.

### Data

- `hms_practitioners`: one per doctor login (`user_id` unique).
- `hms_practitioner_credentials`: registrations with kind, number, issuing
  body, valid-from and valid-to dates, verification, and an end record (who
  ended it and why).
- A verified registration number is unique per kind and issuing body.
- Backfill: every doctor login gets a practitioner record. The registration
  number on each doctor profile becomes an **unverified** medical
  registration, issued by "not verified (migrated from doctor profile)".
  Nothing is invented or verified automatically.

### Rule

- `practitioner_credentials_expired(login)` is true when a practitioner has
  credentials and none is current today.
- A doctor for whom it is true cannot **create** or **finalise** an encounter
  (403, `REGISTRATION_EXPIRED`, with the reason).
- A doctor with **no** credentials recorded is not blocked. Blocking them would
  stop clinicians on the strength of missing data. The Practitioners page says
  so, and the owner should record the registrations.
- Only the encounter create and finalise routes are guarded in this part.
  Prescribing and dispensing are guarded in the phases that own them (Phase 3
  will add the same check when prescribing is rebuilt).

### API (`/api/practitioners`)

- `GET /` (admin, front desk): practitioners with their current status.
- `GET /:userId`: one practitioner with registrations. A doctor may read their
  own record only.
- `POST /:userId/credentials` (admins): record a registration (unverified).
- `POST /:userId/credentials/:id/verify` (admins): verify. A number already
  verified for another practitioner is refused (409).
- `POST /:userId/credentials/:id/end` (admins): end with a reason.

### Screen

- **Practitioners** (admin, front desk; recording and verifying for admins):
  the list shows Current / Expired / None recorded. The detail shows each
  registration's status, and admins can record, verify and end them.

### Verification (part 3)

- `e2e/practitioners.e2e.js` passes 8/8:
  - backfill, with the demo registration unverified;
  - front desk and nurses refused for recording;
  - a new doctor with only an expired registration is reported expired;
  - that doctor is refused a consultation with `REGISTRATION_EXPIRED`;
  - renewal restores consultations;
  - a registration verifies once, and a duplicate number for another
    practitioner is refused;
  - ending needs a reason, and a doctor cannot read another doctor's record;
  - a browser check of the admin screen.
- Migration proof passes on PostgreSQL 16 and 18.

## Part 4: scheduling without double-booking (`0013_scheduling.sql`, `routes/hms/appointments.js`, `utils/dbErrors.js`)

Blueprint 3.3 and 3.8: booking and rescheduling must not let two patients take the
same doctor's time.

### Data and rule

- Each appointment's time is stored as `slot_range` (a range derived from the date
  and slot times, kept by a trigger).
- `ex_appointments_doctor_no_overlap` refuses two live appointments for the same
  doctor whose ranges overlap. Cancelled and no-show bookings release their time.
  A completed booking still holds its time.
- Existing double-bookings were resolved by migration: the later booking is
  cancelled with a reason, the row is kept for rebooking, and the change is logged
  in `quarantine.log`. The copy used for testing had 2 such rows.
- `conflictResponse` maps the exclusion (23P01) and unique (23505) errors to **409**
  on appointment create and update, so a race returns a clear message.

### Slot choice

- When no time is given, the next free default slot is chosen. The resolver now
  uses the same rule as the database: any overlap blocks a slot, and completed
  bookings count. Before this part it compared exact start strings and ignored
  completed bookings, so it could pick a slot the database then refused.
  The admin suite found this (409 on a booking that should have moved to the
  next free slot).

### Verification (part 4)

- `e2e/scheduling.e2e.js`: 6/6.

## Part 5: care teams and patient scope (`0014_care_teams.sql`, `utils/careTeam.js`, `routes/careTeam.js`)

Blueprint section 1.4 F02: a doctor may act on a patient only when the patient is in
their care.

### Data and rule

- `hms_care_team_assignments`: who is on a patient's care team, with the role
  (consulting or primary), dates, and who ended it and why.
- `hms_break_glass_access`: emergency access for a doctor, for 60 minutes, with a
  reason of at least 10 characters. Every use is reviewed by an administrator.
- `patient_in_care(patient, user)` is true when the doctor has a current assignment,
  or is the admitting doctor of an active admission, or holds an active break-glass.

### Where it applies

- Guard on the patient record endpoints: `/api/patients/hms/:id`, `/api/patients/:id`,
  the vitals endpoints and prescriptions by patient. Allergies use the same
  `/api/patients/hms/:id/allergies` route, so a doctor not in care sees "Allergies
  not checked".
- Assignment happens automatically when a doctor takes a token, books an
  appointment, or starts an encounter. Starting an encounter for a patient not in
  care returns 403 `PATIENT_NOT_IN_CARE`.

### Known limits

- Patient search still shows basic demographics to every clinician. Only the
  record endpoints are scoped in this part.

### Verification (part 5)

- `e2e/careTeam.e2e.js`: 9/9.

## Part 6: emergency triage (`0015_triage.sql`, `routes/triage.js`)

Blueprint 3.13: missing clinical approval keeps the feature off.

### Rule

- Protocols (ESI v5 and Manchester v1) are seeded as `pending_approval` with **no
  content**. Assessments are refused with 409 ("Triage is switched off") until a
  clinician approves a protocol version.
- Arrivals can always be recorded. Assessments are append-only. An escalation needs
  an acknowledgement. A disposition closes the arrival.

### Screen

- **Emergency arrivals and triage** (`/hms/triage`): the board, most urgent first,
  with a banner while triage is off. The page currently hard-codes protocol ESI v5.
  Manchester is not offered in the screen.

### Verification (part 6)

- `e2e/triage.e2e.js`: 7/7. The test approves ESI v5 with a SQL fixture and restores
  the pending state afterwards.

## Part 7: clinical documents with expected versions and signatures (`0016_clinical_documents.sql`, `routes/clinicalDocuments.js`)

Blueprint 3.4, 3.8 and 3.9: a signature is bound to the exact version signed.

### Rule

- Saving a draft needs `If-Match` with the version it is based on. No header gives
  428; a stale version gives 412 with the current version.
- Signing records a SHA-256 digest of the canonical JSON of the content. The signed
  version is frozen.
- Amendments: `/amend` opens a new draft linked to the signed version with a reason,
  and `/sign-amendment` signs it. Signatures are append-only.

### Screen

- **Clinical note** (`/hms/notes/:id`): shows the version, the save/sign actions
  and the list of signed versions.

### Verification (part 7)

- `e2e/clinicalDocuments.e2e.js`: 8/8.

## Part 8: beds, transfers and discharge planning (`0017_adt.sql`, `routes/adt.js`, `utils/adt.js`)

Blueprint 3.3 and 4.1: `Available -> Reserved -> Occupied -> Dirty -> Cleaning -> Available`,
with `OutOfService` as an explicit exclusion.

### Data and rule

- Bed statuses: Available, Reserved, Occupied, Dirty, Cleaning, OutOfService.
- `hms_bed_occupancies` records who was in which bed and when. An exclusion
  constraint refuses two occupancies of one bed at the same time.
- A transfer moves the admission, closes the old occupancy and sends the old bed to
  **Dirty**. Moving into a bed that is not Available is refused (409).
- Admission opens an occupancy. Discharge closes it and sets the bed to **Dirty**,
  so it must be cleaned before reuse. Discharge is refused (409) until the discharge
  plan is clinically ready.
- Clinical readiness (the doctor) and financial clearance (billing) are recorded
  separately. A pending result needs a named owner.

### Screen

- **Beds, moves and discharge** (`/hms/adt`): bed list with the next status action,
  moves, and the discharge plan.

### Verification (part 8)

- `e2e/adt.e2e.js`: 8/8. The move target is chosen from the free beds, not fixed.
- The inpatient suite (`ipd.e2e.js`) now expects a discharged bed to be **Dirty**.

## Part 9: referrals with acknowledged handoffs (`0018_referral_handoffs.sql`, `routes/referrals.js`)

Blueprint 3.3 and 4.1: a referral is complete only after a recorded receiving action
or a documented closure.

### Lifecycle (enforced by the database)

- `Pending` -> `Acknowledged` (accepted by the receiving clinician) -> `Completed`
  (with an outcome), or `Pending` / `Acknowledged` -> `Closed` (with a reason).
- Accepting joins the receiving clinician to the patient's care team.
- Only the addressed clinician can accept. A referral to a specialty is closed by
  the sender or an administrator.
- Lists: "Waiting for me" and "I sent". A referral past its due time is flagged as
  overdue.

### Screen

- **Referrals** (`/hms/referrals`).

### Verification (part 9)

- `e2e/referrals.e2e.js`: 8/8. The database refuses a completed or closed referral
  without its record (check constraint 23514).

## Regression run (13 Oct, fresh copy of the 12 Oct Docker data, migrated)

Migrations: fresh and upgraded databases have identical schemas (1535 facts).

| Suite | Result |
|---|---|
| OPD | 20/20 |
| Pharmacy | 18/18 |
| Laboratory | 10/10 |
| Inpatient | 11/13: the two known IPD-billing failures (Phase 5) |
| Administration, front desk, reports | 28/28 |
| Authorization / sessions / audit | 5/5, 7/7, 7/7 |
| Idempotency / durability / frontend reliability / IPD drafts | 8/8, 11/11, 2/2, 2/2 |
| Patient identity / duplicate merge / practitioners | 9/9, 8/8, 8/8 |
| Scheduling / care teams / triage | 6/6, 9/9, 7/7 |
| Clinical documents / beds and discharge / referrals | 8/8, 8/8, 8/8 |

The full run was done once. Two changes came after it, to the appointment
resolver (409 instead of 400 for a slot clash, and the database's overlap wording).
Scheduling, OPD, administration, authorization and care teams were rerun after
that change and pass. Two bed-status colour entries were changed in the front end
after the run; the screens smoke test still passes.

Notes from the run:

- The durability suite starts a second backend. It uses port 15103 unless
  `E2E_SECOND_PORT` is set. That port was held by another agent's server, which
  made durability fail for an unrelated reason. Run it with `E2E_SECOND_PORT=15203`.
- Suites that register a patient for the doctor now assign that patient to the
  doctor's care first (`inCare` in `e2e/helpers.js`). Without it the patient-scope
  rule correctly refuses the doctor.

## Phase 2 status

- Parts 1–9 are built, with the suites listed above. `git log` shows which parts are committed.
- **Not deployed.** The Docker app has parts 1 only (see Part 1). Parts 2–9 need
  owner approval and a backup first (`scripts/backup-db.sh`).
- Screens (triage, referrals, clinical note, beds and moves) load in the browser
  for the roles that use them, with no page errors (smoke test, 6 checks). Their
  workflows (clicking through an assessment, a referral, a signature, a move) are
  **not** click-tested yet.
- Inpatient billing: two steps of `ipd.e2e.js` fail. They are the known Phase 5
  failures and are unchanged by Phase 2.
- Local PostgreSQL 18 (`hms` on 5432) is not migrated. That is an owner decision.
