const crypto = require('crypto');

const identityUrl = process.env.IDENTITY_URL || 'http://127.0.0.1:5101';
const internalSecret = process.env.INTERNAL_SERVICE_SECRET;
const timeoutMs = Number(process.env.IDENTITY_TIMEOUT_MS || 5000);

async function identityRequest(path, options = {}) {
  if (!internalSecret) throw new Error('INTERNAL_SERVICE_SECRET is required for Identity communication');
  const response = await fetch(`${identityUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-internal-service-token': internalSecret,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  return response;
}

async function validateToken(token, requestId) {
  const response = await identityRequest('/internal/v1/auth/validate', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'x-request-id': requestId || crypto.randomUUID() },
  });
  if (!response.ok) return null;
  const body = await response.json();
  return body.context || null;
}

async function writeAudit(entry, idempotencyKey, requestId) {
  const response = await identityRequest('/internal/v1/audit', {
    method: 'POST',
    headers: {
      'idempotency-key': idempotencyKey,
      'x-request-id': requestId || crypto.randomUUID(),
    },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error(`Identity audit endpoint returned ${response.status}`);
  return response.json();
}

module.exports = { validateToken, writeAudit };
