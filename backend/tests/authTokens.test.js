const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
const tokens = require('../utils/authTokens');

const user = { id: 7, username: 'nurse1', role: 'nurse', password: '$2a$12$hashOne' };

test('a password-reset token is rejected as a session', () => {
  const reset = tokens.signPasswordResetToken(user);
  assert.throws(() => tokens.verifySessionToken(reset));
});

test('a session token is rejected as a password-reset token', () => {
  const session = tokens.signSessionToken(user);
  assert.throws(() => tokens.verifyPasswordResetToken(session));
});

test('a valid session token is accepted', () => {
  const decoded = tokens.verifySessionToken(tokens.signSessionToken(user));
  assert.strictEqual(decoded.id, 7);
});

test('a legacy token without purpose or audience is rejected', () => {
  const legacy = jwt.sign({ id: 7, username: 'nurse1', role: 'nurse' }, process.env.JWT_SECRET);
  assert.throws(() => tokens.verifySessionToken(legacy));
});

test('a token signed with the old published secret is rejected', () => {
  const forged = jwt.sign({ id: 1, purpose: 'session' }, 'your_super_secret_jwt_key', { issuer: 'hms-backend', audience: 'hms-session' });
  assert.throws(() => tokens.verifySessionToken(forged));
});

test('a reset token stops working once the password changes', () => {
  const decoded = tokens.verifyPasswordResetToken(tokens.signPasswordResetToken(user));
  assert.ok(tokens.resetTokenMatchesUser(decoded, user));
  assert.ok(!tokens.resetTokenMatchesUser(decoded, { ...user, password: '$2a$12$hashTwo' }));
});

test('startup refuses missing, short or published secrets', () => {
  const original = process.env.JWT_SECRET;
  try {
    for (const bad of [undefined, 'short', 'your_super_secret_jwt_key', 'hms_super_secret_production_jwt_key_2026']) {
      if (bad === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = bad;
      assert.throws(() => tokens.assertSecurityConfig(), `accepted ${bad}`);
    }
    process.env.JWT_SECRET = original;
    process.env.INTERNAL_SERVICE_SECRET = 'd2140f944925f320dc70f1b6671b4cf1bb30ea3a9a73871dd972e8010bfe129c';
    assert.throws(() => tokens.assertSecurityConfig());
  } finally {
    process.env.JWT_SECRET = original;
    delete process.env.INTERNAL_SERVICE_SECRET;
  }
  assert.doesNotThrow(() => tokens.assertSecurityConfig());
});
