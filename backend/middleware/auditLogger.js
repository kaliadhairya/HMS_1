const AuditLog = require('../models/AuditLog');
const { beforeSend } = require('../utils/responseGate');
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
function extractModule(url) {
  const parts = url.split('?')[0].replace('/api/', '').split('/').filter(Boolean);
  return parts[0] === 'hms' ? parts[1] : parts[0] || 'unknown';
}
function sanitizeBody(body) {
  const sanitized = { ...(body || {}) };
  for (const key of ['password', 'currentPassword', 'newPassword', 'token', 'resetToken', 'otp', 'secret', 'creditCard']) {
    if (key in sanitized) sanitized[key] = '[redacted]';
  }
  return sanitized;
}
module.exports = function auditLogger(req, res, next) {
  if (!MUTATING.has(req.method) || req.originalUrl.startsWith('/api/auth')) return next();
  beforeSend(res, 5, async () => {
    if (res.statusCode < 200 || res.statusCode >= 300 || res.getHeader('Idempotent-Replay')) return;
    const id = Number(req.params?.id || req.body?.id);
    await AuditLog.create({
      user_id: req.user?.id || null, action: req.method, module: extractModule(req.originalUrl),
      record_id: Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null,
      new_value: JSON.stringify(sanitizeBody(req.body)).substring(0, 3000),
      ip_address: req.ip || req.connection?.remoteAddress || null,
    });
  });
  return next();
};
