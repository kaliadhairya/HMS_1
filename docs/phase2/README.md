# Phase 2: patient journey, identity and ADT

Branch `phase2/patient-journey`, cut from `phase1/integrity-foundation`.
Migrations 0010–0029. See `docs/PARALLEL_WORK.md`.

| Part | Status |
|---|---|
| 1. Patient identity | **Done**, deployed to Docker 13 Oct (see below) |
| 2. Duplicate review and merge | **Done** (see below) |
| 3. Practitioners | **Done** (see below) |
| 4. Scheduling reservations | Not started |
| 5. Encounters, care teams and patient scope | Not started |
| 6. Emergency triage | Not started |
| 7. Versioned, signed clinical documents | Not started |
| 8. Bed occupancy, transfers and discharge planning | Not started |
| 9. Referrals and acknowledged handoffs | Not started |

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
