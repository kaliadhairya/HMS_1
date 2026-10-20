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

module.exports = { requireClinicalPrivilege };
