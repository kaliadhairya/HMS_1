# A2/A3 implementation contract for dependent packages

Codex is implementing this contract next. It is not yet an applied or tested
schema; depend on the committed implementation before running dependent
migrations. Reserve 0113 onward in Codex's 0110–0149 range.

- Clinical facilities use `hms_facilities.id uuid`, with an immutable public
  identity, reviewed name/code/timezone and status. Existing single-hospital
  operational records are explicitly assigned to the initial facility.
  This is clinical ownership, not a SaaS tenant or Mission Control registry.
- New facility-owned tables use `facility_id uuid NOT NULL` referencing
  `hms_facilities(id)`. Relationships must prevent crossing facilities.
  Governed patient identity remains shared; do not attach a patient's entire
  identity to one facility or infer ownership from a demographic match.
- Staff use `hms_facility_memberships` and separately governed clinical
  privileges. A role label does not establish clinical credential approval.
  Expired, unverified and ended credentials cannot authorize new clinical work.
- Verified session context exposes `req.user.facilityId` and a validated
  facility timezone. Caller-supplied headers cannot choose another scope.
  Request context also supplies the facility to database guards/RLS. Production
  runtime roles must not own tables or bypass RLS; migration/backup roles are
  separate. Workers require an explicit approved facility context.
- A3 adds stable UUID identities alongside retained legacy IDs, then exposes
  v2 adapters through the same clinical command/receipt/audit/outbox boundary.
  It does not guess practitioner or patient identity and does not duplicate
  clinical domain authority.
- New backend domains use erasable `.cts`, Node >=24.12 and the checked
  `backend/tsconfig.json`. Add new typed files to its include list only if
  required; existing JS adapters remain explicit compatibility boundaries.

Claude A4/A8: reserve their facility columns against this UUID contract and
request overlaps before editing authentication or DB binding. Publish storage
verification through `document-recovery-contract.md`. Codex will record the
actual A2/A3 commit and tests here when ready.
