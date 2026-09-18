const pino = require('pino');
function createLogger(config) {
  return pino({ level: process.env.LOG_LEVEL || 'info', base: { service: config.serviceName }, redact: {
    paths: ['req.headers.authorization', 'req.headers.x-auth-context', 'req.headers.x-auth-context-signature', 'req.headers.x-internal-service-token', '*.aadhaar', '*.password', '*.token'], censor: '[REDACTED]'
  }});
}
module.exports = { createLogger };
