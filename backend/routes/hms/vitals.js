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

function generateAlerts(v) {
  const alerts = [];
  if (v.bp_systolic > 140 || v.bp_diastolic > 90) alerts.push('High BP');
  if (v.bp_systolic < 90 || v.bp_diastolic < 60) alerts.push('Low BP');
  if ((v.temp_unit === 'C' && v.temperature > 37.5) || (v.temp_unit === 'F' && v.temperature > 99.5)) alerts.push('Fever');
  if (v.spo2 < 95) alerts.push('Low SpO2');
  if (v.pulse > 100) alerts.push('Tachycardia');
  if (v.pulse < 60) alerts.push('Bradycardia');
  if (v.bmi > 25) alerts.push('Overweight');
  return alerts.length > 0 ? JSON.stringify(alerts) : null;
}

// POST /api/hms/vitals
router.post('/', protect, async (req, res) => {
  try {
    const { patient_id, encounter_type, bp_systolic, bp_diastolic, temperature, temp_unit, weight_kg, height_cm, spo2, pulse, respiratory_rate } = req.body;
    
    if (!patient_id) return res.status(400).json({ success: false, message: 'Patient ID required.' });

    const bmi = computeBMI(weight_kg, height_cm);
    
    const vitalData = {
      patient_id, encounter_type, bp_systolic, bp_diastolic, temperature, 
      temp_unit: temp_unit || 'C', weight_kg, height_cm, bmi, spo2, pulse, respiratory_rate,
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
