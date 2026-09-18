const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../../models/db');
const { Token, Patient, Doctor, Department, User } = require('../../models');
const { protect } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');

function tokenDateWhere(dateString) {
  return sequelize.where(
    sequelize.fn('TRUNC', sequelize.col('TOKEN_DATE')),
    sequelize.fn('TO_DATE', dateString, 'YYYY-MM-DD')
  );
}

// GET /api/hms/tokens — Fetch today's tokens for the logged-in doctor (dashboard)
router.get('/', protect, async (req, res) => {
  try {
    const userId = req.user.id;
    const doctors = await Doctor.findAll({ where: { user_id: userId } });
    const doctor = doctors.length > 0 ? doctors[0] : null;
    const doctorTableId = doctor ? doctor.id : null;

    // Query tokens using both the user ID and HMS_DOCTORS ID
    const doctorIds = [userId];
    if (doctorTableId && doctorTableId !== userId) doctorIds.push(doctorTableId);

    const today = new Date().toISOString().split('T')[0];
    const tokens = await Token.findAll({
      where: {
        doctor_id: { [Op.in]: doctorIds },
        [Op.and]: [tokenDateWhere(today)]
      },
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'uhid', 'name', 'first_name', 'last_name', 'age', 'gender'] },
        { model: Department, as: 'department', attributes: ['name'] }
      ],
      order: [['token_number', 'ASC']]
    });

    res.json({ success: true, data: tokens });
  } catch (err) {
    console.error('GET /api/hms/tokens error:', err);
    res.status(500).json({ success: false, message: 'Server error fetching tokens.' });
  }
});

// GET /api/hms/tokens/today-all — ALL today's tokens for all doctors (global OPD queue)
router.get('/today-all', protect, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { QueryTypes } = require('sequelize');

    const rows = await sequelize.query(`
      SELECT t.ID, t.TOKEN_NUMBER, t.STATUS, t.DOCTOR_ID, t.PATIENT_ID, t.TOKEN_DATE,
             p.NAME AS PATIENT_NAME, p.UHID, p.AGE, p.GENDER,
             u.NAME AS DOCTOR_NAME
      FROM HMS_TOKENS t
      LEFT JOIN HMS_PATIENTS p ON p.ID = t.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = t.DOCTOR_ID
      WHERE trunc(t.TOKEN_DATE) = TO_DATE(:today, 'YYYY-MM-DD')
      ORDER BY t.TOKEN_NUMBER ASC
    `, {
      replacements: { today },
      type: QueryTypes.SELECT
    });

    const data = rows.map(r => ({
      id: r.ID,
      token_number: r.TOKEN_NUMBER,
      status: r.STATUS,
      doctor_id: r.DOCTOR_ID,
      doctor_name: r.DOCTOR_NAME,
      patient_id: r.PATIENT_ID,
      patient: {
        id: r.PATIENT_ID,
        name: r.PATIENT_NAME,
        uhid: r.UHID,
        age: r.AGE,
        gender: r.GENDER
      }
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/hms/tokens/today-all error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/hms/tokens — Generate Token
router.post('/', protect, async (req, res) => {
  try {
    const { patient_id, doctor_id, department_id } = req.body;
    if (!patient_id || !doctor_id || !department_id) {
      return res.status(400).json({ success: false, message: 'Missing required fields.' });
    }

    const today = new Date().toISOString().split('T')[0];

    // Transaction to safely generate next incremental token number for the doctor/date
    const result = await sequelize.transaction(async (t) => {
      const [[{ NEXTVAL: nextId }]] = await sequelize.query(
        "SELECT nextval('hms_token_seq') AS \"NEXTVAL\"",
        { transaction: t }
      );

      // Find max token for today for this doctor
      const tokenRows = await Token.findAll({
        where: {
          doctor_id,
          [Op.and]: [tokenDateWhere(today)]
        },
        attributes: ['token_number'],
        transaction: t
      });
      const maxToken = tokenRows.reduce((max, row) => Math.max(max, row.token_number || 0), 0);

      const nextNumber = maxToken + 1;

      const token = await Token.create({
        id: nextId,
        patient_id, doctor_id, department_id,
        token_date: today,
        token_number: nextNumber,
        generated_by: req.user.id
      }, { transaction: t });

      return token;
    });

    await logAction(req.user.id, 'CREATE', 'token', result.id, null, { token_number: result.token_number }, req.ip);

    res.status(201).json({ success: true, message: 'Token generated successfully.', data: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error generating token.' });
  }
});

// GET /api/hms/tokens/queue — Live Queue
router.get('/queue', protect, async (req, res) => {
  try {
    const { doctor_id, date } = req.query;
    const queryDate = date || new Date().toISOString().split('T')[0];

    const where = {
      [Op.and]: [tokenDateWhere(queryDate)]
    };
    if (doctor_id) where.doctor_id = doctor_id;

    const tokens = await Token.findAll({
      where,
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'uhid', 'name', 'first_name', 'last_name', 'age', 'gender'] },
        { model: User, as: 'doctor', attributes: ['name'] },
        { model: Department, as: 'department', attributes: ['name'] }
      ],
      order: [['token_number', 'ASC']]
    });

    res.json({ success: true, data: tokens });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// PATCH /api/hms/tokens/:id/status
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const { status } = req.body;
    const token = await Token.findByPk(req.params.id);
    if (!token) return res.status(404).json({ success: false, message: 'Token not found.' });

    const oldStatus = token.status;
    token.status = status;
    await token.save();

    await logAction(req.user.id, 'UPDATE', 'token_status', token.id, oldStatus, status, req.ip);

    res.json({ success: true, message: 'Status updated.', data: token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
