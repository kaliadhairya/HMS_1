const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');

// Duplicate patient review (migration 0011). Candidates are proposed by
// find_duplicate_candidates(); people decide. Front desk and admins review and
// dismiss; only admins merge or unmerge. Mounted at /api/patients.
const router = express.Router();

const REVIEWERS = ['super_admin', 'admin', 'receptionist'];
const MERGERS = ['super_admin', 'admin'];
const STATUSES = new Set(['open', 'dismissed', 'merged', 'unmerged']);

const text = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// PL/pgSQL refusals (merge_patients/unmerge_patients) become 409/404 with their message.
function sqlRefusal(err) {
  const code = err.original?.code || err.parent?.code;
  if (code === 'P0001') return { status: 409, message: err.original?.message || err.message };
  if (code === 'P0002') return { status: 404, message: 'Merge case not found.' };
  return null;
}

// Proposes cases for one patient (after registration or an identifier clash).
// Never fails the caller: detection is advisory.
async function proposeForPatient(patientId, userId, transaction) {
  const [row] = await select('SELECT propose_duplicate_cases(:patientId, :userId) AS created', { patientId, userId: userId ?? null }, transaction);
  return Number(row?.created || 0);
}

const PATIENT_SUMMARY = `json_build_object('id', p.id, 'uhid', p.uhid, 'name', p.name, 'gender', p.gender, 'age', p.age,
  'dob', p.dob, 'phone', p.phonenumber, 'identity_status', p.identity_status, 'registered_at', p.created_at,
  'visits', (SELECT count(*) FROM hms_encounters e WHERE e.patient_id = p.id),
  'admitted', EXISTS (SELECT 1 FROM hms_admissions a WHERE a.patient_id = p.id AND a.status = 'Active'))`;

// GET /api/patients/duplicates?status=open
router.get('/duplicates', protect, restrictTo(...REVIEWERS), async (req, res) => {
  try {
    const status = STATUSES.has(req.query.status) ? req.query.status : 'open';
    const rows = await select(
      `SELECT c.id, c.status, c.evidence, c.score, c.detected_at, c.decided_at, c.decision_reason, c.survivor_id, c.merged_id,
              c.unmerged_at, c.unmerge_reason, du.name AS decided_by_name,
              (SELECT ${PATIENT_SUMMARY} FROM hms_patients p WHERE p.id = c.patient_a_id) AS patient_a,
              (SELECT ${PATIENT_SUMMARY} FROM hms_patients p WHERE p.id = c.patient_b_id) AS patient_b
         FROM hms_patient_merge_cases c LEFT JOIN hms_users du ON du.id = c.decided_by
        WHERE c.status = :status
        ORDER BY ${status === 'open' ? 'c.score DESC, c.detected_at' : 'COALESCE(c.unmerged_at, c.decided_at) DESC'}
        LIMIT 200`,
      { status }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Duplicate list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load possible duplicates.' });
  }
});

// POST /api/patients/duplicates/scan — look for duplicates across all patients.
router.post('/duplicates/scan', protect, restrictTo(...REVIEWERS), async (req, res) => {
  try {
    const [row] = await select('SELECT propose_duplicate_cases(NULL, :userId) AS created', { userId: req.user.id });
    res.json({ success: true, data: { created: Number(row.created) }, message: `${row.created} new possible duplicate(s) found.` });
  } catch (err) {
    console.error('Duplicate scan failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not scan for duplicates.' });
  }
});

// POST /api/patients/duplicates — staff report two records they believe are one person.
router.post('/duplicates', protect, restrictTo(...REVIEWERS), async (req, res) => {
  try {
    const a = posInt(req.body.patientAId);
    const b = posInt(req.body.patientBId);
    const reason = text(req.body.reason);
    if (!a || !b || a === b) return fail(res, 400, 'Choose two different patients.');
    if (!reason) return fail(res, 400, 'Say why these records look like the same person.');
    const [pa, pb] = [Math.min(a, b), Math.max(a, b)];
    const patients = await select("SELECT id FROM hms_patients WHERE id IN (:pa, :pb) AND identity_status <> 'merged'", { pa, pb });
    if (patients.length !== 2) return fail(res, 404, 'Both patients must exist and not already be merged.');
    const [row] = await select(
      `INSERT INTO hms_patient_merge_cases (patient_a_id, patient_b_id, evidence, score, detected_by)
       VALUES (:pa, :pb, CAST(:evidence AS jsonb), 50, :userId)
       ON CONFLICT DO NOTHING RETURNING id`,
      { pa, pb, evidence: JSON.stringify([`reported by staff: ${reason}`]), userId: req.user.id }
    );
    if (!row) return fail(res, 409, 'These two records are already open for review.');
    res.status(201).json({ success: true, data: { id: Number(row.id) } });
  } catch (err) {
    console.error('Duplicate report failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the possible duplicate.' });
  }
});

// POST /api/patients/duplicates/:caseId/dismiss — not the same person.
router.post('/duplicates/:caseId/dismiss', protect, restrictTo(...REVIEWERS), async (req, res) => {
  try {
    const reason = text(req.body.reason);
    if (!reason) return fail(res, 400, 'Say why these are different people.');
    const [row] = await select(
      `UPDATE hms_patient_merge_cases SET status = 'dismissed', decided_by = :userId, decided_at = now(), decision_reason = :reason
        WHERE id = :caseId AND status = 'open' RETURNING id`,
      { caseId: posInt(req.params.caseId) || 0, userId: req.user.id, reason }
    );
    if (!row) return fail(res, 404, 'No open case like that.');
    res.json({ success: true, message: 'Marked as different people.' });
  } catch (err) {
    console.error('Duplicate dismiss failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not dismiss the case.' });
  }
});

// POST /api/patients/duplicates/:caseId/merge — { survivorId, reason }. Admins only.
router.post('/duplicates/:caseId/merge', protect, restrictTo(...MERGERS), async (req, res) => {
  try {
    const caseId = posInt(req.params.caseId);
    const survivorId = posInt(req.body.survivorId);
    const reason = text(req.body.reason);
    if (!caseId) return fail(res, 404, 'Merge case not found.');
    if (!survivorId) return fail(res, 400, 'Choose the record to keep.');
    if (!reason) return fail(res, 400, 'Say how you confirmed these are the same person.');
    const [row] = await select('SELECT merge_patients(:caseId, :survivorId, :userId, :reason) AS moved', { caseId, survivorId, userId: req.user.id, reason });
    await logAction(req.user.id, 'UPDATE', 'patient', survivorId, null, { action: 'merged', caseId, moved: Number(row.moved) }, req.ip);
    res.json({ success: true, message: `Merged. ${row.moved} record(s) moved to the kept patient.`, data: { moved: Number(row.moved) } });
  } catch (err) {
    const refusal = sqlRefusal(err);
    if (refusal) return fail(res, refusal.status, refusal.message);
    console.error('Merge failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not merge the records.' });
  }
});

// POST /api/patients/duplicates/:caseId/unmerge — { reason }. Admins only.
router.post('/duplicates/:caseId/unmerge', protect, restrictTo(...MERGERS), async (req, res) => {
  try {
    const caseId = posInt(req.params.caseId);
    const reason = text(req.body.reason);
    if (!caseId) return fail(res, 404, 'Merge case not found.');
    if (!reason) return fail(res, 400, 'Say why the merge was wrong.');
    const [row] = await select('SELECT unmerge_patients(:caseId, :userId, :reason) AS restored', { caseId, userId: req.user.id, reason });
    await logAction(req.user.id, 'UPDATE', 'patient', null, null, { action: 'unmerged', caseId, restored: Number(row.restored) }, req.ip);
    res.json({ success: true, message: `Unmerged. ${row.restored} record(s) returned.`, data: { restored: Number(row.restored) } });
  } catch (err) {
    const refusal = sqlRefusal(err);
    if (refusal) return fail(res, refusal.status, refusal.message);
    console.error('Unmerge failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not unmerge the records.' });
  }
});

module.exports = { router, proposeForPatient };
