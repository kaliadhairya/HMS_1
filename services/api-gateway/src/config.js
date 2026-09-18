const path = require('path');
const dotenv = require('dotenv');

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function loadConfig(env = process.env) {
  if (env.GATEWAY_ENV_FILE) {
    dotenv.config({ path: path.resolve(env.GATEWAY_ENV_FILE) });
    env = process.env;
  } else {
    dotenv.config();
  }

  const jwtSecret = env.JWT_SECRET;
  const internalServiceSecret = env.INTERNAL_SERVICE_SECRET;
  if (!jwtSecret) throw new Error('JWT_SECRET is required');
  if (!internalServiceSecret || internalServiceSecret.length < 32) {
    throw new Error('INTERNAL_SERVICE_SECRET must contain at least 32 characters');
  }

  const allowedOrigins = (env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Object.freeze({
    serviceName: 'api-gateway',
    nodeEnv: env.NODE_ENV || 'development',
    port: parsePositiveInteger(env.PORT, 5001, 'PORT'),
    monolithUrl: env.MONOLITH_URL || 'http://127.0.0.1:5002',
    identityUrl: env.IDENTITY_URL || 'http://127.0.0.1:5101',
    patientUrl: env.PATIENT_URL || 'http://127.0.0.1:5102',
    opdUrl: env.OPD_URL || 'http://127.0.0.1:5103',
    jwtSecret,
    internalServiceSecret,
    allowedOrigins,
    proxyTimeoutMs: parsePositiveInteger(env.PROXY_TIMEOUT_MS, 30000, 'PROXY_TIMEOUT_MS'),
    shutdownTimeoutMs: parsePositiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, 'SHUTDOWN_TIMEOUT_MS'),
    authRateLimitWindowMs: parsePositiveInteger(env.AUTH_RATE_LIMIT_WINDOW_MS, 900000, 'AUTH_RATE_LIMIT_WINDOW_MS'),
    authRateLimitMax: parsePositiveInteger(env.AUTH_RATE_LIMIT_MAX, 20, 'AUTH_RATE_LIMIT_MAX'),
    apiRateLimitWindowMs: parsePositiveInteger(env.API_RATE_LIMIT_WINDOW_MS, 60000, 'API_RATE_LIMIT_WINDOW_MS'),
    apiRateLimitMax: parsePositiveInteger(env.API_RATE_LIMIT_MAX, 500, 'API_RATE_LIMIT_MAX'),
  });
}

module.exports = { loadConfig };
