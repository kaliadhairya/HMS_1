const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const PASSWORD_PATTERN = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;

function sanitizeUser(user) {
  const value = user.toJSON ? user.toJSON() : { ...user };
  delete value.password;
  delete value.otp_code;
  delete value.otp_expires;
  return value;
}

class AuthService {
  constructor({ userRepository, permissionRepository, auditService, config }) {
    this.users = userRepository;
    this.permissions = permissionRepository;
    this.audit = auditService;
    this.config = config;
  }

  async login({ username, password, ipAddress }) {
    const user = await this.users.findByUsername(username, true);
    if (!user) return { status: 401, body: { success: false, message: 'Invalid credentials.' } };
    if (!user.isActive) {
      await this.audit.record({ userId: user.id, action: 'LOGIN_FAILED', module: 'auth', newValue: { reason: 'account_inactive' }, ipAddress });
      return { status: 403, body: { success: false, message: 'Account is deactivated. Contact your administrator.' } };
    }
    if (await this.users.isLocked(user.id)) {
      await this.audit.record({ userId: user.id, action: 'LOGIN_FAILED', module: 'auth', newValue: { reason: 'account_locked' }, ipAddress });
      return { status: 423, body: { success: false, message: 'Account locked due to too many failed attempts.', lockedUntil: user.locked_until } };
    }
    if (!(await user.comparePassword(password))) {
      const { attempts, lockedUntil } = await this.users.recordFailedLogin(user.id);
      await this.audit.record({ userId: user.id, action: 'LOGIN_FAILED', module: 'auth', newValue: { attempts }, ipAddress });
      return attempts >= 5
        ? { status: 423, body: { success: false, message: 'Account locked due to too many failed attempts. Try again in 15 minutes.', lockedUntil } }
        : { status: 401, body: { success: false, message: 'Invalid credentials.' } };
    }

    await this.users.clearLoginFailures(user);
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      this.config.jwtSecret,
      { expiresIn: this.config.jwtExpiresIn },
    );
    await this.audit.record({ userId: user.id, action: 'LOGIN', module: 'auth', newValue: { role: user.role }, ipAddress });
    return {
      status: 200,
      body: {
        success: true,
        token,
        user: {
          id: user.id,
          username: user.username,
          name: user.name,
          first_name: user.first_name,
          last_name: user.last_name,
          role: user.role,
        },
        first_login: user.first_login || 'N',
      },
    };
  }

  async buildContext(userId) {
    const user = await this.users.findById(userId);
    if (!user || !user.isActive) return null;
    if (await this.users.isLocked(user.id)) return null;
    const permissions = await this.permissions.listForRole(user.role);
    return {
      ...sanitizeUser(user),
      permissions: permissions.map((permission) => ({
        module: permission.module,
        read: permission.can_read === 'Y',
        write: permission.can_write === 'Y',
        edit: permission.can_edit === 'Y',
        delete: permission.can_delete === 'Y',
      })),
    };
  }

  verifyAccessToken(token) {
    return jwt.verify(token, this.config.jwtSecret);
  }

  assertStrongPassword(password) {
    return PASSWORD_PATTERN.test(password);
  }

  async requestPasswordReset(value) {
    const user = await this.users.findByUsernameOrPhone(value);
    if (!user) return { user: null, otp: null };
    const otp = String(crypto.randomInt(100000, 1000000));
    await this.users.update(user, { otp_code: otp, otp_expires: new Date(Date.now() + 10 * 60 * 1000) });
    return { user, otp };
  }

  async verifyOtp(username, otp) {
    const user = await this.users.findByUsername(username, true);
    if (!user || user.otp_code !== String(otp) || !user.otp_expires || new Date(user.otp_expires) < new Date()) return null;
    return jwt.sign({ id: user.id, purpose: 'password_reset' }, this.config.jwtSecret, { expiresIn: '15m' });
  }

  async resetPassword(resetToken, newPassword, ipAddress) {
    const decoded = jwt.verify(resetToken, this.config.jwtSecret);
    if (decoded.purpose !== 'password_reset') throw new Error('INVALID_RESET_TOKEN');
    const user = await this.users.findById(decoded.id, true);
    if (!user) throw new Error('USER_NOT_FOUND');
    await this.users.update(user, { password: newPassword, otp_code: null, otp_expires: null, first_login: 'N' });
    await this.audit.record({ userId: user.id, action: 'UPDATE', module: 'auth', recordId: user.id, newValue: { action: 'password_reset' }, ipAddress });
  }
}

module.exports = { AuthService, PASSWORD_PATTERN, sanitizeUser };
