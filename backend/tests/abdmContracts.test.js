const test = require('node:test');
const assert = require('node:assert/strict');
const { missing, REQUIRED } = require('../domain/abdmContracts.cts');
const { abdmMode } = require('../services/integrationReadiness.cts');

test('a complete callback passes; each missing field is named', () => {
  assert.deepEqual(missing('data-push', { transactionId: 't', entries: [{}], keyMaterial: {} }), []);
  assert.deepEqual(missing('data-push', { transactionId: 't', entries: [] }), ['entries', 'keyMaterial']);
  assert.deepEqual(missing('hi-request', { transactionId: 't', hiRequest: { consent: { id: 'c' }, dateRange: { from: 'a', to: 'b' }, dataPushUrl: 'u', keyMaterial: {} } }), []);
  assert.deepEqual(missing('hi-request', { transactionId: 't', hiRequest: { consent: { id: 'c' } } }), ['hiRequest.dateRange.from', 'hiRequest.dateRange.to', 'hiRequest.dataPushUrl', 'hiRequest.keyMaterial']);
});

test('alternatives: either path satisfies a rule (an answer or an error)', () => {
  assert.deepEqual(missing('consent-on-init', { response: { requestId: 'r' }, error: { code: 'x' } }), []);
  assert.deepEqual(missing('consent-on-init', { response: { requestId: 'r' } }), ['consentRequest.id|error']);
  assert.deepEqual(missing('patient-share', { patient: { name: 'x' } }), []);
});

test('non-objects and unknown types are refused', () => {
  assert.deepEqual(missing('discover', null), ['a JSON object body']);
  assert.deepEqual(missing('discover', []), ['a JSON object body']);
  assert.match(missing('nope', {})[0], /unknown callback type/);
  assert.equal(Object.keys(REQUIRED).length, 13);
});

test('the ABDM environment is read from the gateway address', () => {
  const saved = process.env.ABDM_MOCK_URL; delete process.env.ABDM_MOCK_URL;
  try {
    assert.equal(abdmMode('http://127.0.0.1:9330'), 'mock');
    assert.equal(abdmMode('https://dev.abdm.gov.in/gateway'), 'sandbox');
    assert.equal(abdmMode('https://live.abdm.gov.in/gateway'), 'production');
  } finally { if (saved !== undefined) process.env.ABDM_MOCK_URL = saved; }
});
