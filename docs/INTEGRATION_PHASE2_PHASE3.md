# Integration: Phase 2 + Phase 3

Branch `integration/phase2-phase3`, cut from `phase2/patient-journey` (64db139) with
`phase3/medication-safety` (a359c9e) merged into it. Neither source branch was changed.
Not deployed.

## What the merge needed

| Gate (from `docs/requests/`) | Done |
|---|---|
| Patient scope on `/api/medication` | Doctors are refused (403 `PATIENT_NOT_IN_CARE`) for allergies, new orders, order reads and order commands for a patient not in their care. The order and eMAR lists show a doctor only patients in their care. Nurses, pharmacists and desk staff are not limited, as on the Phase 2 record routes. |
| Retire the free-text MAR writes | `POST /api/ipd/mar` and `PATCH /api/ipd/mar/:id/status` answer 410 `LEGACY_MAR_RETIRED`. Old records stay readable. The inpatient chart's Medications tab is read-only ("Earlier medication record") and links nurses to eMAR. |
| Tests tied to Phase 3 databases | The medication, OPD and durability suites accepted only `hms_p3_*` databases. They now use `requireThrowawayDb()` in `e2e/helpers.js`, which accepts the throwaway names in AGENTS.md. |

Also fixed while testing:

- Phase 3 tests create encounters directly in SQL, which skips the care-team
  assignment the encounter API makes. They now add that assignment.
- `medicationFrontend.e2e.js` filled a local-time input with a UTC time. It passed
  only when the browser ran in UTC. The screen itself converts correctly.
- `patientIdentity.e2e.js`: two simultaneous ABHA verifications. The loser is
  refused by either the database (409) or the clash check (202 with a duplicate
  case); the test now accepts both. Exactly one copy is verified either way.

Merge conflict: only `e2e/pharmacy.e2e.js` (Phase 3's rewrite kept, the Phase 2
care-team setup re-applied).

## Test run (13 Oct, fresh copy of the 12 Oct Docker data, migrations 0001–0043)

| Suite | Result |
|---|---|
| Migrations (fresh vs upgraded) | identical, 2,522 schema facts |
| Backend unit tests | 10 pass, 0 fail (1 database suite skipped, as designed) |
| Medication / guards / medication screens | 20/20, 9/9, 6/6 |
| OPD / pharmacy / lab / admin | 20/20, 18/18, 10/10, 28/28 |
| Inpatient | 11/13: the two known IPD-billing failures (Phase 5) |
| Authorization / sessions / idempotency / durability | 5/5, 7/7, 8/8, 11/11 |
| Frontend reliability / IPD drafts / audit | 2/2, 2/2, 7/7 |
| Patient identity / merge / practitioners / scheduling | 9/9, 8/8, 8/8, 6/6 |
| Care teams (now with medication scope) / triage | 10/10, 7/7 |
| Clinical documents / beds and discharge / referrals | 8/8, 8/8, 8/8 |

How it was run:

- Run order: the three medication suites first, because `medicationGuards`,
  `medicationFrontend` and `durability` reuse the synthetic products the
  `medication` suite creates. Audit runs last, because it tampers with the audit
  chain on purpose.
- Environment: `HMS_TEST_DATABASE=true` and `E2E_SECOND_PORT=15203`.

## Still open (owner decisions)

- **Medicines are not billed.** Coded dispensing writes `hms_med_charges`; no bill reads
  them yet (Phase 5). Counter (OTC) sales still bill.
- **Quick Consult** and the lower part of the consultation screen still write free-text
  prescriptions, which the pharmacy can no longer dispense. Doctors must use the coded
  order panel; Quick Consult has none.
- Clinical rule packs ship empty: every order goes to pharmacist review until clinical
  owners approve content.
