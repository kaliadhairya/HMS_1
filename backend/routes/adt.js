const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { canMoveBed, openOccupancy, closeOccupancy } = require('../utils/adt');
const { patientInCare, NOT_IN_CARE } = require('../utils/careTeam');
const { conflictResponse } = require('../utils/dbErrors');

// Admission, transfer and discharge (migration 0017). Mounted at /api/adt.
const router = express.Router();
const WARD_STAFF = ['super_admin', 'admin', 'nurse', 'doctor'];
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const text = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

// POST /api/adt/admissions/:id/transfer — move an inpatient to another bed. The
// old bed is sent to cleaning; the new bed is occupied; history is kept.
router.post('/admissions/:id/transfer', protect, restrictTo(...WARD_STAFF), async (req, res) => {
  try {
    const admissionId = posInt(req.params.id);
    const toBedId = posInt(req.body.toBedId);
    const reason = text(req.body.reason);
    if (!admissionId) return fail(res, 404, 'Admission not found.');
    if (!toBedId) return fail(res, 400, 'Choose the bed to move to.');
    if (!reason || reason.length < 5) return fail(res, 400, 'Say why the patient is being moved.');
    const result = await sequelize.transaction(async (transaction) => {
      const [adm] = await select("SELECT id, patient_id, bed_id, status FROM hms_admissions WHERE id = :admissionId FOR UPDATE", { admissionId }, transaction);
      if (!adm) return { status: 404, message: 'Admission not found.' };
      if (adm.status !== 'Active') return { status: 409, message: 'Only an active admission can be moved.' };
      if (!adm.bed_id) return { status: 409, message: 'This admission is not in a bed.' };
      if (Number(adm.bed_id) === toBedId) return { status: 409, message: 'The patient is already in that bed.' };
      // Lock both beds in id order so concurrent moves cannot deadlock.
      const beds = await select('SELECT id, status, is_active, bed_number FROM hms_beds WHERE id IN (:a, :b) ORDER BY id FOR UPDATE', { a: Number(adm.bed_id), b: toBedId }, transaction);
      const from = beds.find((b) => Number(b.id) === Number(adm.bed_id));
      const to = beds.find((b) => Number(b.id) === toBedId);
      if (!to) return { status: 404, message: 'Bed not found.' };
      if (Number(to.is_active) !== 1 || to.status !== 'Available') return { status: 409, message: `Bed ${to.bed_number} is not ready (${Number(to.is_active) !== 1 ? 'inactive' : to.status}).` };
      await closeOccupancy(sequelize, { admissionId, reason: `transferred: ${reason}`, transaction });
      await sequelize.query("UPDATE hms_beds SET status = 'Dirty' WHERE id = :id", { replacements: { id: from.id }, transaction });
      await sequelize.query("UPDATE hms_beds SET status = 'Occupied' WHERE id = :id", { replacements: { id: toBedId }, transaction });
      await sequelize.query('UPDATE hms_admissions SET bed_id = :toBedId WHERE id = :admissionId', { replacements: { toBedId, admissionId }, transaction });
      await openOccupancy(sequelize, { bedId: toBedId, admissionId, userId: req.user.id, reason: `transfer: ${reason}`, transaction });
      return { from: Number(from.id), to: toBedId, patientId: adm.patient_id };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'admission', admissionId, { bed: result.from }, { bed: result.to, reason }, req.ip);
    res.json({ success: true, message: 'Patient moved. The previous bed is being cleaned.', data: result });
  } catch (err) {
    const conflict = conflictResponse(err, { exclusion: 'That bed is already occupied for this period.' });
    if (conflict) return fail(res, conflict.status, conflict.message);
    console.error('Transfer failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not move the patient.' });
  }
});

// POST /api/adt/beds/:id/status — cleaning and out-of-service, following the lifecycle.
router.post('/beds/:id/status', protect, restrictTo('super_admin', 'admin', 'nurse'), async (req, res) => {
  try {
    const bedId = posInt(req.params.id);
    const to = text(req.body.status, 20);
    const reason = text(req.body.reason, 300);
    if (!bedId) return fail(res, 404, 'Bed not found.');
    if (!to) return fail(res, 400, 'Give the new status.');
    const result = await sequelize.transaction(async (transaction) => {
      const [bed] = await select('SELECT id, status, bed_number FROM hms_beds WHERE id = :bedId FOR UPDATE', { bedId }, transaction);
      if (!bed) return { status: 404, message: 'Bed not found.' };
      if (bed.status === 'Occupied') return { status: 409, message: 'An occupied bed changes status when the patient leaves.' };
      if (!canMoveBed(bed.status, to)) return { status: 409, message: `A bed cannot go from ${bed.status} to ${to}.` };
      if (to === 'OutOfService' && !reason) return { status: 400, message: 'Say why the bed is out of service.' };
      await select('UPDATE hms_beds SET status = :to WHERE id = :bedId', { to, bedId }, transaction);
      return { from: bed.status };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'bed', bedId, { status: result.from }, { status: to, reason }, req.ip);
    res.json({ success: true, message: `Bed is now ${to}.` });
  } catch (err) {
    if (err.original?.code === '23514') return fail(res, 409, 'That status is not allowed for a bed.');
    console.error('Bed status failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not change the bed status.' });
  }
});

// GET /api/adt/admissions/:id/occupancies — the bed history of one admission.
router.get('/admissions/:id/occupancies', protect, restrictTo(...WARD_STAFF, 'receptionist'), async (req, res) => {
  try {
    const rows = await select(
      `SELECT o.bed_id, b.bed_number, b.room_number, o.starts_at, o.ends_at, o.reason
         FROM hms_bed_occupancies o JOIN hms_beds b ON b.id = o.bed_id
        WHERE o.admission_id = :admissionId ORDER BY o.starts_at`,
      { admissionId: posInt(req.params.id) || 0 }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Occupancy list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the bed history.' });
  }
});

// GET /api/adt/admissions/:id/discharge-plan
router.get('/admissions/:id/discharge-plan', protect, restrictTo(...WARD_STAFF, 'receptionist'), async (req, res) => {
  try {
    const [plan] = await select(
      `SELECT p.*, ru.name AS results_owner_name, fu.name AS follow_up_owner_name, cu.name AS clinical_ready_by_name, lu.name AS cleared_by_name
         FROM hms_discharge_plans p
         LEFT JOIN hms_users ru ON ru.id = p.results_owner_user_id
         LEFT JOIN hms_users fu ON fu.id = p.follow_up_owner_user_id
         LEFT JOIN hms_users cu ON cu.id = p.clinical_ready_by
         LEFT JOIN hms_users lu ON lu.id = p.cleared_by
        WHERE p.admission_id = :admissionId`,
      { admissionId: posInt(req.params.id) || 0 }
    );
    res.json({ success: true, data: plan || null });
  } catch (err) {
    console.error('Plan read failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the discharge plan.' });
  }
});

// PUT /api/adt/admissions/:id/discharge-plan — doctors (in care) record the plan.
router.put('/admissions/:id/discharge-plan', protect, restrictTo('doctor', 'super_admin', 'admin'), async (req, res) => {
  try {
    const admissionId = posInt(req.params.id);
    if (!admissionId) return fail(res, 404, 'Admission not found.');
    const pending = text(req.body.pendingResults, 1000);
    const resultsOwner = req.body.resultsOwnerUserId ? posInt(req.body.resultsOwnerUserId) : null;
    if (pending && !resultsOwner) return fail(res, 422, 'Pending results need a named owner after discharge.');
    const result = await sequelize.transaction(async (transaction) => {
      const [adm] = await select('SELECT id, patient_id, status FROM hms_admissions WHERE id = :admissionId FOR UPDATE', { admissionId }, transaction);
      if (!adm) return { status: 404, message: 'Admission not found.' };
      if (adm.status !== 'Active') return { status: 409, message: 'The admission is no longer active.' };
      if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, adm.patient_id, transaction))) return { status: 403, message: NOT_IN_CARE, code: 'PATIENT_NOT_IN_CARE' };
      const [row] = await select(
        `INSERT INTO hms_discharge_plans (admission_id, destination, instructions, pending_results, results_owner_user_id, follow_up_owner_user_id, updated_at)
         VALUES (:admissionId, :destination, :instructions, :pending, :resultsOwner, :followUp, now())
         ON CONFLICT (admission_id) DO UPDATE SET destination = EXCLUDED.destination, instructions = EXCLUDED.instructions,
           pending_results = EXCLUDED.pending_results, results_owner_user_id = EXCLUDED.results_owner_user_id,
           follow_up_owner_user_id = EXCLUDED.follow_up_owner_user_id, updated_at = now()
         RETURNING id, admission_id, financial_clearance, clinical_ready_at`,
        { admissionId, destination: text(req.body.destination, 200), instructions: text(req.body.instructions, 2000), pending, resultsOwner, followUp: req.body.followUpOwnerUserId ? posInt(req.body.followUpOwnerUserId) : null },
        transaction
      );
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message, result.code);
    res.json({ success: true, data: result.row });
  } catch (err) {
    const conflict = conflictResponse(err, { unique: 'A plan already exists for this admission.' });
    if (conflict) return fail(res, conflict.status, conflict.message);
    console.error('Plan save failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not save the discharge plan.' });
  }
});

// POST /api/adt/admissions/:id/discharge-plan/clinically-ready — the doctor's readiness is separate from billing.
router.post('/admissions/:id/discharge-plan/clinically-ready', protect, restrictTo('doctor', 'super_admin', 'admin'), async (req, res) => {
  try {
    const admissionId = posInt(req.params.id);
    const [row] = await select(
      `UPDATE hms_discharge_plans SET clinical_ready_at = now(), clinical_ready_by = :userId, updated_at = now()
        WHERE admission_id = :admissionId AND clinical_ready_at IS NULL RETURNING id`,
      { admissionId: admissionId || 0, userId: req.user.id }
    );
    if (!row) return fail(res, 404, 'No discharge plan to mark ready, or it is already ready.');
    res.json({ success: true, message: 'Marked clinically ready for discharge.' });
  } catch (err) {
    if (err.original?.code === '23514') return fail(res, 422, 'Pending results need a named owner before the plan is ready.');
    console.error('Ready failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not mark the plan ready.' });
  }
});

// POST /api/adt/admissions/:id/discharge-plan/cleared — financial clearance, recorded separately.
router.post('/admissions/:id/discharge-plan/cleared', protect, restrictTo('super_admin', 'admin', 'receptionist'), async (req, res) => {
  try {
    const admissionId = posInt(req.params.id);
    const [row] = await select(
      `UPDATE hms_discharge_plans SET financial_clearance = 'cleared', cleared_by = :userId, cleared_at = now(), updated_at = now()
        WHERE admission_id = :admissionId AND financial_clearance = 'pending' RETURNING id`,
      { admissionId: admissionId || 0, userId: req.user.id }
    );
    if (!row) return fail(res, 404, 'No discharge plan awaiting clearance.');
    res.json({ success: true, message: 'Financial clearance recorded.' });
  } catch (err) {
    console.error('Clearance failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the clearance.' });
  }
});

module.exports = router;
