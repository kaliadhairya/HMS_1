const express = require('express');
const router = express.Router();
const { Vital, Patient, User, sequelize } = require('../../models');
const { protect } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

function computeBMI(weight_kg, height_cm) {
  if (!weight_kg || !height_cm) return null;
  const height_m = height_cm / 100;
  return Number((weight_kg / (height_m * height_m)).toFixed(2));
}

// A value counts only when it was actually measured. Without this, a blank field (null) compared
// as 0 and raised "Low BP", "Low SpO2" and "Bradycardia" for vitals nobody recorded.
const has = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

function generateAlerts(v) {
  const alerts = [];
  const num = (value) => Number(value);
  if ((has(v.bp_systolic) && num(v.bp_systolic) > 140) || (has(v.bp_diastolic) && num(v.bp_diastolic) > 90)) alerts.push('High BP');
  if ((has(v.bp_systolic) && num(v.bp_systolic) < 90) || (has(v.bp_diastolic) && num(v.bp_diastolic) < 60)) alerts.push('Low BP');
  if (has(v.temperature) && ((v.temp_unit === 'C' && num(v.temperature) > 37.5) || (v.temp_unit === 'F' && num(v.temperature) > 99.5))) alerts.push('Fever');
  if (has(v.spo2) && num(v.spo2) < 95) alerts.push('Low SpO2');
  if (has(v.pulse) && num(v.pulse) > 100) alerts.push('Tachycardia');
  if (has(v.pulse) && num(v.pulse) < 60) alerts.push('Bradycardia');
  if (has(v.bmi) && num(v.bmi) > 25) alerts.push('Overweight');
  return alerts.length > 0 ? JSON.stringify(alerts) : null;
}

// Physiologically possible ranges. A value outside them is a typing or unit mistake
// (e.g. 98.6 entered with the unit set to °C), so it is rejected rather than stored.
const VITAL_LIMITS = {
  bp_systolic: [40, 300, 'Systolic BP'],
  bp_diastolic: [20, 200, 'Diastolic BP'],
  pulse: [20, 250, 'Pulse'],
  spo2: [40, 100, 'SpO2'],
  respiratory_rate: [4, 80, 'Respiratory rate'],
  weight_kg: [0.3, 400, 'Weight'],
  height_cm: [20, 260, 'Height'],
};
const TEMP_LIMITS = { C: [30, 45], F: [86, 113] };

function validateVitals(body) {
  for (const [key, [min, max, label]] of Object.entries(VITAL_LIMITS)) {
    const value = body[key];
    if (value === null || value === undefined || value === '') continue;
    if (!has(value)) return `${label} must be a number.`;
    if (Number(value) < min || Number(value) > max) return `${label} must be between ${min} and ${max}.`;
  }
  if (body.temperature !== null && body.temperature !== undefined && body.temperature !== '') {
    if (!has(body.temperature)) return 'Temperature must be a number.';
    const [min, max] = TEMP_LIMITS[body.temp_unit];
    const t = Number(body.temperature);
    if (t < min || t > max) return `Temperature in °${body.temp_unit} must be between ${min} and ${max}. Check the unit.`;
  }
  return null;
}

const blankToNull = (value) => (value === '' || value === undefined ? null : value);

// POST /api/hms/vitals
router.post('/', protect, async (req, res) => {
  try {
    const { patient_id, encounter_type } = req.body;
    const [bp_systolic, bp_diastolic, temperature, weight_kg, height_cm, spo2, pulse, respiratory_rate] = [
      'bp_systolic', 'bp_diastolic', 'temperature', 'weight_kg', 'height_cm', 'spo2', 'pulse', 'respiratory_rate',
    ].map((key) => blankToNull(req.body[key]));
    const temp_unit = String(req.body.temp_unit || 'C').toUpperCase();

    if (!patient_id) return res.status(400).json({ success: false, message: 'Patient ID required.' });
    if (!TEMP_LIMITS[temp_unit]) return res.status(400).json({ success: false, message: 'Temperature unit must be C or F.' });
    if ([bp_systolic, bp_diastolic, temperature, weight_kg, height_cm, spo2, pulse, respiratory_rate].every((v) => v === null)) {
      return res.status(400).json({ success: false, message: 'Enter at least one vital sign.' });
    }
    const invalid = validateVitals({ bp_systolic, bp_diastolic, temperature, temp_unit, weight_kg, height_cm, spo2, pulse, respiratory_rate });
    if (invalid) return res.status(400).json({ success: false, message: invalid });

    const bmi = computeBMI(weight_kg, height_cm);

    const vitalData = {
      patient_id, encounter_type, bp_systolic, bp_diastolic, temperature,
      temp_unit, weight_kg, height_cm, bmi, spo2, pulse, respiratory_rate,
      recorded_by: req.user.id
    };

    vitalData.alerts = generateAlerts(vitalData);

    // Generate ID from database sequence
    const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_vitals_seq') AS \"NEXTVAL\"");
    vitalData.id = nextId;

    const vital = await Vital.create(vitalData);

    await logAction(req.user.id, 'CREATE', 'vitals', vital.id, null, { bmi, alerts: vitalData.alerts }, req.ip);

    res.status(201).json({ success: true, message: 'Vitals recorded successfully.', data: vital });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error recording vitals.' });
  }
});

// GET /api/hms/vitals/latest/:patient_id
router.get('/latest/:patient_id', protect, async (req, res) => {
  try {
    const { sequelize } = require('../../models');
    const [rows] = await sequelize.query(`
      SELECT v.*, u.NAME as RECORDED_BY_NAME, u.ROLE as RECORDED_BY_ROLE
      FROM HMS_VITALS v
      LEFT JOIN HMS_USERS u ON u.ID = v.RECORDED_BY
      WHERE v.PATIENT_ID = :pid
      ORDER BY v.RECORDED_AT DESC
      LIMIT 1
    `, { replacements: { pid: req.params.patient_id } });

    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/hms/vitals/history/:patient_id
router.get('/history/:patient_id', protect, async (req, res) => {
  try {
    const { sequelize } = require('../../models');
    const [rows] = await sequelize.query(`
      SELECT v.*, u.NAME as RECORDED_BY_NAME, u.ROLE as RECORDED_BY_ROLE
      FROM HMS_VITALS v
      LEFT JOIN HMS_USERS u ON u.ID = v.RECORDED_BY
      WHERE v.PATIENT_ID = :pid
      ORDER BY v.RECORDED_AT DESC
    `, { replacements: { pid: req.params.patient_id } });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
