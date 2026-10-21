# B6 database recovery implementation

Database exports use one PostgreSQL repeatable-read exported snapshot for the
dump and its table-count/migration/extension manifest. A session backup lock
prevents overlapping exports. Artifacts use authenticated AES-256-GCM; the
manifest is authenticated separately with the configured backup key. Keys
are supplied through protected configuration. PostgreSQL tools receive a
temporary owner-only password file, not credentials in command arguments.

Use Node 24 with a matching PostgreSQL client:

```sh
node backend/scripts/clinical-backup.cts backup /private/backups/new-run
node backend/scripts/clinical-backup.cts verify /private/backups/new-run hms_verify_final_restore_run
```

Configuration: `DB_*` (or explicit `BACKUP_DB_*`), `BACKUP_ENCRYPTION_KEY`
(32 random bytes in hex), `BACKUP_KEY_ID`, `PG_BIN`; verification may use
separate `RESTORE_DB_*`. The output directory must be new and remains private.
Retain the exact key version needed by the artifact under approved recovery
access. Restore validation starts no application or workers and creates only
a distinct `hms_verify_final_*` database. Existing/live targets are refused.

`STORED` means an artifact exists. `VERIFIED_DATABASE` requires a completed
restore, matching counts/migrations/extensions, clean audit chains, balanced
journals, stock reconciliation, patient/order/specimen relationships, valid
constraints and valid clinical signature digests. It does not claim that
external document objects or a regional environment were verified. Claude A4
supplies the exact document-version verifier through the recorded interface.
Neither a absent measurement nor a missing validation becomes a success.

Physical backups build in a private temporary directory, record migration
checksums, create SHA256 backup manifests and publish atomically. PITR restores
verify stored files and PostgreSQL's backup manifest before recovery. The
target runs with `--network none`, no public listener and no application.
Every RPO/RTO is measured; missing values, exceeded limits or absent journal
checks fail. Full invariant/signature verification runs against the restored
database. A base schema mismatch requires an approved compatible recovery
profile; the verifier does not silently ignore it.

Actual local evidence, 15 October 2026:

| Check | Observed result |
|---|---|
| Encrypted export/restore, PG16 | 7/7 acceptance checks |
| Encrypted export/restore, PG18 | 7/7 acceptance checks |
| Evidence failure tests | 3/3; unknown measurements and failed checks refuse success |
| PG16 PITR | Exactly markers 1–25; RPO ~0.100 s, RTO ~2.28 s; all database invariants clean |
| PG18 PITR | Exactly markers 1–25; RPO ~0.100 s, RTO ~2.27 s; all database invariants clean |
| Standby drills, PG16/18 | No acknowledged writes lost; application ready ~1.5 s after contained primary loss |

Logs/manifests: `~/hms-verification/clinical-final-b6-20261015-full` and
`~/hms-verification/clinical-final-b6-pg18-20261015`. These are small same-host
disposable drills, not regional RPO/RTO or production capacity claims. A first
PG18 tamper fixture set an already-zero count to zero; it was corrected to
change the value, then the acceptance suite passed. No failed result was
reported as a pass.

B7 can build on this committed database recovery core. Complete package
sign-off still requires A4 document-version integration, final candidate
regression and the separately owned protected/regional deployment evidence.

Sources: [pg_dump snapshots](https://www.postgresql.org/docs/18/app-pgdump.html),
[snapshot administration](https://www.postgresql.org/docs/18/functions-admin.html),
[pg_verifybackup](https://www.postgresql.org/docs/18/app-pgverifybackup.html).

## Patient documents in a restore (B6)

Encrypted patient documents live outside the database. `scripts/backup-db.sh` archives
the backend's private document store (`HMS_DOCUMENT_DIR`) as `documents.tar.gz`, still
encrypted. `scripts/restore-check.sh` restores the dump into a temporary database and runs
`backend/scripts/restore-verify-documents.cts` in the backend container (which holds the
keys): every stored document of the restored records must be present in the archive as the
exact version written for it (decryption with its recorded purpose, size and SHA-256). Any
missing, altered, wrong-version, unreadable or quarantined document fails the restore, and a
restore with stored documents but no archive is refused. Output is counts and opaque
references only.

After a point-in-time restore (`scripts/pitr-restore-drill.sh`), run the same check against
the restored database with the document archive taken closest to the recovery target:
`RESTORE_DB_NAME=<restored> DOCUMENT_ARCHIVE=<documents.tar.gz> node scripts/restore-verify-documents.cts`.
A document written after that archive is reported missing; restore it from a later document
backup or record it on the recovery worklist before returning to service.

Evidence: `e2e/backupRestore.e2e.js` (clean backup verifies; an altered stored document, an
archive of another store and a missing archive each fail).
