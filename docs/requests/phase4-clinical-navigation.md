# Phase 4 integration: clinical navigation and coded ordering

Phase 4 owns the laboratory endpoints and `/lab/governed` workspace. The
laboratory code must not guess a test identity from its display name.

Owner request for Phase 3's consultation investigation UI and Phase 2's
`frontend/src/pages/hms/doctor/DoctorLabsPage.jsx`:

- Replace free-text investigation selection with approved test/panel versions
  from `GET /api/laboratory/catalogue`, submitted as `test_version_ids` to
  `POST /api/laboratory/orders` (or `test_version_id` on each item through
  the existing investigation-order endpoint).
- Preserve the current patient/encounter and unsaved consultation state.
  Until integrated, use the Phase 4 workspace for coded investigation ordering.
- Link clinical result review and unresolved critical/result-review tasks to
  `/lab/governed?patient_id=<id>`. Opening old doctor result dialogs must not
  claim acknowledgment or closure.
- Use server-approved flags and exact report-version PDFs. Missing approved
  intervals must stay visibly unknown; historical free-text ranges are labelled
  historical and cannot define a new result's interpretation.

Phase 4 will retain historical reads and retire ungoverned result/report writes.
No edits to other phases' implementation files or shared deployment are made.

Shared dashboard integration: `/api/lab/workload` exposes `abnormalFlagged`
and `unresolvedCritical` separately. Update the dashboards to read the former
for "Abnormal results". The legacy `criticalFlagged` alias retains only its
historical abnormal-count semantics for compatibility; it is not evidence
that a critical policy matched or a communication task exists.

## Status (Phase 2 part, 2026-10-14, Phase 6 branch)

Done for `DoctorLabsPage.jsx`: every row opens the patient in
`/lab/governed?patient_id=<id>`; with a patient selected the header offers
"Order coded tests and review results"; the old report dialog is labelled an
earlier view, says it acknowledges nothing, and marks ranges as historical
and not validated (`e2e/doctorNavigation.e2e.js`). Dashboards already read
`abnormalFlagged`; nothing reads `criticalFlagged`.

Still open for the Phase 3 owner: coded investigation ordering on the
consultation screen (`pages/hms/consultation/*`).
