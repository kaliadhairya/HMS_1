const express = require('express');
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { patientInCare, NOT_IN_CARE } = require('../utils/careTeam');

// Clinical notes with expected versions, signing and amendments (migration 0016).
// Mounted at /api/clinical-documents. Only the author (a doctor, in care of the
// patient) writes; signed content is never changed, only amended.
const router = express.Router();
const AUTHORS = ['doctor'];
const MAX_CONTENT = 20000;

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fail = (res, status, message, code, extra = {}) => res.status(status).json({ success: false, message, ...(code ? { code } : {}), ...extra });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// Canonical JSON: keys sorted at every level, so the digest is reproducible.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  return value;
}
const digestOf = (content) => crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');

// The expected version the client based its change on: If-Match: "<n>".
function expectedVersion(req, res) {
  const raw = req.headers['if-match'];
  if (raw === undefined) { fail(res, 428, 'Send If-Match with the version you are changing.', 'PRECONDITION_REQUIRED'); return null; }
  const n = Number(String(raw).replace(/^W\//, '').replace(/"/g, ''));
  if (!Number.isInteger(n) || n < 1) { fail(res, 400, 'If-Match must be a version number.'); return null; }
  return n;
}

function cleanContent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'The note content must be an object of named sections.' };
  const allowed = ['chiefComplaint', 'history', 'examination', 'assessment', 'plan'];
  const out = {};
  for (const key of allowed) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== 'string') return { error: `${key} must be text.` };
    out[key] = input[key].slice(0, 5000);
  }
  if (JSON.stringify(out).length > MAX_CONTENT) return { error: 'The note is too long.' };
  return { content: out };
}

async function loadDocument(id, transaction, lock = false) {
  const [doc] = await select(
    `SELECT id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version
       FROM hms_clinical_documents WHERE id = :id ${lock ? 'FOR UPDATE' : ''}`,
    { id }, transaction
  );
  return doc || null;
}

function view(doc) {
  return {
    id: Number(doc.id), patient_id: Number(doc.patient_id), encounter_id: doc.encounter_id ? Number(doc.encounter_id) : null,
    state: doc.state, version: Number(doc.draft_version), signed_version: doc.signed_version ? Number(doc.signed_version) : null,
    content: doc.draft_content,
  };
}

// POST /api/clinical-documents — start a note for a patient in the author's care.
router.post('/', protect, restrictTo(...AUTHORS), async (req, res) => {
  try {
    const patientId = posInt(req.body.patientId);
    const encounterId = req.body.encounterId ? posInt(req.body.encounterId) : null;
    if (!patientId) return fail(res, 400, 'Choose the patient.');
    if (!(await patientInCare(req.user.id, patientId))) return fail(res, 403, NOT_IN_CARE, 'PATIENT_NOT_IN_CARE');
    const cleaned = cleanContent(req.body.content || {});
    if (cleaned.error) return fail(res, 422, cleaned.error);
    const [row] = await select(
      `INSERT INTO hms_clinical_documents (patient_id, encounter_id, doc_type, author_user_id, draft_content)
       VALUES (:patientId, :encounterId, 'clinical_note', :userId, CAST(:content AS jsonb))
       RETURNING id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version`,
      { patientId, encounterId, userId: req.user.id, content: JSON.stringify(cleaned.content) }
    );
    res.set('ETag', `"${row.draft_version}"`).status(201).json({ success: true, data: view(row) });
  } catch (err) {
    console.error('Document create failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not start the note.' });
  }
});

// GET /api/clinical-documents/:id
router.get('/:id', protect, restrictTo(...AUTHORS, 'admin', 'super_admin'), async (req, res) => {
  try {
    const doc = await loadDocument(posInt(req.params.id) || 0);
    if (!doc) return fail(res, 404, 'Note not found.');
    if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, doc.patient_id))) return fail(res, 403, NOT_IN_CARE, 'PATIENT_NOT_IN_CARE');
    res.set('ETag', `"${doc.draft_version}"`).json({ success: true, data: view(doc) });
  } catch (err) {
    console.error('Document read failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the note.' });
  }
});

// PUT /api/clinical-documents/:id/draft — save the draft; If-Match must be the current version.
router.put('/:id/draft', protect, restrictTo(...AUTHORS), async (req, res) => {
  try {
    const expected = expectedVersion(req, res);
    if (expected === null) return;
    const cleaned = cleanContent(req.body.content);
    if (cleaned.error) return fail(res, 422, cleaned.error);
    const result = await sequelize.transaction(async (transaction) => {
      const doc = await loadDocument(posInt(req.params.id) || 0, transaction, true);
      if (!doc) return { status: 404, message: 'Note not found.' };
      if (doc.author_user_id !== req.user.id) return { status: 403, message: 'Only the author can change this note.' };
      if (!(await patientInCare(req.user.id, doc.patient_id, transaction))) return { status: 403, message: NOT_IN_CARE, code: 'PATIENT_NOT_IN_CARE' };
      if (doc.state === 'signed') return { status: 409, message: 'This note is signed. Amend it to change the content.', code: 'NOTE_SIGNED' };
      if (Number(doc.draft_version) !== expected) return { status: 412, message: `This note changed (now version ${doc.draft_version}). Reload before saving.`, code: 'VERSION_STALE', current: Number(doc.draft_version) };
      const [row] = await select(
        `UPDATE hms_clinical_documents SET draft_content = CAST(:content AS jsonb), draft_version = draft_version + 1, updated_at = now()
          WHERE id = :id RETURNING id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version`,
        { content: JSON.stringify(cleaned.content), id: doc.id }, transaction
      );
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message, result.code, result.current !== undefined ? { current: result.current } : {});
    res.set('ETag', `"${result.row.draft_version}"`).json({ success: true, data: view(result.row) });
  } catch (err) {
    console.error('Draft save failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not save the draft.' });
  }
});

// POST /api/clinical-documents/:id/sign — freeze the draft at the expected version.
router.post('/:id/sign', protect, restrictTo(...AUTHORS), async (req, res) => {
  try {
    const expected = expectedVersion(req, res);
    if (expected === null) return;
    const result = await sequelize.transaction(async (transaction) => {
      const doc = await loadDocument(posInt(req.params.id) || 0, transaction, true);
      if (!doc) return { status: 404, message: 'Note not found.' };
      if (doc.author_user_id !== req.user.id) return { status: 403, message: 'Only the author can sign this note.' };
      if (!(await patientInCare(req.user.id, doc.patient_id, transaction))) return { status: 403, message: NOT_IN_CARE, code: 'PATIENT_NOT_IN_CARE' };
      if (doc.state === 'signed') return { status: 409, message: 'This note is already signed.', code: 'NOTE_SIGNED' };
      if (Number(doc.draft_version) !== expected) return { status: 412, message: `This note changed (now version ${doc.draft_version}). Review it before signing.`, code: 'VERSION_STALE', current: Number(doc.draft_version) };
      const content = doc.draft_content;
      const version = 1;
      await select(
        `INSERT INTO hms_document_signatures (document_id, version, content, digest, signed_by, meaning)
         VALUES (:id, :version, CAST(:content AS jsonb), :digest, :userId, 'authored and signed')`,
        { id: doc.id, version, content: JSON.stringify(content), digest: digestOf(content), userId: req.user.id }, transaction
      );
      const [row] = await select(
        `UPDATE hms_clinical_documents SET state = 'signed', signed_version = :version, updated_at = now()
          WHERE id = :id RETURNING id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version`,
        { version, id: doc.id }, transaction
      );
      return { row, digest: digestOf(content) };
    });
    if (result.status) return fail(res, result.status, result.message, result.code, result.current !== undefined ? { current: result.current } : {});
    await logAction(req.user.id, 'UPDATE', 'clinical_document', result.row.id, null, { action: 'signed', version: result.row.signed_version, digest: result.digest }, req.ip);
    res.json({ success: true, data: view(result.row), digest: result.digest });
  } catch (err) {
    console.error('Sign failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not sign the note.' });
  }
});

// POST /api/clinical-documents/:id/amend — reopen a signed note for a linked amendment with a reason.
router.post('/:id/amend', protect, restrictTo(...AUTHORS), async (req, res) => {
  try {
    const expected = expectedVersion(req, res);
    if (expected === null) return;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 10) return fail(res, 422, 'Give the reason for the amendment (at least 10 characters).');
    const result = await sequelize.transaction(async (transaction) => {
      const doc = await loadDocument(posInt(req.params.id) || 0, transaction, true);
      if (!doc) return { status: 404, message: 'Note not found.' };
      if (doc.author_user_id !== req.user.id) return { status: 403, message: 'Only the author can amend this note.' };
      if (!(await patientInCare(req.user.id, doc.patient_id, transaction))) return { status: 403, message: NOT_IN_CARE, code: 'PATIENT_NOT_IN_CARE' };
      if (doc.state !== 'signed') return { status: 409, message: 'Only a signed note can be amended.' };
      if (Number(doc.draft_version) !== expected) return { status: 412, message: `This note changed (now version ${doc.draft_version}).`, code: 'VERSION_STALE', current: Number(doc.draft_version) };
      const [row] = await select(
        `UPDATE hms_clinical_documents SET state = 'draft', draft_version = draft_version + 1, updated_at = now()
          WHERE id = :id RETURNING id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version`,
        { id: doc.id }, transaction
      );
      return { row, reason };
    });
    if (result.status) return fail(res, result.status, result.message, result.code, result.current !== undefined ? { current: result.current } : {});
    await logAction(req.user.id, 'UPDATE', 'clinical_document', result.row.id, null, { action: 'amendment_started', reason }, req.ip);
    res.set('ETag', `"${result.row.draft_version}"`).json({ success: true, data: view(result.row), message: 'Amendment started. Edit the draft and sign it to finish.' });
  } catch (err) {
    console.error('Amend failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not start the amendment.' });
  }
});

// POST /api/clinical-documents/:id/sign-amendment — sign the amendment, linked to the version it amends.
router.post('/:id/sign-amendment', protect, restrictTo(...AUTHORS), async (req, res) => {
  try {
    const expected = expectedVersion(req, res);
    if (expected === null) return;
    const reason = typeof req.body.reason === 'string' ? req.body.reason.trim().slice(0, 500) : '';
    if (reason.length < 10) return fail(res, 422, 'The amendment needs its reason (at least 10 characters).');
    const result = await sequelize.transaction(async (transaction) => {
      const doc = await loadDocument(posInt(req.params.id) || 0, transaction, true);
      if (!doc) return { status: 404, message: 'Note not found.' };
      if (doc.author_user_id !== req.user.id) return { status: 403, message: 'Only the author can sign this note.' };
      if (!(await patientInCare(req.user.id, doc.patient_id, transaction))) return { status: 403, message: NOT_IN_CARE, code: 'PATIENT_NOT_IN_CARE' };
      if (doc.state !== 'draft') return { status: 409, message: 'There is no amendment in progress to sign.' };
      if (Number(doc.draft_version) !== expected) return { status: 412, message: `This note changed (now version ${doc.draft_version}).`, code: 'VERSION_STALE', current: Number(doc.draft_version) };
      const [{ next }] = await select('SELECT COALESCE(max(version), 0) + 1 AS next FROM hms_document_signatures WHERE document_id = :id', { id: doc.id }, transaction);
      const content = doc.draft_content;
      await select(
        `INSERT INTO hms_document_signatures (document_id, version, content, digest, signed_by, meaning, amends_version, amendment_reason)
         VALUES (:id, :next, CAST(:content AS jsonb), :digest, :userId, 'amended and signed', :amends, :reason)`,
        { id: doc.id, next, content: JSON.stringify(content), digest: digestOf(content), userId: req.user.id, amends: doc.signed_version, reason }, transaction
      );
      const [row] = await select(
        `UPDATE hms_clinical_documents SET state = 'signed', signed_version = :next, updated_at = now()
          WHERE id = :id RETURNING id, patient_id, encounter_id, author_user_id, state, draft_content, draft_version, signed_version`,
        { next, id: doc.id }, transaction
      );
      return { row, digest: digestOf(content) };
    });
    if (result.status) return fail(res, result.status, result.message, result.code, result.current !== undefined ? { current: result.current } : {});
    await logAction(req.user.id, 'UPDATE', 'clinical_document', result.row.id, null, { action: 'amendment_signed', version: result.row.signed_version }, req.ip);
    res.json({ success: true, data: view(result.row), digest: result.digest });
  } catch (err) {
    console.error('Amendment sign failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not sign the amendment.' });
  }
});

// GET /api/clinical-documents/:id/versions — every signed version, with its digest.
router.get('/:id/versions', protect, restrictTo(...AUTHORS, 'admin', 'super_admin'), async (req, res) => {
  try {
    const doc = await loadDocument(posInt(req.params.id) || 0);
    if (!doc) return fail(res, 404, 'Note not found.');
    if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, doc.patient_id))) return fail(res, 403, NOT_IN_CARE, 'PATIENT_NOT_IN_CARE');
    const rows = await select(
      `SELECT s.version, s.content, s.digest, s.meaning, s.amends_version, s.amendment_reason, s.signed_at, u.name AS signed_by_name
         FROM hms_document_signatures s JOIN hms_users u ON u.id = s.signed_by WHERE s.document_id = :id ORDER BY s.version`,
      { id: doc.id }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Versions failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the versions.' });
  }
});

module.exports = router;
