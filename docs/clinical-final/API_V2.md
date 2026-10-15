# Clinical API v2: implemented foundation and remaining adapters

This is clinical HMS work under blueprint sections 3.2, 3.4, 3.9 and 3.10.
The complete A3 package remains in progress.

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

The published specification is `backend/contracts/v2.openapi.json`.
`npm run contracts:generate` in backend generates it and the browser types /
client in `frontend/src/api/v2.*.ts`. `npm run contracts:check` fails when an
artifact differs from its source. `npm run typecheck` checks server CommonJS
TypeScript and browser ES module contracts separately. Document section names
come from `backend/domain/clinicalDocumentSchema.cts`.

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

## Remaining A2/A3 work

- Complete scheduling, ADT, medication, dispensing/e-MAR, laboratory, finance
  and event adapters from blueprint 3.10 and consume their generated contracts.
- Complete facility/membership administration, explicit facility switching,
  remaining clinical action/care boundaries and restricted-runtime deployment.
- Strengthen coherent multi-query clinical read snapshots and the final complete
  permission/schema comparison; the current legacy fingerprint covers columns,
  constraints, indexes, sequences and function/trigger identities, not all bodies
  and permissions.
- Preserve stable pending requests/drafts across broader navigation and session
  transitions in coordination with Claude's C2 package. Run final C4 against the
  reviewed consolidated candidate. These focused checks are not go-live proof.
