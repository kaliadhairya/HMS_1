const express = require('express');
const { Doctor } = require('../models');
const { sequelize } = require('../models/db');

const router = express.Router();

router.use((req, res, next) => {
  if (!process.env.INTERNAL_SERVICE_SECRET || req.headers['x-internal-service-token'] !== process.env.INTERNAL_SERVICE_SECRET) {
    return res.status(401).json({ success: false, error: { code: 'INVALID_SERVICE_IDENTITY', message: 'Trusted service identity required.' } });
  }
  return next();
});

router.post('/doctor-profiles', async (req, res, next) => {
  try {
    const userId = Number(req.body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid userId is required.' } });
    }
    const [doctor, created] = await Doctor.findOrCreate({
      where: { user_id: userId },
      defaults: { user_id: userId, speciality: 'General Physician' },
    });
    return res.status(created ? 201 : 200).json({ success: true, created, doctorId: doctor.id });
  } catch (error) {
    return next(error);
  }
});

router.post('/test-reports', async (req, res, next) => {
  try {
    const patientId = Number(req.body.patientId);
    const reportedBy = Number(req.body.reportedBy);
    if (!Number.isInteger(patientId) || patientId <= 0 || !Number.isInteger(reportedBy) || reportedBy <= 0) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid patientId and reportedBy are required.' } });
    const [[row]] = await sequelize.query("SELECT nextval('hms_test_reports_seq') AS id");
    const reportId = Number(row.id);
    await sequelize.query("INSERT INTO HMS_TEST_REPORTS (ID, PATIENT_ID, REPORTED_BY, STATUS, CREATED_AT, UPDATED_AT) VALUES (:id, :patientId, :reportedBy, 'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)", { replacements: { id: reportId, patientId, reportedBy } });
    return res.status(201).json({ success: true, reportId });
  } catch (error) { return next(error); }
});

router.delete('/test-reports/:patientId', async (req, res, next) => { try { const patientId = Number(req.params.patientId); if (!Number.isInteger(patientId) || patientId <= 0) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Valid patientId is required.' } }); await sequelize.query('DELETE FROM HMS_TEST_REPORTS WHERE PATIENT_ID = :patientId', { replacements: { patientId } }); return res.json({ success: true }); } catch (error) { return next(error); } });

module.exports = router;
