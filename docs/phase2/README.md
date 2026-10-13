# Phase 2: patient journey, identity and ADT

Branch `phase2/patient-journey`, cut from `phase1/integrity-foundation`.
Migrations 0010–0029. See `docs/PARALLEL_WORK.md`.

| Part | Status |
|---|---|
| 1. Patient identity | **Done** (see below) |
| 2. Duplicate review and merge | Not started |
| 3. Practitioners | Not started |
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
