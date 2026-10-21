// The document step of a restore check (completion B6): unpacks a backup's private document
// archive into a private temporary folder, verifies every stored document of the RESTORED
// database against it (services/documentVerifier.cts: exact version, decryption, size, SHA-256),
// and removes the folder. A restore that has stored documents but no archive is refused.
//   RESTORE_DB_HOST/PORT/NAME/USER/PASSWORD  the isolated restored database
//   DOCUMENT_ARCHIVE                         the backup's documents.tar.gz (may be absent)
//   HMS_DATA_KEYS                            keys able to read the documents
// Prints counts and opaque references only; exit 0 VERIFIED, 1 FAILED, 2 refused.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { Client } = require('pg');
const { verifyDocuments } = require('../services/documentVerifier.cts');

(async () => {
  const e = process.env;
  if (!e.RESTORE_DB_NAME) { console.error('Set RESTORE_DB_NAME (and RESTORE_DB_*).'); process.exit(2); }
  const client = new Client({ host: e.RESTORE_DB_HOST || '127.0.0.1', port: Number(e.RESTORE_DB_PORT || 5432), database: e.RESTORE_DB_NAME,
    user: e.RESTORE_DB_USER || 'postgres', password: e.RESTORE_DB_PASSWORD || e.DB_PASSWORD || '', application_name: 'hms-restore-verify-documents' });
  await client.connect();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-restore-docs-'));
  fs.chmodSync(dir, 0o700);
  try {
    await client.query('SET default_transaction_read_only = on');
    const { rows: [{ n }] } = await client.query('SELECT count(*)::int AS n FROM hms_patient_documents WHERE storage_key IS NOT NULL');
    const archive = e.DOCUMENT_ARCHIVE;
    if (!archive || !fs.existsSync(archive)) {
      if (n > 0) { console.error(`Verification refused: the restored database has ${n} stored documents but the backup has no document archive.`); process.exitCode = 2; return; }
      console.log(JSON.stringify({ status: 'VERIFIED', documents: 0, counts: {}, failures: [] }, null, 2));
      return;
    }
    // Members are unpacked under the private folder only; absolute paths and links are not followed.
    execFileSync('tar', ['-xzf', archive, '-C', dir, '--no-same-owner', '--no-same-permissions'], { stdio: ['ignore', 'ignore', 'pipe'] });
    const result = await verifyDocuments(client, { dir });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'VERIFIED' ? 0 : 1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    await client.end();
  }
})().catch((err: Error) => { console.error(`Verification refused: ${err.message}`); process.exit(2); });
