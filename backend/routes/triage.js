const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { requireClinicalPrivilege } = require('../middleware/clinicalPrivilege');
const { logAction } = require('../utils/auditLogger');
const { conflictResponse } = require('../utils/dbErrors');

// Emergency arrivals and triage (migration 0015). Mounted at /api/triage.
// Triage is switched off until a clinician approves a protocol version; the
// arrival itself is always recordable, so emergency care never waits on it.
const router = express.Router();
const ARRIVALS = ['super_admin', 'admin', 'receptionist', 'nurse', 'doctor'];
const ASSESSORS = ['super_admin', 'admin', 'nurse', 'doctor'];
const CLINICAL = ['super_admin', 'admin', 'nurse', 'doctor', 'receptionist'];
const MODES = new Set(['walk_in', 'ambulance', 'referral', 'other']);
const DISPOSITIONS = new Set(['admitted', 'discharged', 'transferred', 'left']);
const ESCALATION_ROLES = new Set(['doctor', 'nurse', 'admin']);

const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const text = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

router.get('/protocols', protect, restrictTo(...CLINICAL), async (req, res) => {
  const rows = await select('SELECT protocol_key, version, title, status, approved_at FROM hms_triage_protocols ORDER BY protocol_key, version');
  res.json({ success: true, data: rows, triage_enabled: rows.some((r) => r.status === 'approved') });
});

// POST /api/triage/arrivals — a patient arrives for emergency care.
router.post('/arrivals', protect, restrictTo(...ARRIVALS), async (req, res) => {
  try {
    const patientId = posInt(req.body.patientId);
    const mode = MODES.has(req.body.arrivalMode) ? req.body.arrivalMode : null;
    if (!patientId) return fail(res, 400, 'Choose the patient.');
    if (!mode) return fail(res, 400, 'Arrival mode must be walk-in, ambulance, referral or other.');
    const [patient] = await select('SELECT id FROM hms_patients WHERE id = :patientId AND identity_status <> \'merged\'', { patientId });
    if (!patient) return fail(res, 404, 'Patient not found.');
    const [row] = await select(
      `INSERT INTO hms_emergency_arrivals (patient_id, arrival_mode, chief_complaint, created_by)
       VALUES (:patientId, :mode, :complaint, :userId) RETURNING id, patient_id, arrived_at, arrival_mode, status`,
      { patientId, mode, complaint: text(req.body.chiefComplaint), userId: req.user.id }
    );
    res.status(201).json({ success: true, data: row });
  } catch (err) {
    const conflict = conflictResponse(err, { unique: 'This patient already has an open emergency arrival.' });
    if (conflict) return fail(res, conflict.status, conflict.message);
    console.error('Arrival failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the arrival.' });
  }
});

// GET /api/triage/board — open arrivals, most urgent first, with overdue reassessments and open escalations.
router.get('/board', protect, restrictTo(...CLINICAL), async (req, res) => {
  try {
    const rows = await select(
      `SELECT a.id, a.patient_id, p.name AS patient_name, p.uhid, p.age, p.gender, a.arrived_at, a.arrival_mode, a.chief_complaint, a.status,
              la.acuity_level, la.protocol_key, la.protocol_version, la.assessed_at, la.reassess_due_at,
              (la.reassess_due_at IS NOT NULL AND la.reassess_due_at < now()) AS reassessment_overdue,
              (la.id IS NULL) AS not_yet_assessed,
              (SELECT count(*) FROM hms_triage_escalations e WHERE e.arrival_id = a.id AND e.acknowledged_at IS NULL)::int AS open_escalations
         FROM hms_emergency_arrivals a
         JOIN hms_patients p ON p.id = a.patient_id
         LEFT JOIN LATERAL (
           SELECT t.* FROM hms_triage_assessments t WHERE t.arrival_id = a.id ORDER BY t.assessed_at DESC, t.id DESC LIMIT 1
         ) la ON TRUE
        WHERE a.status IN ('waiting', 'in_treatment')
        ORDER BY la.acuity_level ASC NULLS LAST, a.arrived_at ASC
        LIMIT 200`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Board failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the triage board.' });
  }
});

// POST /api/triage/arrivals/:id/assessments — a new assessment (never an edit).
router.post('/arrivals/:id/assessments', protect, restrictTo(...ASSESSORS), requireClinicalPrivilege('CHART_READ', { patientIdFrom: async (req) => {
  const [rows] = await sequelize.query('SELECT patient_id FROM hms_emergency_arrivals WHERE id = :id', { replacements: { id: Number(req.params.id) } });
  return rows && rows.length ? (rows[0].patient_id ?? rows[0].PATIENT_ID) : null;
} }), async (req, res) => {
  try {
    const arrivalId = posInt(req.params.id);
    const protocolKey = text(req.body.protocolKey, 40);
    const protocolVersion = posInt(req.body.protocolVersion);
    const acuity = Number(req.body.acuityLevel);
    const minutes = Number(req.body.reassessMinutes);
    const inputs = req.body.inputs && typeof req.body.inputs === 'object' && !Array.isArray(req.body.inputs) ? req.body.inputs : {};
    if (!arrivalId) return fail(res, 404, 'Arrival not found.');
    if (!protocolKey || !protocolVersion) return fail(res, 400, 'Choose the triage protocol and version.');
    if (!Number.isInteger(acuity) || acuity < 1 || acuity > 5) return fail(res, 400, 'Acuity level must be a whole number from 1 to 5.');
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return fail(res, 400, 'Reassess within 1 to 240 minutes.');
    if (JSON.stringify(inputs).length > 4000) return fail(res, 400, 'The inputs are too large.');

    const result = await sequelize.transaction(async (transaction) => {
      const [protocol] = await select('SELECT status FROM hms_triage_protocols WHERE protocol_key = :protocolKey AND version = :protocolVersion', { protocolKey, protocolVersion }, transaction);
      if (!protocol) return { status: 400, message: 'That protocol version does not exist.' };
      if (protocol.status !== 'approved') return { status: 409, message: 'Triage is switched off: no clinician has approved this protocol version yet.' };
      const [arrival] = await select("SELECT id FROM hms_emergency_arrivals WHERE id = :arrivalId AND status IN ('waiting', 'in_treatment') FOR UPDATE", { arrivalId }, transaction);
      if (!arrival) return { status: 404, message: 'No open arrival like that.' };
      const [row] = await select(
        `INSERT INTO hms_triage_assessments (arrival_id, protocol_key, protocol_version, acuity_level, inputs, assessed_by, reassess_due_at)
         VALUES (:arrivalId, :protocolKey, :protocolVersion, :acuity, CAST(:inputs AS jsonb), :userId, now() + make_interval(mins => :minutes))
         RETURNING id, acuity_level, assessed_at, reassess_due_at`,
        { arrivalId, protocolKey, protocolVersion, acuity, inputs: JSON.stringify(inputs), userId: req.user.id, minutes },
        transaction
      );
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'CREATE', 'triage', arrivalId, null, { acuity, protocolKey, protocolVersion }, req.ip);
    res.status(201).json({ success: true, data: result.row });
  } catch (err) {
    console.error('Assessment failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the assessment.' });
  }
});

// POST /api/triage/arrivals/:id/escalate — raise the case to a doctor, nurse or admin.
router.post('/arrivals/:id/escalate', protect, restrictTo(...ASSESSORS), requireClinicalPrivilege('CHART_READ', { patientIdFrom: async (req) => {
  const [rows] = await sequelize.query('SELECT patient_id FROM hms_emergency_arrivals WHERE id = :id', { replacements: { id: Number(req.params.id) } });
  return rows && rows.length ? (rows[0].patient_id ?? rows[0].PATIENT_ID) : null;
} }), async (req, res) => {
  try {
    const arrivalId = posInt(req.params.id);
    const reason = text(req.body.reason);
    const toRole = ESCALATION_ROLES.has(req.body.toRole) ? req.body.toRole : null;
    if (!arrivalId) return fail(res, 404, 'Arrival not found.');
    if (!reason || reason.length < 5) return fail(res, 400, 'Say why this is being escalated.');
    if (!toRole) return fail(res, 400, 'Escalate to a doctor, nurse or admin.');
    const [row] = await select(
      `INSERT INTO hms_triage_escalations (arrival_id, reason, to_role, raised_by)
       SELECT id, :reason, :toRole, :userId FROM hms_emergency_arrivals WHERE id = :arrivalId AND status IN ('waiting', 'in_treatment')
       RETURNING id`,
      { arrivalId, reason, toRole, userId: req.user.id }
    );
    if (!row) return fail(res, 404, 'No open arrival like that.');
    res.status(201).json({ success: true, data: { id: row.id } });
  } catch (err) {
    console.error('Escalation failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not escalate.' });
  }
});

// POST /api/triage/escalations/:id/acknowledge — by someone in the role it was sent to.
router.post('/escalations/:id/acknowledge', protect, restrictTo(...ASSESSORS), async (req, res) => {
  try {
    const id = posInt(req.params.id);
    const [e] = await select('SELECT to_role, acknowledged_at FROM hms_triage_escalations WHERE id = :id', { id: id || 0 });
    if (!e) return fail(res, 404, 'Escalation not found.');
    if (e.acknowledged_at) return fail(res, 409, 'Already acknowledged.');
    const allowed = req.user.role === e.to_role || ['super_admin', 'admin'].includes(req.user.role);
    if (!allowed) return fail(res, 403, `Only a ${e.to_role} can acknowledge this escalation.`);
    await select('UPDATE hms_triage_escalations SET acknowledged_by = :userId, acknowledged_at = now() WHERE id = :id', { userId: req.user.id, id });
    res.json({ success: true, message: 'Escalation acknowledged.' });
  } catch (err) {
    console.error('Acknowledge failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not acknowledge.' });
  }
});

// POST /api/triage/arrivals/:id/disposition — the patient leaves the emergency area.
// Needs at least one assessment and no unacknowledged escalation.
router.post('/arrivals/:id/disposition', protect, restrictTo('super_admin', 'admin', 'doctor'), async (req, res) => {
  try {
    const arrivalId = posInt(req.params.id);
    const status = DISPOSITIONS.has(req.body.status) ? req.body.status : null;
    const reason = text(req.body.reason);
    if (!arrivalId) return fail(res, 404, 'Arrival not found.');
    if (!status) return fail(res, 400, 'Disposition must be admitted, discharged, transferred or left.');
    if (!reason) return fail(res, 400, 'Say what was decided.');
    const result = await sequelize.transaction(async (transaction) => {
      const [arrival] = await select("SELECT id FROM hms_emergency_arrivals WHERE id = :arrivalId AND status IN ('waiting', 'in_treatment') FOR UPDATE", { arrivalId }, transaction);
      if (!arrival) return { status: 404, message: 'No open arrival like that.' };
      const [{ assessed }] = await select('SELECT count(*)::int AS assessed FROM hms_triage_assessments WHERE arrival_id = :arrivalId', { arrivalId }, transaction);
      if (!assessed) return { status: 409, message: 'Assess the patient before recording a disposition.' };
      const [{ open }] = await select('SELECT count(*)::int AS open FROM hms_triage_escalations WHERE arrival_id = :arrivalId AND acknowledged_at IS NULL', { arrivalId }, transaction);
      if (open) return { status: 409, message: 'An escalation has not been acknowledged yet.' };
      await select(
        'UPDATE hms_emergency_arrivals SET status = :status, closed_at = now(), closed_by = :userId, disposition_reason = :reason WHERE id = :arrivalId',
        { status, userId: req.user.id, reason, arrivalId }, transaction
      );
      return {};
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'UPDATE', 'triage', arrivalId, null, { disposition: status }, req.ip);
    res.json({ success: true, message: `Recorded: ${status}.` });
  } catch (err) {
    console.error('Disposition failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the disposition.' });
  }
});

module.exports = router;
