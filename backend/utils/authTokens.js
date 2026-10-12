const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const ISSUER = 'hms-backend';
const SESSION_AUDIENCE = 'hms-session';
const RESET_AUDIENCE = 'hms-password-reset';
const ALGORITHMS = ['HS256'];
const MIN_SECRET_LENGTH = 32;

// Values that have been committed to the public repository or shipped as
// defaults. A deployment using any of these is not protected by its secret.
const PUBLISHED_SECRETS = new Set([
  'your_super_secret_jwt_key',
  'hms_super_secret_production_jwt_key_2026',
  'd2140f944925f320dc70f1b6671b4cf1bb30ea3a9a73871dd972e8010bfe129c',
]);

function isUsableSecret(value) {
  return typeof value === 'string' && value.length >= MIN_SECRET_LENGTH && !PUBLISHED_SECRETS.has(value);
}

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!isUsableSecret(secret)) {
    throw new Error(`JWT_SECRET must be a private random value of at least ${MIN_SECRET_LENGTH} characters`);
  }
  return secret;
}

// Called once at startup so a weak or published secret stops the server
// instead of silently protecting nothing.
function assertSecurityConfig() {
  getJwtSecret();
  const internal = process.env.INTERNAL_SERVICE_SECRET;
  if (internal && !isUsableSecret(internal)) {
    throw new Error(`INTERNAL_SERVICE_SECRET is published or shorter than ${MIN_SECRET_LENGTH} characters; replace it or leave it unset`);
  }
}

function signSessionToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role, purpose: 'session' },
    getJwtSecret(),
    {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: SESSION_AUDIENCE,
      expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    }
  );
}

// Throws unless the token is a signed, unexpired session token.
function verifySessionToken(token) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ALGORITHMS,
    issuer: ISSUER,
    audience: SESSION_AUDIENCE,
  });
  if (decoded?.purpose !== 'session' || !decoded.id) throw new Error('Not a session token');
  return decoded;
}

// Binds a reset token to the current password hash, so the token stops
// working as soon as the password changes (single use).
function passwordFingerprint(user) {
  return crypto.createHmac('sha256', getJwtSecret()).update(String(user.password)).digest('base64url').slice(0, 22);
}

function signPasswordResetToken(user) {
  return jwt.sign(
    { id: user.id, purpose: 'password_reset', pwf: passwordFingerprint(user) },
    getJwtSecret(),
    { algorithm: 'HS256', issuer: ISSUER, audience: RESET_AUDIENCE, expiresIn: '15m' }
  );
}

// Throws unless the token is a signed, unexpired password-reset token.
function verifyPasswordResetToken(token) {
  const decoded = jwt.verify(token, getJwtSecret(), {
    algorithms: ALGORITHMS,
    issuer: ISSUER,
    audience: RESET_AUDIENCE,
  });
  if (decoded?.purpose !== 'password_reset' || !decoded.id || !decoded.pwf) throw new Error('Not a reset token');
  return decoded;
}

function resetTokenMatchesUser(decoded, user) {
  const expected = Buffer.from(passwordFingerprint(user));
  const actual = Buffer.from(String(decoded.pwf));
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = {
  assertSecurityConfig,
  signSessionToken,
  verifySessionToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  resetTokenMatchesUser,
};
