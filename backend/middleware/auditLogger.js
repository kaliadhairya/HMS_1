const { writeAudit } = require('../utils/identityClient');

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
  if (!MUTATING_METHODS.has(req.method)) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const requestId = req.headers['x-request-id'];
      const idempotencyKey = requestId ? `monolith:${requestId}:${req.method}:${req.originalUrl}` : undefined;
      writeAudit({
        userId: req.user?.id || null,
        action: req.method,
        module: extractModule(req.originalUrl),
        recordId: Number(req.params?.id || req.body?.id) || null,
        newValue: sanitizeBody(req.body),
        ipAddress: req.ip || req.connection?.remoteAddress || 'unknown',
      }, idempotencyKey, requestId).catch((error) => {
        console.warn('Identity audit write failed:', error.message);
      });
    }
    return originalJson(body);
  };
  return next();
};
