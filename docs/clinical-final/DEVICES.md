# Analyzer contract and device custody evidence

Engineering candidate: **9a2ad7f**, migrations through 0126. Package B3 is
engineering-complete; B4 still needs the remaining named-owner/versioned
departmental delivery and restore-suppression integration. Final candidate
regression remains C4. No production deployment or real-device validation is
claimed by these local tests.

## Implemented contract

- The approved device contract binds one explicit service account and facility.
  Ingress verifies its exact key or allowlisted MLLP peer before obtaining that
  context. Retirement and credential/membership changes affect subsequent
  requests; approval is independent of the contract author.
- Analyzer service accounts require the scoped `ANALYZER` capability, not a
  manufactured medical/nursing/laboratory qualification. They receive no
  report-release privilege. Human catalogue/review/release work separately
  checks current professional credentials and clinical action grants.
- HL7 `ORU^R01` and ASTM result records map through the existing Phase 4
  analyzer contract v1. Codes/methods come from the approved mapping; patient,
  accession and ordered item relationships are checked, never name-matched.
  Results remain provisional until the separately authorized review/release.
- Stable result IDs include the order group, specimen, code and result set ID.
  Held results return AE for HL7 and remain on the review worklist. Malformed,
  unsupported-type and oversized messages return AR; exact retries preserve
  the original recorded rejection without rewriting finished custody.
- The entire message transaction records the accepting service account, exact
  immutable contract and facility. Historical provenance stays unknown when
  it was not recorded. Context restoration failure throws and rolls back;
  it cannot turn an uncommitted operation into a success acknowledgment.
- Intake statements have a three-second timeout, lock waits 500 ms and idle
  transaction time five seconds. PostgreSQL 17+ also enforces a ten-second
  transaction timeout. Result batches default to 100, bounded to 1–1000 by
  `DEVICE_MAX_RESULTS`. MLLP buffers/queues and idle connections are bounded.
- Active listener changes drain old sockets and release ports before a
  replacement starts. Every MLLP contract needs explicit IP addresses.
- Device keys are shown once. Receipts preserve activation metadata while
  refusing secret replay; historical cached keys are redacted by 0125. A lost
  first delivery requires retirement/replacement, not another secret download.

The ASTM field layout was cross-checked against the manufacturer's
[Siemens INNOVANCE PFA-200 Data Interface Manual](https://doclib.siemens-healthineers.com/rest/v1/view?document-id=809989).
That reference supports the parser's completion-time/instrument fields; it
does not establish compatibility with a different instrument or firmware.
Each real deployment still needs its own approved manual, captured messages,
code/unit/method mappings and clinical release validation in C7.

## Actual acceptance

| Check | Latest observed result |
|---|---|
| PostgreSQL/HTTP/MLLP and HL7/ASTM clinical bridge | 12/12 |
| Restricted runtime identity on PostgreSQL 16 | 9/9 |
| Restricted runtime identity on PostgreSQL 18 | 9/9 |
| Backend aggregate before the final wrong-message-type assertion | 61 passed, 2 skipped; final assertion passed in both focused runs |
| Type check and frontend build | Passed |
| PG16/PG18 structural fingerprint through 0126 | Identical, 5,663 facts |

The HTTP fixture uses a separate unlicensed machine account and independently
approved synthetic human credentials for catalogue/ordering. It proves two
ASTM groups with repeated result IDs produce exactly two provisional results
and none on replay. Scoped SQL fixtures also prove missing authority, wrong
peers/keys, live revocation, unchanged duplicate outcomes, batch limits and
rollback after a simulated context-restoration failure. Fixtures are restricted
to disposable databases and are never seeded into hospital production.

The first fixture attempt failed on an SQL date alias and the first restricted
role attempt lacked PostgreSQL's key-column UPDATE permission for row locks.
Both were corrected before the successful reruns. Migration 0126 initially
rolled back for a missing composite parent key; the unapplied file was fixed
and then applied/tested. Applied migrations were not rewritten.
