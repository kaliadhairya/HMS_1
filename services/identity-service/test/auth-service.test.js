const assert = require('node:assert/strict');
const test = require('node:test');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { AuthService } = require('../src/services/auth-service');

const config = {
  jwtSecret: 'identity-test-jwt-secret',
  jwtExpiresIn: '1h',
  internalServiceSecret: 'identity-test-internal-secret-32-characters',
};

function user(values = {}) {
  const state = {
    id: 7,
    username: 'doctor',
    password: bcrypt.hashSync('Doctor@123', 4),
    name: 'Doctor',
    role: 'doctor',
    isActive: 1,
    first_login: 'N',
    failed_attempts: 0,
    locked_until: null,
    ...values,
  };
  return {
    ...state,
    comparePassword(candidate) { return bcrypt.compare(candidate, this.password); },
    toJSON() { return { ...this }; },
  };
}

function harness(initialUser = user()) {
  const audits = [];
  const users = {
    value: initialUser,
    async findByUsername() { return this.value; },
    async findByUsernameOrPhone() { return this.value; },
    async findById() { return this.value; },
    async update(instance, values) { Object.assign(instance, values); return instance; },
    async isLocked() { return Boolean(this.value.locked_until && new Date(this.value.locked_until) > new Date()); },
    async recordFailedLogin() {
      const attempts = (this.value.failed_attempts || 0) + 1;
      this.value.failed_attempts = attempts;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
      if (lockedUntil) this.value.locked_until = lockedUntil;
      return { attempts, lockedUntil };
    },
    async clearLoginFailures() { this.value.failed_attempts = 0; this.value.locked_until = null; this.value.last_login = new Date(); },
  };
  const permissions = {
    async listForRole() { return [{ module: 'consultation', can_read: 'Y', can_write: 'Y', can_edit: 'N', can_delete: 'N' }]; },
  };
  const audit = { async record(entry) { audits.push(entry); } };
  return { service: new AuthService({ userRepository: users, permissionRepository: permissions, auditService: audit, config }), users, audits };
}

test('successful login resets lock counters, emits an audit, and signs a compatible JWT', async () => {
  const { service, users, audits } = harness(user({ failed_attempts: 2 }));
  const result = await service.login({ username: 'doctor', password: 'Doctor@123', ipAddress: '127.0.0.1' });
  assert.equal(result.status, 200);
  assert.equal(jwt.verify(result.body.token, config.jwtSecret).id, 7);
  assert.equal(users.value.failed_attempts, 0);
  assert.equal(audits.at(-1).action, 'LOGIN');
});

test('five failed attempts lock the account and preserve the baseline response contract', async () => {
  const { service, users, audits } = harness(user({ failed_attempts: 4 }));
  const result = await service.login({ username: 'doctor', password: 'wrong', ipAddress: '127.0.0.1' });
  assert.equal(result.status, 423);
  assert.ok(users.value.locked_until instanceof Date);
  assert.equal(audits.at(-1).newValue.attempts, 5);
});

test('current context reloads active state and maps role permissions', async () => {
  const { service } = harness();
  const context = await service.buildContext(7);
  assert.equal(context.role, 'doctor');
  assert.deepEqual(context.permissions[0], { module: 'consultation', read: true, write: true, edit: false, delete: false });
  assert.equal(context.password, undefined);
});

test('inactive accounts cannot produce a trusted context', async () => {
  const { service } = harness(user({ isActive: 0 }));
  assert.equal(await service.buildContext(7), null);
});
