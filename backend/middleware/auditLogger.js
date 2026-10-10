const { writeAudit } = require('../utils/identityClient');
const AuditLog = require('../models/AuditLog');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function extractModule(url) {
  const parts = url.replace('/api/', '').split('/').filter(Boolean);
  return parts[0] === 'hms' && parts.length > 1 ? parts[1] : parts[0] || 'unknown';
}

function sanitizeBody(body) {
  if (!body) return {};
  const sanitized = { ...body };
  for (const key of ['password', 'currentPassword', 'newPassword', 'token', 'resetToken', 'otp', 'secret', 'creditCard']) {
    if (sanitized[key] !== undefined) sanitized[key] = '***REDACTED***';
  }
  return sanitized;
}

module.exports = function auditLogger(req, res, next) {
  // Auth routes write their own specific entries (LOGIN, password changes)
  if (!MUTATING_METHODS.has(req.method) || req.originalUrl.startsWith('/api/auth')) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const requestId = req.headers['x-request-id'];
      const idempotencyKey = requestId ? `monolith:${requestId}:${req.method}:${req.originalUrl}` : undefined;
      const entry = {
        userId: req.user?.id || null,
        action: req.method,
        module: extractModule(req.originalUrl),
        recordId: Number(req.params?.id || req.body?.id) || null,
        newValue: sanitizeBody(req.body),
        ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
      };
      writeAudit(entry, idempotencyKey, requestId).catch(() => AuditLog.create({
        user_id: entry.userId,
        action: entry.action,
        module: entry.module,
        record_id: entry.recordId,
        new_value: JSON.stringify(entry.newValue).substring(0, 3000),
        ip_address: entry.ipAddress,
      })).catch((error) => {
        console.warn('Audit write failed:', error.message);
      });
    }
    return originalJson(body);
  };
  return next();
};
