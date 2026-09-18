const pino = require('pino');

function createLogger(config) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: config.serviceName },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.x-internal-service-token',
        'req.headers.x-auth-context',
        'req.headers.x-auth-context-signature',
        'req.headers.x-auth-context-timestamp',
        'password',
        '*.password',
        'otp',
        '*.otp',
        'resetToken',
        '*.resetToken',
      ],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
