// Private patient documents (completion A4, migration 0153).
//
// Upload: only PDF, PNG and JPEG (recognised by their content, not the file
// name), at most HMS_DOCUMENT_MAX_MB. The file is encrypted with the data
// keyring (services/dataKeys.cts), bound to its record and fingerprint, and
// stored outside any public folder (HMS_DOCUMENT_DIR). It starts in
// quarantine and becomes available only after its checks pass: active PDF
// content (JavaScript, launch actions, embedded files) is refused, and with
// CLAMAV_HOST set it is also scanned by ClamAV. If the scanner cannot be
// reached the document stays quarantined and goes on the worklist.
// Download: only available documents, decrypted and checked against the
// fingerprint taken at upload; a mismatch is refused and reported.
// Documents are never deleted from the record: they are withdrawn with a
// reason, which a legal hold prevents. Each has a retention date
// (HMS_DOCUMENT_RETENTION_YEARS, a hospital policy input).
import type { Transaction } from 'sequelize';
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { sequelize } = require('../models/db');
const keys = require('./dataKeys.cts');
const W = require('./worklist');

type Actor = { id: number; role: string };
type Upload = { path: string; originalname: string; size: number };
type Scan = { engine: string; result: 'clean' | 'rejected' | 'unavailable'; detail: string; at: string };
const rows = (sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<any[]> =>
  sequelize.query(sql, { replacements, transaction, type: 'SELECT' });
const one = async (sql: string, r: Record<string, unknown>, t?: Transaction): Promise<any> => (await rows(sql, r, t))[0] ?? null;
function fail(status: number, message: string, code: string): never { throw Object.assign(new Error(message), { status, code }); }

const TYPES = ['Report', 'Prescription', 'Referral', 'Consent', 'Identity', 'Discharge', 'Imaging', 'Other'];
const ADMIN = ['super_admin', 'admin'];
const maxBytes = (): number => Number(process.env.HMS_DOCUMENT_MAX_MB || 20) * 1024 * 1024;
const retentionYears = (): number => Number(process.env.HMS_DOCUMENT_RETENTION_YEARS || 10);
function dir(): string {
  const d = process.env.HMS_DOCUMENT_DIR;
  if (!d) fail(503, 'Document storage is not configured (HMS_DOCUMENT_DIR).', 'DOCUMENTS_OFF');
  return d;
}
const purpose = (id: number, sha: string): string => `patient-document:${id}:${sha}`;

// What the bytes are, whatever the file is called.
function sniff(head: Buffer): string | null {
  if (head.subarray(0, 5).toString('latin1') === '%PDF-') return 'application/pdf';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  return null;
}
const EXT: Record<string, string> = { 'application/pdf': '.pdf', 'image/png': '.png', 'image/jpeg': '.jpg' };

// A PDF may carry programs and other files; a clinical document does not need them.
function activeContent(bytes: Buffer, media: string): string | null {
  if (media !== 'application/pdf') return null;
  const text = bytes.toString('latin1');
  for (const [re, what] of [[/\/JavaScript\b|\/JS\s*[(<]/, 'JavaScript'], [/\/Launch\b/, 'a launch action'], [/\/EmbeddedFile\b/, 'an embedded file'], [/\/RichMedia\b/, 'rich media'], [/\/XFA\b/, 'an XFA form']] as Array<[RegExp, string]>) {
    if (re.test(text)) return `The PDF contains ${what}; such files are not stored.`;
  }
  return null;
}

// ClamAV's INSTREAM protocol, when CLAMAV_HOST is configured.
function clamav(bytes: Buffer): Promise<Scan> {
  const host = process.env.CLAMAV_HOST;
  const at = new Date().toISOString();
  if (!host) return Promise.resolve({ engine: 'basic', result: 'clean', detail: 'File type and active-content checks only; no antivirus is configured (CLAMAV_HOST).', at });
  return new Promise((resolve) => {
    const socket = net.connect({ host, port: Number(process.env.CLAMAV_PORT || 3310) });
    let answer = '';
    const done = (scan: Scan) => { socket.destroy(); resolve(scan); };
    socket.setTimeout(Number(process.env.CLAMAV_TIMEOUT_MS || 15000), () => done({ engine: 'clamav', result: 'unavailable', detail: 'ClamAV did not answer in time.', at }));
    socket.on('error', (err: Error) => done({ engine: 'clamav', result: 'unavailable', detail: `ClamAV could not be reached: ${err.message}`, at }));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < bytes.length; i += 64 * 1024) {
        const chunk = bytes.subarray(i, i + 64 * 1024);
        const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
        socket.write(len); socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (d: Buffer) => { answer += d.toString('utf8'); });
    socket.on('end', () => {
      const a = answer.replace(/\0/g, '').trim();
      if (/:\s*OK$/.test(a)) done({ engine: 'clamav', result: 'clean', detail: 'ClamAV: no threat found.', at });
      else if (/FOUND$/.test(a)) done({ engine: 'clamav', result: 'rejected', detail: `ClamAV: ${a.replace(/^stream:\s*/, '')}`, at });
      else done({ engine: 'clamav', result: 'unavailable', detail: `ClamAV answered: ${a || 'nothing'}`, at });
    });
  });
}

const safeName = (name: string): string => (path.basename(String(name || 'document')).replace(/[^\w.\- ()]+/g, '_').slice(0, 120) || 'document');

async function upload(patientId: number, file: Upload | undefined, body: { docType?: unknown }, actor: Actor, t: Transaction) {
  if (!file) fail(400, 'Choose a file to upload.', 'NO_FILE');
  if (file.size > maxBytes()) fail(413, `The file is larger than ${process.env.HMS_DOCUMENT_MAX_MB || 20} MB.`, 'TOO_LARGE');
  const docType = String(body.docType || 'Other');
  if (!TYPES.includes(docType)) fail(400, `Document type must be one of ${TYPES.join(', ')}.`, 'INVALID');
  const patient = await one('SELECT id FROM hms_patients WHERE id = :id', { id: patientId }, t);
  if (!patient) fail(404, 'Patient not found.', 'NOT_FOUND');
  const bytes: Buffer = fs.readFileSync(file.path);
  const media = sniff(bytes.subarray(0, 16));
  if (!media) fail(415, 'Only PDF, PNG and JPEG files can be stored (checked by content, not by name).', 'UNSUPPORTED_TYPE');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  const name = safeName(file.originalname);
  const [{ years }] = await rows('SELECT :y::int AS years', { y: retentionYears() }, t);
  const row = await one(`INSERT INTO hms_patient_documents (patient_id, file_name, doc_type, uploaded_by, uploaded_at, sha256, size_bytes, media_type, state, key_id, retain_until)
    VALUES (:p, :name, :type, :u, now(), :sha, :size, :media, 'Quarantined', :key, (now() + make_interval(years => :years))::date)
    RETURNING id`, { p: patientId, name, type: docType, u: actor.id, sha, size: bytes.length, media, key: keys.activeKeyId(), years }, t);
  // Encrypted and bound to this record and fingerprint; never written in the clear.
  const storageKey = path.join(String(new Date().getUTCFullYear()), `${crypto.randomUUID()}.hmsdoc`);
  const target = path.join(dir(), storageKey);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const tmp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, keys.encryptBlob(bytes, purpose(row.id, sha)), { mode: 0o600 });
  fs.renameSync(tmp, target);
  await rows('UPDATE hms_patient_documents SET storage_key = :k WHERE id = :id', { k: storageKey, id: row.id }, t);

  const refused = activeContent(bytes, media);
  const scan: Scan = refused ? { engine: 'basic', result: 'rejected', detail: refused, at: new Date().toISOString() } : await clamav(bytes);
  const state = scan.result === 'clean' ? 'Available' : scan.result === 'rejected' ? 'Rejected' : 'Quarantined';
  await rows('UPDATE hms_patient_documents SET state = :state, scan = CAST(:scan AS jsonb) WHERE id = :id', { state, scan: JSON.stringify(scan), id: row.id }, t);
  if (state === 'Quarantined') {
    await W.report({ kind: 'document.scan_unavailable', key: String(row.id), ownerRole: 'admin', patientId,
      title: `A patient document is held in quarantine because it could not be scanned: ${scan.detail}`, detail: { document_id: row.id } }, t);
  }
  return view(row.id, t);
}

const COLUMNS = `id, patient_id, file_name, doc_type, uploaded_by, uploaded_at, sha256, size_bytes, media_type, state, scan, key_id,
  legal_hold, legal_hold_reason, retain_until, withdrawn_at, withdrawn_reason`;
const view = (id: number, t?: Transaction) => one(`SELECT ${COLUMNS} FROM hms_patient_documents WHERE id = :id`, { id }, t);
const list = (patientId: number, t?: Transaction) => rows(`SELECT d.id, d.file_name, d.doc_type, d.uploaded_at, d.size_bytes, d.media_type, d.state, d.scan,
    d.legal_hold, d.retain_until, d.withdrawn_at, d.withdrawn_reason, u.name AS uploaded_by_name
  FROM hms_patient_documents d LEFT JOIN hms_users u ON u.id = d.uploaded_by WHERE d.patient_id = :p ORDER BY d.uploaded_at DESC`, { p: patientId }, t);

async function download(patientId: number, id: number, actor: Actor, t: Transaction) {
  const d = await one(`SELECT ${COLUMNS}, storage_key FROM hms_patient_documents WHERE id = :id AND patient_id = :p`, { id, p: patientId }, t);
  if (!d) fail(404, 'Document not found for this patient.', 'NOT_FOUND');
  if (d.state !== 'Available') fail(409, d.state === 'Quarantined' ? 'This document is in quarantine until it has been checked.' : `This document is ${String(d.state).toLowerCase()} and cannot be opened.`, 'NOT_AVAILABLE');
  let plain: Buffer;
  try { plain = keys.decryptBlob(fs.readFileSync(path.join(dir(), d.storage_key)), purpose(d.id, d.sha256)).plain; }
  catch (err: any) {
    await W.report({ kind: 'document.integrity', key: String(d.id), ownerRole: 'super_admin', patientId, title: `A stored patient document could not be opened safely: ${err.message}`, detail: { document_id: d.id } });
    fail(409, 'This document failed its integrity check and was not opened. It has been reported.', 'DOCUMENT_INTEGRITY');
  }
  if (crypto.createHash('sha256').update(plain).digest('hex') !== d.sha256) fail(409, 'This document does not match its fingerprint and was not opened.', 'DOCUMENT_INTEGRITY');
  return { id: d.id, sha256: d.sha256, bytes: plain, name: d.file_name.endsWith(EXT[d.media_type]) ? d.file_name : `${d.file_name}${EXT[d.media_type]}`, media: d.media_type };
}

async function withdraw(patientId: number, id: number, body: { reason?: unknown }, actor: Actor, t: Transaction) {
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) fail(400, 'Say why the document is withdrawn.', 'INVALID');
  const d = await one('SELECT id, legal_hold, state FROM hms_patient_documents WHERE id = :id AND patient_id = :p FOR UPDATE', { id, p: patientId }, t);
  if (!d) fail(404, 'Document not found for this patient.', 'NOT_FOUND');
  if (d.legal_hold) fail(409, 'This document is under legal hold and cannot be withdrawn.', 'LEGAL_HOLD');
  if (d.state === 'Withdrawn') fail(409, 'Already withdrawn.', 'NOT_AVAILABLE');
  await rows("UPDATE hms_patient_documents SET state = 'Withdrawn', withdrawn_at = now(), withdrawn_by = :u, withdrawn_reason = :r WHERE id = :id", { u: actor.id, r: reason, id }, t);
  return view(id, t);
}

async function legalHold(patientId: number, id: number, body: { hold?: unknown; reason?: unknown }, actor: Actor, t: Transaction) {
  if (!ADMIN.includes(actor.role)) fail(403, 'Only an administrator places or lifts a legal hold.', 'FORBIDDEN');
  const hold = body.hold === true;
  const reason = String(body.reason || '').trim();
  if (reason.length < 5) fail(400, 'Say why (for example, the legal matter or the instruction).', 'INVALID');
  const d = await one(`UPDATE hms_patient_documents SET legal_hold = :hold, legal_hold_reason = :r, legal_hold_by = :u, legal_hold_at = now()
    WHERE id = :id AND patient_id = :p RETURNING id`, { hold, r: reason, u: actor.id, id, p: patientId }, t);
  if (!d) fail(404, 'Document not found for this patient.', 'NOT_FOUND');
  return view(id, t);
}

// What is stored, under which keys, held and past retention: the evidence.
const report = (t?: Transaction) => one(`SELECT
    count(*)::int AS documents,
    count(*) FILTER (WHERE state = 'Available')::int AS available,
    count(*) FILTER (WHERE state = 'Quarantined')::int AS quarantined,
    count(*) FILTER (WHERE state = 'Rejected')::int AS rejected,
    count(*) FILTER (WHERE state = 'Withdrawn')::int AS withdrawn,
    count(*) FILTER (WHERE legal_hold)::int AS on_legal_hold,
    count(*) FILTER (WHERE retain_until < current_date AND NOT legal_hold)::int AS past_retention,
    COALESCE(jsonb_object_agg(key_id, n) FILTER (WHERE key_id IS NOT NULL), '{}'::jsonb) AS by_key
  FROM (SELECT d.*, count(*) OVER (PARTITION BY key_id) AS n FROM hms_patient_documents d WHERE storage_key IS NOT NULL) x`, {}, t);

module.exports = { upload, list, download, withdraw, legalHold, report, TYPES, sniff, activeContent };
