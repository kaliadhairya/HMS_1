const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');

// Patient scope (migration 0014). Doctors read a patient's record only when the
// patient is in their care. Desk staff and administrators are not limited here.
const NOT_IN_CARE = 'This patient is not in your care. Ask for them to be added to your care team, or use break-glass with a reason.';

async function patientInCare(userId, patientId, transaction) {
  const [row] = await sequelize.query('SELECT patient_in_care(:userId, :patientId) AS ok', {
    replacements: { userId, patientId }, type: QueryTypes.SELECT, transaction,
  });
  return Boolean(row?.ok ?? row?.OK);
}

// Puts a clinician on a patient's care team when they begin work with the
// patient (a token, an appointment, a consultation). Idempotent.
async function ensureCareTeam(userId, patientId, transaction, role = 'consulting') {
  await sequelize.query(
    `INSERT INTO hms_care_team_assignments (patient_id, practitioner_user_id, role, assigned_by)
     SELECT :patientId, u.id, :role, :userId FROM hms_users u
      WHERE u.id = :userId AND u.role = 'doctor'
        AND NOT EXISTS (SELECT 1 FROM hms_care_team_assignments c WHERE c.patient_id = :patientId AND c.practitioner_user_id = u.id AND c.valid_to IS NULL)
     ON CONFLICT DO NOTHING`,
    { replacements: { patientId, userId, role }, transaction }
  );
}

// Route middleware for doctors. The patient id comes from the mount path.
// Must run after protect() so req.user is set.
function requirePatientInCare(req, res, next) {
  if (req.user?.role !== 'doctor') return next();
  const patientId = Number(req.params.id);
  if (!Number.isInteger(patientId) || patientId <= 0) return next();
  patientInCare(req.user.id, patientId)
    .then((ok) => (ok ? next() : res.status(403).json({ success: false, code: 'PATIENT_NOT_IN_CARE', message: NOT_IN_CARE })))
    .catch((err) => {
      console.error('Care check failed:', err.message);
      res.status(503).json({ success: false, message: 'Could not check the care team. Try again.' });
    });
}

module.exports = { patientInCare, ensureCareTeam, requirePatientInCare, NOT_IN_CARE };
