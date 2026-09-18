const dotenv = require('dotenv');

function positive(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function loadConfig(env = process.env) {
  dotenv.config();
  const secret = env.INTERNAL_SERVICE_SECRET;
  if (!secret || secret.length < 32) throw new Error('INTERNAL_SERVICE_SECRET must contain at least 32 characters');
  return Object.freeze({
    serviceName: 'patient-service',
    nodeEnv: env.NODE_ENV || 'development',
    host: env.PATIENT_HOST || '127.0.0.1',
    port: positive(env.PATIENT_PORT, 5102, 'PATIENT_PORT'),
    internalServiceSecret: secret,
    monolithUrl: env.MONOLITH_URL || null,
    serviceRequestTimeoutMs: positive(env.SERVICE_REQUEST_TIMEOUT_MS, 5000, 'SERVICE_REQUEST_TIMEOUT_MS'),
    db: {
      host: env.DB_HOST || '127.0.0.1', port: positive(env.DB_PORT, 5432, 'DB_PORT'),
      name: env.DB_NAME || 'hms', user: env.DB_USER || 'postgres', password: env.DB_PASSWORD || '',
      poolMax: positive(env.DB_POOL_MAX, 10, 'DB_POOL_MAX'),
    },
    aadhaarKey: env.AADHAAR_ENCRYPTION_KEY || '0'.repeat(64),
  });
}
module.exports = { loadConfig };
