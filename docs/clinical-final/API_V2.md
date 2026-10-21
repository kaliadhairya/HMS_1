# Clinical API v2: implemented foundation and remaining adapters

This is clinical HMS work under blueprint sections 3.2, 3.4, 3.9 and 3.10.
A3 is engineering-done: every 3.10 interface is implemented, documented and
checked against the published contract.

## Implemented commands and reads

- `GET /api/v2/legacy-identities/{kind}/{legacy_id}` resolves an exact
  migration-owned identity mapping. Numeric identifiers remain compatibility
  references; native clinical paths accept UUIDs.
- Patient and encounter reads, encounter creation, draft saving and signing.
- Clinical document creation/read, draft saving, signing, starting an amendment
  and signing its linked correction. Supported types are clinical notes,
  discharge summaries, nursing assessments, care plans and existing encounter
  notes. Initial encounter notes are created/signed through consultation.
- Both API versions call the same typed encounter/document authorities.
  Consultation, Quick Consult and the clinical note page use UUID commands.
  Transitional screens retain explicitly mapped numeric associations for
  medication, laboratory and billing panels pending their adapters.
- Native medication creation/read, sign/hold/resume/discontinue/amend, independent
  pharmacy review, exact-version partial dispensing, schedules, bedside preparation
  and immutable dose documentation now call the shared medication authorities.
  Medication browser consumers and the remaining domain adapters are still pending.
  Exact decimal quantities use strings. Dispensing reviews the order's public
  version; preparation and administration review the occurrence's public version.
  Fulfillment and bedside claims advance these versions even for legacy callers.
  A recorded administration is immutable at version 1; corrections remain linked
  records. Revoked professional privileges also deny completed receipt replay.

The published specification is `backend/contracts/v2.openapi.json`.
`npm run contracts:generate` in backend generates it and the browser types /
client in `frontend/src/api/v2.*.ts`. `npm run contracts:check` fails when an
artifact differs from its source. `npm run typecheck` checks server CommonJS
TypeScript and browser ES module contracts separately. Document section names
come from `backend/domain/clinicalDocumentSchema.cts`.

## Scheduling (A3, first adapter)

- `POST /api/v2/appointments` books a slot. It requires an `Idempotency-Key`,
  names the patient, doctor and department by public identifier, and returns
  the booking with its `version` and `operation_id`. Roles: administrator,
  receptionist, doctor.
- `GET /api/v2/appointments/{id}` reads one booking by public identifier.
- Booking calls the same transactional core as `POST /api/hms/appointments`
  (`backend/services/appointmentBooking.js`): one doctor and day are serialized
  by an advisory lock, and a database exclusion rule refuses overlapping times.
  Legacy and v2 bookings therefore cannot both win one slot.
- Verified by `e2e/v2Scheduling.e2e.js` (8/8): identifiers, retry replay,
  conflicting key reuse, missing key, overlap, 50 concurrent requests for one
  slot (exactly one booking), a legacy/v2 race, role refusal and reads.
- `POST /api/v2/appointments/{id}/reschedule` and `/cancel` need `If-Match`
  with the booking version (428 without it, 412 when stale).

## Identity and authority

Migrations 0127–0130 add exact UUID mappings for 25 retained numeric resource
kinds, immutable identities, public aggregate versions, exact visit context
relationships and signed document projection guards. Registry/mapping changes
require the migration owner. A runtime business insert records its own UUID
through a narrowly scoped fixed-path trigger. A runtime cannot extend the
registry or forge mappings even when table INSERT permissions are present.

`doctor_id` in the transitional encounter contract is the canonical principal
UUID corresponding to the retained `hms_encounters.doctor_id` user relationship.
It is never interpreted as a `hms_doctors.id` or inferred from a name.
Professional credentials and facility privileges resolve through the principal's
canonical practitioner relationship.

Clinical authoring requires current facility membership, independently verified
professional credentials, the specific clinical action and chart-read privilege.
Doctors require current patient care scope. Nursing documents require current
nursing responsibility for an active admission in that facility. An administrator
role alone does not grant clinical note or encounter access.

A visit must belong to the selected patient, responsible doctor and facility.
Multiple possible waiting visits require an explicit selection. Historical
inconsistent visit relationships enter the identity review worklist rather than
being guessed or silently reassigned. Any unvalidated relationship remains a
release/recovery validation gap until reconciled.

## Version, retry and signature behavior

Every mutation needs an Idempotency-Key. Updates/signatures additionally require
If-Match with the **public aggregate version** returned by v2. It is distinct
from a legacy note's draft/content revision. A command locks the row, checks
that exact aggregate version and translates its locked snapshot to the existing
content revision. It does not substitute a newer revision after a conflict.

Successful mutations return the committed `version` and `operation_id`. The
operation identifier is the first request UUID retained in the durable command
receipt. An exact retry replays that original result. Hashing includes facility,
original UUID/body and precondition before compatibility translation.

Missing preconditions return 428, stale snapshots 412, invalid state/transaction
conflicts 409 and invalid clinical fields 422. Unknown outcomes preserve the
original key/body for reconciliation. A confirmed command is not classified as
unknown merely because its subsequent UI refresh failed.

Signed content stays in its original immutable JSON representation. Public
snake_case presentation is separate. The digest covers
`canonical_signed_content` using `hms-json-v1` (recursively sorted object keys).
Amendments explicitly link their predecessor and record a reason. They cannot
be signed through the initial-sign command. PostgreSQL refuses signed projection
overwrite, removal/rewind of a signature link, unsigned reopening, changed author
or document type, deletion and content that does not match the exact signature.

The note page ignores superseded loads and binds pending requests to actor,
facility and record context. A delayed response from a previous record cannot
replace an edited destination note. A conflict requires comparing the server
copy and explicitly choosing a version; it never silently advances If-Match.

## Admissions, transfers and discharge (A3)

- `POST /api/v2/admissions` admits a patient into a bed (patient, bed and admitting
  doctor by public identifier). The legacy route and v2 call one command
  (`services/admissionCore.js`), so the patient, bed and request locks and the
  occupancy rule are identical. Roles: administrator, doctor, nurse.
- `GET /api/v2/admissions/{id}`; `POST .../transfer` (If-Match, target bed, reason);
  `POST .../discharge` (If-Match; responsible doctor with the signing privilege and
  the patient in care). The discharge body is snake_case (`final_diagnosis`,
  `course_in_hospital`, ...); an unknown field is refused with 422, not dropped.

## Laboratory (A3)

- `POST /api/v2/lab-orders`, `GET /api/v2/lab-orders/{id}`, `POST .../cancel`.
  An order lists its ordered tests with their identifiers and versions.
- `POST /api/v2/specimens`, `POST /api/v2/specimens/{id}/collect|receive|reject`
  (If-Match; the label's patient and accession are confirmed again).
- `POST /api/v2/lab-items/{id}/results` (If-Match on the ordered test),
  `POST /api/v2/results/{id}/verify`, `POST /api/v2/lab-orders/{id}/reports`
  (release; blueprint `POST /reports/{id}/release` — a report has no identity
  before its first release, so release is addressed to the order).
- `POST /api/v2/critical-results/{id}/acknowledgments` and
  `/clinical-actions`: acknowledgment and the documented clinical action stay
  separate commands, both by the responsible doctor.
- Lab orders and ordered tests count revisions from 0; their public version is
  the revision plus one, and If-Match is translated back before the shared
  check. Specimens and critical results use their revision (it starts at 1).

## Finance (A3)

- `GET /api/v2/billing-accounts/{id}`; `POST .../charges`;
  `POST /api/v2/charges/{id}/reverse`; `POST .../draft-invoice`;
  `POST .../invoices` issues the reviewed draft (If-Match on the draft version;
  a draft changed by a later charge is 412). Invoice lines name their charges.
- `POST /api/v2/payments`, `/deposit-allocations`, `/credit-notes`
  (administrators; explicit lines or the cancelled charge it credits),
  `/refunds` and `/refunds/{id}/approve|reject|pay|confirm` (the approver is not
  the requester).
- Every step is the legacy billing command: account locks, the price list,
  journal postings and the database integrity rules are shared. A legacy field
  refusal (400) answers 422 on v2.

## Events (A3)

- `GET /api/v2/events?cursor=<delivery sequence>` pages the same scoped events
  as the live socket (audience, facility and doctor care scope), names the
  patient by public identifier, and returns `next_cursor`, `latest_cursor`,
  `has_more`. Without a cursor it returns the cursor to start from.

## Browser consumers (A3)

The medication order panel, the pharmacy page (verification, dispensing) and the
nursing page (scheduled doses, bedside checks, dose documentation) use the v2
medication commands. The safety assessment before signing and as-needed doses
have no v2 command and stay on `/api/medication`. Catalogue, stock, allergy,
controlled-drug, returns and counter-sale screens are outside blueprint 3.10 and
stay on their APIs.

## Contract and conformance

All implemented operations are in `backend/contracts/v2.openapi.json` with the
generated browser types and client. `e2e/v2Contract.e2e.js` checks every v2
command response recorded during a regression (the idempotency store keeps the
original response) and a sample of reads against the published schemas; run it
after the other suites.

## Remaining A2 work

- Facility/membership administration and switching, remaining clinical
  action/care boundaries and the restricted-runtime deployment are tracked
  under A2 (engineering done; the production compose change needs owner
  approval).
- Coherent multi-query read snapshots and the final complete permission/schema
  comparison belong to C4. These focused checks are not go-live proof.
