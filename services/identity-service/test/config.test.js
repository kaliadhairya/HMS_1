const assert = require('node:assert/strict');
const test = require('node:test');
const { loadConfig } = require('../src/config');

test('production refuses reset-code disclosure', () => {
  assert.throws(() => loadConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'jwt',
    INTERNAL_SERVICE_SECRET: 'x'.repeat(32),
    EXPOSE_RESET_OTP: 'true',
  }), /cannot be enabled in production/);
});

test('internal service secret must meet minimum length', () => {
  assert.throws(() => loadConfig({ JWT_SECRET: 'jwt', INTERNAL_SERVICE_SECRET: 'short' }), /at least 32/);
});
