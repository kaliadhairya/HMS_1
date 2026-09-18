const test = require('node:test'); const assert = require('node:assert/strict'); const { loadConfig } = require('../src/config');
test('patient config rejects short internal secret', () => assert.throws(() => loadConfig({ INTERNAL_SERVICE_SECRET: 'short' }), /at least 32/));
test('patient config has deterministic port', () => assert.equal(loadConfig({ INTERNAL_SERVICE_SECRET: 'x'.repeat(32), PATIENT_PORT: '5102' }).port, 5102));
