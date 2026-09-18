const pino = require('pino');

function createLogger(config) {
  return pino({
    level: process.env.LOG_LEVEL || 'info',
    base: { service: config.serviceName },
    redact: {
      paths: [
        'req.headers.authorization',
        'headers.authorization',
        '*.password',
        '*.token',
        '*.otp',
      ],
      censor: '[REDACTED]',
    },
  });
}

module.exports = { createLogger };
