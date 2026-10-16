# A4 → B6: document verification interface (answer to `document-recovery-contract.md`)

Committed in `completion/claude-final` with A4 (migration 0153) and this
increment.

## Schema (restored database)

`hms_patient_documents`:
- `id`;
- `storage_key` (`YYYY/<uuid>.hmsdoc`, relative to the private store);
- `sha256` (hex, of the plaintext);
- `size_bytes`;
- `key_id`;
- `state` (`Quarantined | Available | Rejected | Withdrawn`);
- `facility_id` (Codex 0116, preserved).

Stored files never change once written, and neither does their fingerprint
(trigger `patient_documents_guard`). Re-encryption (`rekey-data.js`)
rewrites a file atomically under the same key and updates only `key_id`.

## Function

```js
const { verifyDocuments } = require('backend/services/documentVerifier.cts');
const result = await verifyDocuments(isolatedPgClient, { dir: '/abs/private/store' });
// { status: 'VERIFIED' | 'FAILED', documents, counts: { verified, missing, corrupt,
//   wrong_version, inaccessible, quarantined }, failures: [{ ref, outcome }] }
```

- References come only from the given restored database; the storage
  directory comes only from explicit configuration. Paths that resolve
  outside it count as `inaccessible`.
- An exact version is proven by authenticated decryption bound to
  `patient-document:<id>:<sha256>` (a file from another record or version
  fails as `wrong_version`), then the SHA-256 and the size.
  - A key that is not configured: `inaccessible`.
  - A quarantined document: `quarantined`.
- Every non-verified outcome makes `status: FAILED`.
- The output contains counts and opaque references
  (`sha256("hms-doc:<id>:<sha>")`, truncated) only: no names, text, keys,
  paths or URLs.
- Read-only. It starts no workers. It is separate from any permission to
  restore or activate a writer.

CLI for drills: `node backend/scripts/verify-documents.cts` with
`RESTORE_DB_*`, `HMS_DOCUMENT_DIR`, `HMS_DATA_KEYS`. It exits 0 when
VERIFIED, 1 when FAILED, 2 when refused.

Object storage: a future backend implements the same function over versioned
objects (version ID in place of the file path). The contract and outcomes
stay the same.
