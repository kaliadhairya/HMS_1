const { sequelize } = require('../models/db');
const { storage } = require('../utils/auditContext');
const { beforeSend } = require('../utils/responseGate');

// Records who read patient data and every refused request in
// audit.access_events (migration 0006). Row changes are captured by the
// database itself; this covers what triggers cannot see.

// GET requests under these prefixes return patient information.
const PATIENT_DATA_PREFIXES = [
  '/api/patients', '/api/hms/encounters', '/api/hms/prescriptions', '/api/hms/investigation-orders',
  '/api/hms/vitals', '/api/hms/rest-forms', '/api/hms/appointments', '/api/reports', '/api/pdf', '/api/ipd',
  '/api/lab', '/api/billing', '/api/doctor', '/api/receptionist', '/api/pharmacy/dispense',
  '/api/pharmacy/prescriptions',
];

function patientIdOf(req) {
  const p = req.params || {};
  const candidate = p.patient_id ?? p.patientId ?? (req.originalUrl.startsWith('/api/patients') ? p.id : undefined) ?? req.query?.patient_id;
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

function classify(req, status) {
  if (status === 401) return 'unauthenticated';
  if (status >= 400 && status < 500) return 'denied';
  if (req.method === 'GET' && status < 400 && PATIENT_DATA_PREFIXES.some((p) => req.originalUrl.startsWith(p))) return 'read';
  return null;
}

module.exports = function accessAudit(req, res, next) {
  if (!req.originalUrl.startsWith('/api/')) return next();
  beforeSend(res, 20, async () => {
    const outcome = classify(req, res.statusCode);
    if (!outcome) return;
    const context = { ...(storage.getStore() || {}), command: null };
    await storage.run(context, () => sequelize.query(
      `INSERT INTO audit.access_events (user_id, session_id, request_id, method, path, status, outcome, patient_id, ip, detail)
       VALUES (:userId, :sessionId, :requestId, :method, :path, :status, :outcome, :patientId, :ip, :detail)`,
      {
        replacements: {
          userId: req.user?.id ?? null,
          sessionId: req.user?.sessionId ?? null,
          requestId: req.id ?? null,
          method: req.method,
          path: req.originalUrl.split('?')[0].slice(0, 500),
          status: res.statusCode,
          outcome,
          patientId: patientIdOf(req),
          ip: req.ip || null,
          detail: outcome === 'read' ? null : String(res.statusMessage || '').slice(0, 200) || null,
        },
      }
    ));
  });
  return next();
};
