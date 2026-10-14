const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');

// Practitioner credentials (migration 0012). A doctor whose recorded
// registration is missing, unverified, ended or expired may not start or
// finish clinical work. No migration invents verification evidence.
const EXPIRED_MESSAGE = 'A current independently verified medical registration is required to start or sign clinical work. Ask your hospital administrator to review your registration and verification evidence.';

async function credentialsExpired(userId) {
  const [row] = await sequelize.query('SELECT practitioner_credentials_expired(:userId) AS expired', {
    replacements: { userId }, type: QueryTypes.SELECT,
  });
  return Boolean(row?.expired ?? row?.EXPIRED);
}

// Express middleware for clinical actions. Only doctors are checked.
async function requireCurrentPractitioner(req, res, next) {
  if (req.user?.role !== 'doctor') return next();
  try {
    if (await credentialsExpired(req.user.id)) return res.status(403).json({ success: false, code: 'REGISTRATION_EXPIRED', message: EXPIRED_MESSAGE });
    return next();
  } catch (err) {
    console.error('Practitioner check failed:', err.message);
    return res.status(503).json({ success: false, message: 'Could not check your registration. Try again.' });
  }
}

module.exports = { requireCurrentPractitioner, credentialsExpired, EXPIRED_MESSAGE };

// Every doctor login has a practitioner record. Called when a doctor account is
// created or given the doctor role; idempotent.
async function ensurePractitioner(userId, transaction) {
  await sequelize.query(
    `INSERT INTO hms_practitioners (user_id, display_name)
     SELECT u.id, COALESCE(NULLIF(btrim(u.name), ''), u.username) FROM hms_users u
      WHERE u.id = :userId AND u.role = 'doctor'
     ON CONFLICT (user_id) DO NOTHING`,
    { replacements: { userId }, transaction }
  );
}

module.exports.ensurePractitioner = ensurePractitioner;
