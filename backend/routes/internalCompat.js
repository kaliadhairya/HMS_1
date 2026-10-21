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

// Legacy free-text lab report drafts are retired (completion A6): no service creates or deletes them.
const LEGACY_REPORTS_RETIRED = (req, res) => res.status(410).json({ success: false, error: { code: 'LEGACY_REPORT_WRITE_RETIRED', message: 'Free-text lab report drafts are retired; laboratory work starts from a coded order.' } });
router.post('/test-reports', LEGACY_REPORTS_RETIRED);
router.delete('/test-reports/:patientId', LEGACY_REPORTS_RETIRED);

module.exports = router;
