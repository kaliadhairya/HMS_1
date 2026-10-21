# Phase 6 review findings for clinical completion

Source reviewed: `phase6/interop-ops` (`e215653`, completion base `87b5833`).
Original `HMS_1-phase6` is unchanged. Reviewed fixes so far: `ddf70c7`.

| Finding | Impact | Action/owner |
|---|---|---|
| P6-R01 | Analyzer hold without a result reported as processed/AA | B3 Codex: require result identity, retain message/worklist, return AE; real PG test passed |
| P6-R02 | OBX set IDs reused across OBR groups collided | B3 Codex: include group in stable result identity; integration test passed |
| P6-R03 | Device actor needed confirmation on the actual transaction connection | B3 Codex: scoped database settings and restoration; row-audit attribution test passed |
| P6-R04 | Empty remote checkpoint store accepted | B5 Codex: empty-store failure; local Object Lock test passed |
| P6-R05 | Signed incomplete checkpoint manifest accepted | B5 Codex: complete unique known chain set; omitted/duplicate/unknown tests passed |
| P6-R06 | Shipment needed pinned versions, checksums and retention verification | B5 Codex: confirm/read exact VersionId and validate metadata/retention; local COMPLIANCE suite passed; historical/key rotation remains open |
| P6-R07 | Identical WAL retry failed | B6 Codex: atomic archive helper accepts identical retry and refuses differing/corrupt replacement; unit test passed |
| P6-R08 | Retired MLLP listeners/ports not reconciled safely | B3 Codex: close listeners/sockets, reconcile replacements, fresh context after confirmed root commit; port-reuse test passed |
| P6-R09 | Recovery accepts absent journal checks or unmeasured latest RPO | B6 Codex: pending fail-closed verification/drills; B7 waits for explicit B6-ready commit |

Phase 4 analyzer ingestion contract v1 is preserved by the bridge. Updated
device acceptance at **9a2ad7f** passed 12/12, including actual HL7 and ASTM
clinical writes, held results, actual DB actor, multigroup IDs and MLLP
replacement. Restricted-runtime device custody passes 9/9 on each PG engine.
Audit Object Lock passed 5/5 using a separate throwaway MinIO
bucket. Local tests do not prove production IAM separation or real devices.

Node 24/PostgreSQL 18 preparation and signed/FHIR changes are not the B6
handoff. Restore engine/data paths, protected credentials, invariants and
actual drills remain open. Regional RPO/RTO, old-writer fencing, current
security and delivered-effect reconciliation belong to Claude B7 after B6
is reviewed and committed. Missing hospital/region evidence stays visible.

Newer B6 core handoff **a757ac5** supersedes the pending-core notes above:
encrypted snapshot logical restores pass 7/7 on each engine and isolated
physical drills pass on both. Complete document versions and final release
evidence remain open; this does not claim regional recovery validation.
