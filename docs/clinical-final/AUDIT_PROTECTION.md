# Audit protection engineering acceptance

B5 verifies complete checkpoint manifests against all three known audit chains.
Missing, duplicate or unknown chain heads, invalid sequences/hashes, future times,
unknown keys, changed signatures and the wrong hospital identity fail verification.

New checkpoints use HMAC-SHA256 schema 2, recording a signing key ID and the
immutable UUID in `audit.checkpoint_identity` (0145). Database names are locations;
a renamed/restored database retains the original audit identity. A configured
`AUDIT_CHECKPOINT_SCOPE`, when supplied, must match that sentinel. Historical
checkpoint bytes and signatures are retained exactly.

## Rotation and recovery configuration

Set `AUDIT_CHECKPOINT_KEYRING_FILE` to a regular, private 0600/0400 JSON file
readable by the worker. Symlinks and group/world-readable files are refused.
The shape is:

```json
{
  "version": 1,
  "active_key_id": "new-key-id",
  "legacy_key_id": "original-key-id",
  "keys": [
    { "id": "original-key-id", "secret": "<original private secret, at least 32 bytes>", "not_before": "2026-01-01T00:00:00Z", "sign_until": "2026-10-16T00:00:00Z" },
    { "id": "new-key-id", "secret": "<new random private secret, at least 32 bytes>", "not_before": "2026-10-16T00:00:00Z", "sign_until": null }
  ]
}
```

Use actual approved dates and secrets. Retain the old verification keys for the
retention of their proofs. `legacy_key_id` explicitly identifies the key for
original manifests that had no embedded ID; no other key is tried after refusal.
The single-key `AUDIT_CHECKPOINT_KEY` path remains available for a configured
original installation. Keep its `AUDIT_CHECKPOINT_KEY_ID` stable until migration.

Rotate by writing a complete replacement file with private permissions and an
atomic rename. Each new checkpoint reloads the ring. Retired keys verify only
proofs signed within their approved interval. Never re-sign historical files.
Recover the keyring through separately protected secret management together with
the original checkpoint files and pinned object versions.

Configure `AUDIT_WORM_BUCKET`, region and a stable `AUDIT_WORM_PREFIX`; preserve
the prefix during database renaming/recovery. Set storage-owner default COMPLIANCE
retention. The shipper may add/read only its hospital prefix, list that prefix and
read object versions/retention. It must not delete versions or change retention,
bucket policy or the signing keys' historical protection. Production credentials
and independently administered storage remain deployment evidence requirements.

Shipment success requires an immutable VersionId, matching HEAD metadata/length,
approved retention, then GET of that exact version with matching bytes/retention.
Remote validation also pins untracked versions before reading their bodies.
Unreachable/empty/truncated inventories, missing shipments and delivery gaps are
reported explicitly. Local verification of an empty checkpoint directory fails.

`audit-verify.js --remote` reports failures to the security worklist under
`HMS_WORKER_USER_ID` and only its approved current facility memberships. The
worker and CLI bind actor/facility settings on acquired database connections.
0136 makes worklist deduplication facility-specific. Worklist pages retain role
and facility restrictions, support bounded pagination and problem filtering,
and require attributable resolution notes. Resolved history cannot be reopened
or deleted. Missing worker identity never substitutes the initial facility.

## Observed verification

- `backend/tests/auditCheckpoint.test.js`, `auditKeys.test.js`, and
  `auditShipping.test.js`: 19 unit/adversarial scenarios pass.
- `scripts/verify-audit-protection.cjs`: ten integrated scenarios, including the
  existing `auditWorm.e2e.js` operator suite (5/5), pass on disposable PostgreSQL 16
  and an ephemeral MinIO COMPLIANCE bucket. Restricted storage credentials cannot
  delete/change retention or write outside their prefix; even the fixture storage
  owner cannot delete a retained version. Overwriting adds a version while the
  pinned original remains verifiable.
- The test creates an actual pg_dump artifact, pg_restore restores it under a
  new database name, and local/remote verification accepts original historical
  proofs together with a rotated keyring without rewriting them.
- A non-owner, non-BYPASSRLS database role reports one item per approved facility,
  deduplicates repeats and stops activity after membership revocation.

Evidence is under `~/.local/state/hms-clinical-final/audit/*/verification.json`.
Earlier failures remain there. One exposed an actual visibility problem: over
11,000 old audit alerts filled an unpaged 500-row worklist. API/UI pagination and
problem filtering now make the remaining records reachable.

These are engineering fixtures. Independently controlled production storage,
real retention policy/key custody, and final-candidate PG18/full regression are
separate deployment and C4 gates. Production/hospital approvals are not supplied
by these synthetic tests.
