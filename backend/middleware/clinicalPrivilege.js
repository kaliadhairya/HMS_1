// Clinical chart writes need a current, independently verified professional
// credential and a facility-specific privilege for the action (completion A2).
// Doctors also need the patient in their care. Role checks alone are not enough.
const { requirePrivilege } = require('../services/facilities.cts');
const { patientInCare, NOT_IN_CARE } = require('../utils/careTeam');

// patientIdFrom(req) returns the patient the write is about, when it is known up front.
function requireClinicalPrivilege(action, { patientIdFrom } = {}) {
  return async (req, res, next) => {
    try {
      await requirePrivilege(req.user, action);
      if (req.user.role === 'doctor' && patientIdFrom) {
        const patientId = Number(await patientIdFrom(req));
        if (Number.isSafeInteger(patientId) && patientId > 0 && !(await patientInCare(req.user.id, patientId))) {
          return res.status(403).json({ success: false, code: 'PATIENT_NOT_IN_CARE', message: NOT_IN_CARE });
        }
      }
      return next();
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return res.status(status).json({ success: false, code: err.code, message: status >= 500 ? 'Server error.' : err.message });
    }
  };
}

// Patient of an inpatient admission, taken from the route parameter or the body.
async function patientOfAdmission(req) {
  const id = Number(req.params.id ?? req.body?.admissionId ?? req.body?.admission_id);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  const { sequelize } = require('../models/db');
  const [rows] = await sequelize.query('SELECT patient_id FROM hms_admissions WHERE id = :id', { replacements: { id } });
  return rows && rows.length ? (rows[0].patient_id ?? rows[0].PATIENT_ID) : null;
}

module.exports = { requireClinicalPrivilege, patientOfAdmission };
