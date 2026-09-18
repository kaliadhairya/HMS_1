const path = require('path');
const dotenv = require('dotenv');

function positiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function loadConfig(env = process.env) {
  if (env.IDENTITY_ENV_FILE) {
    dotenv.config({ path: path.resolve(env.IDENTITY_ENV_FILE) });
    env = process.env;
  } else {
    dotenv.config();
  }

  if (!env.JWT_SECRET) throw new Error('JWT_SECRET is required');
  if (!env.INTERNAL_SERVICE_SECRET || env.INTERNAL_SERVICE_SECRET.length < 32) {
    throw new Error('INTERNAL_SERVICE_SECRET must contain at least 32 characters');
  }
  if (env.NODE_ENV === 'production' && env.EXPOSE_RESET_OTP === 'true') {
    throw new Error('EXPOSE_RESET_OTP cannot be enabled in production');
  }

  return Object.freeze({
    serviceName: 'identity-service',
    nodeEnv: env.NODE_ENV || 'development',
    port: positiveInteger(env.PORT, 5101, 'PORT'),
    db: {
      host: env.DB_HOST || '/var/run/postgresql',
      port: positiveInteger(env.DB_PORT, 5432, 'DB_PORT'),
      name: env.DB_NAME || 'hms',
      user: env.DB_USER || 'postgres',
      password: env.DB_PASSWORD || '',
    },
    jwtSecret: env.JWT_SECRET,
    jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
    internalServiceSecret: env.INTERNAL_SERVICE_SECRET,
    monolithUrl: env.MONOLITH_URL || 'http://127.0.0.1:5002',
    exposeResetOtp: env.NODE_ENV === 'test' || env.EXPOSE_RESET_OTP === 'true',
    requestTimeoutMs: positiveInteger(env.REQUEST_TIMEOUT_MS, 5000, 'REQUEST_TIMEOUT_MS'),
    shutdownTimeoutMs: positiveInteger(env.SHUTDOWN_TIMEOUT_MS, 10000, 'SHUTDOWN_TIMEOUT_MS'),
  });
}

module.exports = { loadConfig };
