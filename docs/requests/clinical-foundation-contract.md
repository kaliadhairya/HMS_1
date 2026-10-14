# A2/A3 implementation contract for dependent packages

The first implementation is committed at **584e169**, with migrations
0113–0122 applied/tested on disposable PostgreSQL 16 and 18 databases. A2/A3
remain partial; depend on the committed definitions below and read the open
integration list in `docs/clinical-final/PROGRESS.md` before final acceptance.

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

Claude A4/A8: use these committed UUID definitions and request overlaps before
editing authentication or DB binding. Publish storage verification through
`document-recovery-contract.md`. `sessionFacility`/`requirePrivilege` are in
`backend/services/facilities.cts`; `setActor` supplies `facilityId` and
`facilityTimezone`. Workers must set a verified facility context; an empty
context intentionally sees no facility-owned rows through runtime RLS.

The new `clinical.authorization.changed` outbox event names the facility,
grant/revision and target user. A8 should consume it to refresh/revoke scoped
socket access. The typed clinical grants are separate from login role labels.
Machine ANALYZER grants still need explicit facility integration in B4; do not
fabricate a professional credential for an instrument account.

The administrator credential and privilege screens plus AuthContext timezone
binding were updated by Codex for A2. The reusable `useGovernedCommand` hook
retains the exact body/revision/key through uncertain confirmation. C2 should
preserve these behaviors and rebase on 584e169 before overlapping those files.
