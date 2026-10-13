const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { requirePatientInCare, ensureCareTeam } = require('../utils/careTeam');

// Care teams and break-glass access (migration 0014). Mounted at /api/patients
// before the patient-scope guard, so break-glass can be requested by a doctor
// who is not yet in care.
const router = express.Router();
const DESK = ['super_admin', 'admin', 'receptionist'];
const ADMINS = ['super_admin', 'admin'];
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const text = (v, max = 300) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// GET /api/patients/hms/:id/care-team
router.get('/hms/:id/care-team', protect, restrictTo(...DESK, 'doctor'), requirePatientInCare, async (req, res) => {
  try {
    const id = posInt(req.params.id);
    if (!id) return fail(res, 404, 'Patient not found.');
    const rows = await select(
      `SELECT c.id, c.practitioner_user_id, u.name AS practitioner_name, c.role, c.valid_from, c.valid_to, c.ended_reason
         FROM hms_care_team_assignments c JOIN hms_users u ON u.id = c.practitioner_user_id
        WHERE c.patient_id = :id ORDER BY c.valid_to IS NULL DESC, c.valid_from`,
      { id }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Care team list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the care team.' });
  }
});

// POST /api/patients/hms/:id/care-team — add a doctor to the team (front desk or admin).
router.post('/hms/:id/care-team', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const userId = posInt(req.body.practitionerUserId);
    const role = ['primary', 'consulting', 'covering'].includes(req.body.role) ? req.body.role : 'consulting';
    if (!id || !userId) return fail(res, 400, 'Choose a patient and a doctor.');
    const [doctor] = await select("SELECT id FROM hms_users WHERE id = :userId AND role = 'doctor' AND is_active = 1", { userId });
    if (!doctor) return fail(res, 400, 'Only an active doctor can be added to a care team.');
    const [dup] = await select('SELECT id FROM hms_care_team_assignments WHERE patient_id = :id AND practitioner_user_id = :userId AND valid_to IS NULL', { id, userId });
    if (dup) return fail(res, 409, 'This doctor is already on the care team.');
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(
        `INSERT INTO hms_care_team_assignments (patient_id, practitioner_user_id, role, assigned_by)
         VALUES (:id, :userId, :role, :assigner)`,
        { replacements: { id, userId, role, assigner: req.user.id }, transaction }
      );
    });
    await logAction(req.user.id, 'CREATE', 'care_team', id, null, { practitionerUserId: userId, role }, req.ip);
    res.status(201).json({ success: true, message: 'Added to the care team.' });
  } catch (err) {
    console.error('Care team add failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not add to the care team.' });
  }
});

// POST /api/patients/hms/:id/care-team/:assignmentId/end — admins, with a reason.
router.post('/hms/:id/care-team/:assignmentId/end', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const reason = text(req.body.reason);
    if (!reason) return fail(res, 400, 'Say why this doctor leaves the care team.');
    const [row] = await select(
      `UPDATE hms_care_team_assignments SET valid_to = now(), ended_by = :userId, ended_reason = :reason
        WHERE id = :assignmentId AND patient_id = :id AND valid_to IS NULL RETURNING id`,
      { userId: req.user.id, reason, assignmentId: posInt(req.params.assignmentId) || 0, id: posInt(req.params.id) || 0 }
    );
    if (!row) return fail(res, 404, 'No current care-team place like that.');
    res.json({ success: true, message: 'Removed from the care team.' });
  } catch (err) {
    console.error('Care team end failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not remove from the care team.' });
  }
});

// POST /api/patients/hms/:id/break-glass — a doctor who is not in care may open
// one patient's record for one hour, with a reason. Every read is audited, and
// the access is listed for review.
router.post('/hms/:id/break-glass', protect, restrictTo('doctor'), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const reason = text(req.body.reason, 500);
    if (!id) return fail(res, 404, 'Patient not found.');
    if (!reason || reason.length < 10) return fail(res, 400, 'Give the clinical reason in a sentence (at least 10 characters).');
    const [patient] = await select('SELECT id FROM hms_patients WHERE id = :id', { id });
    if (!patient) return fail(res, 404, 'Patient not found.');
    const [row] = await select(
      `INSERT INTO hms_break_glass_access (user_id, patient_id, reason, expires_at)
       VALUES (:userId, :id, :reason, now() + interval '60 minutes') RETURNING id, expires_at`,
      { userId: req.user.id, id, reason }
    );
    await logAction(req.user.id, 'CREATE', 'break_glass', id, null, { reason }, req.ip);
    res.status(201).json({ success: true, message: 'Break-glass access granted for one hour. It is recorded for review.', data: row });
  } catch (err) {
    console.error('Break-glass failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not grant break-glass access.' });
  }
});

// GET /api/patients/break-glass?unreviewed=1 — administrators review access.
router.get('/break-glass', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const onlyOpen = req.query.unreviewed === '1';
    const rows = await select(
      `SELECT b.id, b.reason, b.granted_at, b.expires_at, b.reviewed_at, b.review_note, u.name AS clinician, p.uhid, p.name AS patient_name,
              EXISTS (SELECT 1 FROM hms_care_team_assignments c WHERE c.patient_id = b.patient_id AND c.practitioner_user_id = b.user_id AND c.valid_to IS NULL) AS on_care_team_now
         FROM hms_break_glass_access b JOIN hms_users u ON u.id = b.user_id JOIN hms_patients p ON p.id = b.patient_id
        ${onlyOpen ? 'WHERE b.reviewed_at IS NULL' : ''}
        ORDER BY b.granted_at DESC LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Break-glass list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load break-glass access.' });
  }
});

// POST /api/patients/break-glass/:id/review — an administrator records the outcome.
router.post('/break-glass/:id/review', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const note = text(req.body.note, 500);
    if (!note) return fail(res, 400, 'Record what the review found.');
    const [row] = await select(
      'UPDATE hms_break_glass_access SET reviewed_by = :userId, reviewed_at = now(), review_note = :note WHERE id = :id AND reviewed_at IS NULL RETURNING id',
      { userId: req.user.id, note, id: posInt(req.params.id) || 0 }
    );
    if (!row) return fail(res, 404, 'No open break-glass access like that.');
    res.json({ success: true, message: 'Review recorded.' });
  } catch (err) {
    console.error('Break-glass review failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the review.' });
  }
});

module.exports = router;
