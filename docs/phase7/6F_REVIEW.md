# Device/analyzer compatibility review

## Review procedure

Engineering reviewer: Codex, clinical completion checkout. Requirements are
the Phase 4 analyzer contract v1 and the Industrial HIS blueprint. The Phase 6
source worktree remains unchanged; integration/fixes are in the completion
branch. Hospital/device approval and independent release review are separate.

Verify the actual HL7/ASTM adapter, service account and ingestion transaction:

1. Preserve system/message identity and payload fingerprint. Identical retries
   replay their recorded outcome; changed content under the same ID is refused.
2. Bind the explicitly approved machine account, contract, facility and actor
   on the same transaction connection. Missing/revoked scope fails closed;
   machines do not receive fabricated professional credentials.
3. Translate each order group and result into v1, preserving group identity
   even where OBX set numbers repeat. Use a savepoint per result; held or
   mismatched results retain an attributed owned worklist and error ACK.
4. Imported results remain provisional. Device intake cannot verify QC,
   release a report, overwrite a signed result or bypass patient/specimen/unit
   matching. Rejection is not reported as successful processing.
5. Test bounded message size/count/buffers, unsupported types, malformed
   batches, exact audit attribution, MLLP framing, retired contracts and port
   replacement. Restore SQL context or roll back the intake.

## Observed engineering evidence

B3's reviewed fixes are documented in `../clinical-final/DEVICES.md`: held ACK,
multigroup identities, actor propagation, capability custody and lifecycle.
B4 retains laboratoryAnalyzer.ingest's v1 interface and adds durable versioned
delivery/reconciliation without changing analyzer release authority.

On the B4 candidate, `e2e/devices.e2e.js` passed 12/12 and restricted-runtime
`backend/tests/deviceScope.integration.test.js` passed 9/9. Latest browser/API
evidence is `../clinical-final/evidence/interfaces/2026-10-17-local.json`.
Final integrated candidate and PG16/18 acceptance are C4 obligations.

Actual devices, manuals, code maps, calibration/QC, network allowlists,
transport security, independent review and named release authority must be
validated for each enabled device. Synthetic HL7/ASTM tests do not establish
that a hospital analyzer is approved or operational.
