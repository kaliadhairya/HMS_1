const express = require('express');
const router = express.Router();
const { Vital, Patient, User, sequelize } = require('../../models');
const { protect, restrictTo } = require('../../middleware/auth');
const { requireClinicalPrivilege } = require('../../middleware/clinicalPrivilege');
const { logAction } = require('../../utils/auditLogger');

function computeBMI(weight_kg, height_cm) {
  if (!weight_kg || !height_cm) return null;
  const height_m = height_cm / 100;
  return Number((weight_kg / (height_m * height_m)).toFixed(2));
}

// A value counts only when it was actually measured. Without this, a blank field (null) compared
// as 0 and raised "Low BP", "Low SpO2" and "Bradycardia" for vitals nobody recorded.
const has = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));

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
router.post('/', protect, restrictTo('super_admin', 'doctor', 'nurse'), requireClinicalPrivilege('CHART_READ', { patientIdFrom: (req) => req.body.patient_id }), async (req, res) => {
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

    // The hospital has not supplied an approved observation protocol; do not
    // infer alert labels from universal hard-coded thresholds.

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

// The normalized observation tables are canonical. This legacy endpoint keeps
// the established response shape while projecting the shared chart.
// GET /api/hms/vitals/latest/:patient_id
router.get('/latest/:patient_id', protect, restrictTo('super_admin', 'admin', 'doctor', 'nurse'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT v.id,v.patient_id,v.encounter_id AS reference_id,'OPD'::text AS encounter_type,
             v.bp_systolic,v.bp_diastolic,v.temperature,
             CASE WHEN v.temp_unit='C' THEN 'C' ELSE 'F' END AS temp_unit,
             v.weight_kg,v.height_cm,v.bmi,v.spo2,v.pulse,v.respiratory_rate,
             NULL::text AS alerts,v.recorded_by,v.recorded_at,
             u.name AS recorded_by_name,u.role AS recorded_by_role
      FROM hms_observation_legacy_vitals v
      LEFT JOIN hms_users u ON u.id = v.recorded_by
      WHERE v.patient_id = :pid AND v.facility_id=:facility AND v.admission_id IS NULL
      ORDER BY v.recorded_at DESC,v.id DESC
      LIMIT 1
    `, { replacements: { pid: req.params.patient_id,facility:req.user.facilityId } });

    res.json({ success: true, data: rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/hms/vitals/history/:patient_id
router.get('/history/:patient_id', protect, restrictTo('super_admin', 'admin', 'doctor', 'nurse', 'receptionist'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT v.id,v.patient_id,v.encounter_id AS reference_id,'OPD'::text AS encounter_type,
             v.bp_systolic,v.bp_diastolic,v.temperature,
             CASE WHEN v.temp_unit='C' THEN 'C' ELSE 'F' END AS temp_unit,
             v.weight_kg,v.height_cm,v.bmi,v.spo2,v.pulse,v.respiratory_rate,
             NULL::text AS alerts,v.recorded_by,v.recorded_at,
             u.name AS recorded_by_name,u.role AS recorded_by_role
      FROM hms_observation_legacy_vitals v
      LEFT JOIN hms_users u ON u.id = v.recorded_by
      WHERE v.patient_id = :pid AND v.facility_id=:facility AND v.admission_id IS NULL
      ORDER BY v.recorded_at DESC,v.id DESC
    `, { replacements: { pid: req.params.patient_id,facility:req.user.facilityId } });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
