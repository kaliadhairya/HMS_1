// Verifies every stored patient document of a restored database against
// private storage (completion A4; interface in
// docs/requests/document-recovery-contract-claude.md).
//   RESTORE_DB_HOST/PORT/NAME/USER/PASSWORD  the isolated restored database
//   HMS_DOCUMENT_DIR                         the restored private storage
//   HMS_DATA_KEYS                            keys able to read the documents
// Prints counts and opaque references; exit 0 VERIFIED, 1 FAILED, 2 refused.
const { Client } = require('pg');
const { verifyDocuments } = require('../services/documentVerifier.cts');

(async () => {
  const e = process.env;
  if (!e.RESTORE_DB_NAME || !e.HMS_DOCUMENT_DIR) { console.error('Set RESTORE_DB_NAME (and RESTORE_DB_*) and HMS_DOCUMENT_DIR.'); process.exit(2); }
  const client = new Client({ host: e.RESTORE_DB_HOST || '127.0.0.1', port: Number(e.RESTORE_DB_PORT || 5432), database: e.RESTORE_DB_NAME,
    user: e.RESTORE_DB_USER || 'postgres', password: e.RESTORE_DB_PASSWORD || '', application_name: 'hms-verify-documents' });
  await client.connect();
  try {
    await client.query('SET default_transaction_read_only = on');
    const result = await verifyDocuments(client, { dir: e.HMS_DOCUMENT_DIR });
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'VERIFIED' ? 0 : 1;
  } finally { await client.end(); }
})().catch((err: Error) => { console.error(`Verification refused: ${err.message}`); process.exit(2); });
