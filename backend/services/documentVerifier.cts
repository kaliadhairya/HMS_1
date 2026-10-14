// Document verification for restores (completion A4, for Codex's B6/C4:
// docs/requests/document-recovery-contract.md).
//
// verifyDocuments(client, { dir }) lists every stored document reference in
// the RESTORED database (through the isolated client it is given), then
// checks each exact object version in the given private storage: the file
// exists, decrypts with its recorded key and purpose (so it is the version
// written for that record), and matches the recorded size and SHA-256.
// Storage comes only from explicit configuration, never from a request.
// It returns counts and opaque references only: no names, clinical text,
// keys, paths or URLs. Anything missing, corrupt, of the wrong version,
// unreadable, quarantined or otherwise unverified makes the result FAILED.
// It starts no workers and writes nothing.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const keys = require('./dataKeys.cts');

type Client = { query(sql: string, params?: unknown[]): Promise<{ rows: any[] }> };
type Outcome = 'verified' | 'missing' | 'corrupt' | 'wrong_version' | 'inaccessible' | 'quarantined';

// An opaque, stable reference: lets two reports be compared without exposing the record.
const ref = (id: unknown, sha: string): string => crypto.createHash('sha256').update(`hms-doc:${id}:${sha}`).digest('hex').slice(0, 24);

async function verifyDocuments(client: Client, { dir }: { dir: string }) {
  if (!dir || !path.isAbsolute(dir)) throw new Error('verifyDocuments needs an explicit absolute storage directory');
  const { rows } = await client.query(`SELECT id, storage_key, sha256, size_bytes, state FROM hms_patient_documents
    WHERE storage_key IS NOT NULL ORDER BY id`);
  const counts: Record<Outcome, number> = { verified: 0, missing: 0, corrupt: 0, wrong_version: 0, inaccessible: 0, quarantined: 0 };
  const failures: Array<{ ref: string; outcome: Outcome }> = [];
  const root = fs.realpathSync(dir);
  for (const d of rows) {
    let outcome: Outcome;
    const file = path.resolve(root, String(d.storage_key));
    if (!file.startsWith(root + path.sep)) outcome = 'inaccessible';
    else if (d.state === 'Quarantined') outcome = 'quarantined';
    else if (!fs.existsSync(file)) outcome = 'missing';
    else {
      try {
        const plain = keys.decryptBlob(fs.readFileSync(file), `patient-document:${d.id}:${d.sha256}`).plain;
        const sha = crypto.createHash('sha256').update(plain).digest('hex');
        outcome = sha !== d.sha256 || plain.length !== Number(d.size_bytes) ? 'corrupt' : 'verified';
      } catch (err: any) {
        outcome = err.code === 'DATA_KEY_MISSING' ? 'inaccessible' : err.code === 'DATA_INTEGRITY' ? 'wrong_version' : 'corrupt';
      }
    }
    counts[outcome]++;
    if (outcome !== 'verified') failures.push({ ref: ref(d.id, d.sha256), outcome });
  }
  return { status: failures.length ? 'FAILED' : 'VERIFIED', documents: rows.length, counts, failures };
}

module.exports = { verifyDocuments };
