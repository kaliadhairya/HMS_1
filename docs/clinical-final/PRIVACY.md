# Personal data at rest: what HMS encrypts, keeps and deletes (completion A4)

This is a factual description of the software as built. Retention periods
and the legal basis for keeping records are **hospital policy inputs**, and
are marked as such here.

## What is encrypted, and how

| Data | Where | Protection |
|---|---|---|
| Aadhaar number | `hms_patients.aadhaar` | AES-256-GCM, purpose `patient.aadhaar`; only the last 4 digits are ever shown |
| ABDM HIU private keys | `hms_abdm_hiu_keys.private_key_enc` | AES-256-GCM, purpose `abdm.hiu-private-key` |
| OTP text queued for SMS | outbound interface message payload | AES-256-GCM, purpose `abdm.sms-text` |
| Patient documents (files) | `HMS_DOCUMENT_DIR`, outside any public folder | AES-256-GCM, bound to the document's record and SHA-256; the SHA-256 is checked again on every download |
| Downtime kits | `DOWNTIME_KIT_DIR` and ward machines | AES-256-GCM with `DOWNTIME_KIT_KEY` (C6) |

How the encryption works:
- **Keys** come from `HMS_DATA_KEYS` (`id:64-hex` pairs, comma-separated).
  The first key, or `HMS_DATA_KEY_ACTIVE`, encrypts new values.
- Every value records its key ID.
- The purpose is authenticated with each value, so a value copied into
  another field or record fails to decrypt instead of being read there.
- **Production refuses to start without keys** (`NODE_ENV=production` or
  `HMS_REQUIRE_DATA_KEYS=true`). Development without keys uses a key marked
  `dev-only` and prints a warning.
- **Older values** (AES-CBC from `ENCRYPTION_KEY` / `AADHAAR_ENCRYPTION_KEY`)
  still decrypt and are reported as legacy. Before this change, Aadhaar was
  written with one key and read with the other, so the masked number could
  never show. It is now written and read with one scheme.

**Not encrypted by HMS:** all other clinical and demographic data in
PostgreSQL. That data relies on:
- database access control;
- the audit log;
- encryption of the database volume and backups by the hosting (for example
  RDS storage encryption). This is a deployment requirement, not something
  HMS can verify.

## Rotating a key

1. Generate a key: `openssl rand -hex 32`.
2. Put it **first** in `HMS_DATA_KEYS`, keep the old key listed, and restart
   HMS.
3. Run `node scripts/rekey-data.js` (use `--dry-run` first to see the
   counts). It is resumable: only values not yet on the active key change,
   each in its own transaction.
4. When the report shows nothing left, remove the old key and restart.
   - Outbound messages are never rewritten. Keep the old key until the
     report shows no pending outbound messages under it (OTPs finish within
     minutes).
   - A document whose file fails its integrity check cannot be re-encrypted.
     The run lists it and exits with status 1. It is also on the worklist
     (`document.integrity`).
5. Legacy values: list the old `ENCRYPTION_KEY` / `AADHAAR_ENCRYPTION_KEY`
   while the script runs once; after that they are not needed.

`docker-compose.yml` publishes a default `AADHAAR_ENCRYPTION_KEY`. Any
installation that used that default should treat that key as known: rekey
with a new `HMS_DATA_KEYS` key, then remove the old key.

## Patient documents

- **Accepted:** PDF, PNG and JPEG, recognised by their content (a renamed
  program is refused), up to `HMS_DOCUMENT_MAX_MB` (default 20).
- **Checks before anyone can open a file:**
  - PDFs containing JavaScript, launch actions, embedded files, rich media
    or XFA forms are **Rejected**. They are stored encrypted for the record
    but never served.
  - With `CLAMAV_HOST` set, each file is also scanned by ClamAV. If ClamAV
    cannot be reached, the document stays **Quarantined** and goes on the
    worklist.
  - **Without `CLAMAV_HOST` there is no antivirus scan.** The document record
    says so ("File type and active-content checks only; no antivirus is
    configured").
- **Who:**
  - list and open: super admin, admin, doctor, nurse, front desk and lab;
  - upload: the same roles except the lab;
  - a doctor only for patients in their care.
  - Each download is checked against the stored fingerprint and recorded in
    the audit log.
- **No deletion through the application.** A document is *withdrawn* with a
  reason and stays in the record.
- The database refuses to:
  - delete a document under legal hold or inside its retention period;
  - change a stored document's file, fingerprint, type or patient;
  - withdraw a held document.
- **Legal hold:** placed and lifted by an administrator, always with a reason.
- **Retention:** each document is kept until upload date +
  `HMS_DOCUMENT_RETENTION_YEARS` (default 10).
  - **The hospital sets this period** under its records policy and the
    applicable rules.
  - HMS does not purge automatically. `GET /api/patients/documents/report`
    counts documents past retention for a reviewed decision.
- **Evidence:** the report endpoint gives counts by state, the number under
  legal hold, the number past retention, and documents per key ID (proof of
  rotation progress).

## Verified by

| Check | Where |
|---|---|
| Purpose binding, tampering, rotation, legacy CBC from both old keys, production refusal | `backend/tests/dataKeys.test.js` |
| Aadhaar stored under the active key and shown masked; document encrypted on disk and returned byte for byte; access by role and care team; renamed program, active PDF and oversized files refused; type by content; altered file refused and reported; legal hold, no delete, no rewrite; withdrawal; ClamAV unreachable → quarantine and worklist; full rotation to a new key, read with only that key, resumable; production start refused without keys | `e2e/documents.e2e.js` |

**Open gates:**
- A real ClamAV deployment and its signature updates.
- Volume and backup encryption on the target host.
- The hospital's retention periods and legal-hold procedure.
- Rotation of any key that was ever published.
