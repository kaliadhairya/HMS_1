const crypto = require('crypto');

const MAX_CONTEXT_AGE_MS = Number(process.env.AUTH_CONTEXT_MAX_AGE_MS || 30000);

function timingSafeEqual(left, right) {
  const a = Buffer.from(left || '');
  const b = Buffer.from(right || '');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function readTrustedContext(req) {
  const context = req.headers['x-auth-context'];
  const signature = req.headers['x-auth-context-signature'];
  const timestamp = req.headers['x-auth-context-timestamp'];
  const requestId = req.headers['x-request-id'];
  const secret = process.env.INTERNAL_SERVICE_SECRET;
  if (!context || !signature || !timestamp || !requestId || !secret) return null;

  const age = Math.abs(Date.now() - Number(timestamp));
  if (!Number.isFinite(age) || age > MAX_CONTEXT_AGE_MS) return null;
  const expected = crypto.createHmac('sha256', secret)
    .update(`${requestId}.${timestamp}.${context}`)
    .digest('base64url');
  if (!timingSafeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(context, 'base64url').toString('utf8'));
    if (!parsed.id || !parsed.role) return null;
    return {
      id: parsed.id,
      username: parsed.username,
      name: parsed.name,
      role: parsed.role,
      department_id: parsed.departmentId,
      first_login: parsed.firstLogin,
      permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
    };
  } catch {
    return null;
  }
}

module.exports = { readTrustedContext };
