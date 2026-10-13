const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { patientInCare, ensureCareTeam, NOT_IN_CARE } = require('../utils/careTeam');
const { conflictResponse } = require('../utils/dbErrors');

// Referrals with acknowledged handoffs (migration 0018). Mounted at /api/referrals.
// The receiving clinician accepts (joining the care team), then records the
// outcome. A referral can also be closed with a documented reason.
const router = express.Router();
const DOCTORS = ['doctor'];
const URGENCY = new Set(['routine', 'urgent', 'emergency']);
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const text = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

const SHAPE = `r.id, r.patient_id, p.name AS patient_name, p.uhid, r.from_doctor_id, r.to_user_id, tu.name AS to_clinician,
  r.to_specialty, r.hospital, r.reason, r.urgency, r.status, r.due_at, r.created_at,
  r.acknowledged_at, r.outcome, r.completed_at, r.closed_reason, r.closed_at,
  (r.status IN ('Pending', 'Acknowledged') AND r.due_at IS NOT NULL AND r.due_at < now()) AS overdue`;

async function loadReferral(id, transaction, lock = false) {
  const [row] = await select(`SELECT id, patient_id, from_doctor_id, to_user_id, status FROM hms_referrals WHERE id = :id ${lock ? 'FOR UPDATE' : ''}`, { id }, transaction);
  return row || null;
}

// POST /api/referrals — raise a referral for a patient in the sender's care.
router.post('/', protect, restrictTo(...DOCTORS), async (req, res) => {
  try {
    const patientId = posInt(req.body.patientId);
    const toUserId = req.body.toUserId ? posInt(req.body.toUserId) : null;
    const toSpecialty = text(req.body.toSpecialty, 100);
    const reason = text(req.body.reason, 1000);
    const urgency = URGENCY.has(req.body.urgency) ? req.body.urgency : 'routine';
    const dueHours = req.body.dueHours ? Number(req.body.dueHours) : null;
    if (!patientId) return fail(res, 400, 'Choose the patient.');
    if (!toUserId && !toSpecialty) return fail(res, 400, 'Name the receiving doctor or the specialty.');
    if (!reason || reason.length < 5) return fail(res, 400, 'Say why the patient is being referred.');
    if (dueHours !== null && (!Number.isInteger(dueHours) || dueHours < 1 || dueHours > 720)) return fail(res, 400, 'Due within 1 to 720 hours.');
    if (!(await patientInCare(req.user.id, patientId))) return fail(res, 403, NOT_IN_CARE, 'PATIENT_NOT_IN_CARE');
    if (toUserId) {
      const [receiver] = await select("SELECT id FROM hms_users WHERE id = :toUserId AND role = 'doctor' AND is_active = 1", { toUserId });
      if (!receiver) return fail(res, 400, 'The receiving doctor must be an active doctor on this system.');
    }
    const [sender] = await select('SELECT id FROM hms_doctors WHERE user_id = :userId', { userId: req.user.id });
    const result = await sequelize.transaction(async (transaction) => {
      const [row] = await select(
        `INSERT INTO hms_referrals (patient_id, from_doctor_id, to_user_id, to_specialty, reason, urgency, due_at, status, referral_type, created_at, updated_at)
         VALUES (:patientId, :fromDoctorId, :toUserId, :toSpecialty, :reason, :urgency, CASE WHEN :dueHours IS NULL THEN NULL ELSE now() + make_interval(hours => :dueHours) END,
                 'Pending', 'internal', now(), now())
         RETURNING id, status, due_at`,
        { patientId, fromDoctorId: sender?.id ?? null, toUserId, toSpecialty, reason, urgency, dueHours }, transaction
      );
      return row;
    });
    await logAction(req.user.id, 'CREATE', 'referral', result.id, null, { toUserId, toSpecialty, urgency }, req.ip);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    const conflict = conflictResponse(err);
    if (conflict) return fail(res, conflict.status, conflict.message);
    console.error('Referral create failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not raise the referral.' });
  }
});

// GET /api/referrals?box=incoming|outgoing — what is waiting for me, or what I sent.
router.get('/', protect, restrictTo(...DOCTORS, 'admin', 'super_admin'), async (req, res) => {
  try {
    const box = req.query.box === 'outgoing' ? 'outgoing' : 'incoming';
    const [sender] = await select('SELECT id FROM hms_doctors WHERE user_id = :userId', { userId: req.user.id });
    const rows = await select(
      `SELECT ${SHAPE} FROM hms_referrals r
         JOIN hms_patients p ON p.id = r.patient_id
         LEFT JOIN hms_users tu ON tu.id = r.to_user_id
        WHERE ${box === 'incoming' ? 'r.to_user_id = :userId' : 'r.from_doctor_id = :senderId'}
        ORDER BY (r.status IN ('Pending', 'Acknowledged')) DESC, r.due_at NULLS LAST, r.created_at DESC
        LIMIT 200`,
      { userId: req.user.id, senderId: sender?.id ?? -1 }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Referral list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load referrals.' });
  }
});

// POST /api/referrals/:id/acknowledge — the receiving clinician accepts the patient.
router.post('/:id/acknowledge', protect, restrictTo(...DOCTORS), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const result = await sequelize.transaction(async (transaction) => {
      const ref = id ? await loadReferral(id, transaction, true) : null;
      if (!ref) return { status: 404, message: 'Referral not found.' };
      if (Number(ref.to_user_id) !== req.user.id) return { status: 403, message: 'Only the receiving clinician can acknowledge this referral.' };
      if (ref.status !== 'Pending') return { status: 409, message: `This referral is already ${ref.status.toLowerCase()}.` };
      await select(
        "UPDATE hms_referrals SET status = 'Acknowledged', acknowledged_by = :userId, acknowledged_at = now(), updated_at = now() WHERE id = :id",
        { userId: req.user.id, id }, transaction
      );
      // Accepting the referral makes the receiving clinician part of the patient's care.
      await ensureCareTeam(req.user.id, ref.patient_id, transaction);
      return { ok: true };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'referral', id, { status: 'Pending' }, { status: 'Acknowledged' }, req.ip);
    res.json({ success: true, message: 'Referral accepted. The patient is now in your care.' });
  } catch (err) {
    console.error('Acknowledge failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not accept the referral.' });
  }
});

// POST /api/referrals/:id/complete — the receiving clinician records the outcome.
router.post('/:id/complete', protect, restrictTo(...DOCTORS), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const outcome = text(req.body.outcome, 2000);
    if (!outcome || outcome.length < 5) return fail(res, 400, 'Record the outcome of the referral.');
    const result = await sequelize.transaction(async (transaction) => {
      const ref = id ? await loadReferral(id, transaction, true) : null;
      if (!ref) return { status: 404, message: 'Referral not found.' };
      if (Number(ref.to_user_id) !== req.user.id) return { status: 403, message: 'Only the receiving clinician can complete this referral.' };
      if (ref.status !== 'Acknowledged') return { status: 409, message: 'Accept the referral before recording its outcome.' };
      await select(
        "UPDATE hms_referrals SET status = 'Completed', outcome = :outcome, completed_by = :userId, completed_at = now(), updated_at = now() WHERE id = :id",
        { outcome, userId: req.user.id, id }, transaction
      );
      return { ok: true };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'referral', id, { status: 'Acknowledged' }, { status: 'Completed' }, req.ip);
    res.json({ success: true, message: 'Referral completed.' });
  } catch (err) {
    console.error('Complete failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not complete the referral.' });
  }
});

// POST /api/referrals/:id/close — a documented closure without the receiving action
// (the patient did not attend, or it was handled elsewhere). Sender or an admin.
router.post('/:id/close', protect, restrictTo(...DOCTORS, 'admin', 'super_admin'), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const reason = text(req.body.reason, 1000);
    if (!reason || reason.length < 5) return fail(res, 400, 'Document why the referral is closed.');
    const result = await sequelize.transaction(async (transaction) => {
      const ref = id ? await loadReferral(id, transaction, true) : null;
      if (!ref) return { status: 404, message: 'Referral not found.' };
      const [sender] = await select('SELECT id FROM hms_doctors WHERE user_id = :userId', { userId: req.user.id }, transaction);
      const isSender = sender && Number(sender.id) === Number(ref.from_doctor_id);
      const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
      if (!isSender && !isAdmin) return { status: 403, message: 'Only the sending doctor or an administrator can close this referral.' };
      if (ref.status === 'Completed' || ref.status === 'Closed') return { status: 409, message: `This referral is already ${ref.status.toLowerCase()}.` };
      await select(
        "UPDATE hms_referrals SET status = 'Closed', closed_reason = :reason, closed_by = :userId, closed_at = now(), updated_at = now() WHERE id = :id",
        { reason, userId: req.user.id, id }, transaction
      );
      return { ok: true };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'referral', id, null, { status: 'Closed', reason }, req.ip);
    res.json({ success: true, message: 'Referral closed with a documented reason.' });
  } catch (err) {
    console.error('Close failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not close the referral.' });
  }
});

module.exports = router;
