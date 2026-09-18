class AuthController {
  constructor({ authService, userRepository, auditService, config }) {
    this.auth = authService;
    this.users = userRepository;
    this.audit = auditService;
    this.config = config;
  }

  login = async (req, res, next) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required.' });
      const result = await this.auth.login({ username: String(username).trim().toLowerCase(), password, ipAddress: req.ip });
      return res.status(result.status).json(result.body);
    } catch (error) { return next(error); }
  };

  me = (req, res) => res.json({ success: true, user: req.user, first_login: req.user.first_login || 'N' });

  changePassword = async (req, res, next) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: 'Current and new password are required.' });
      if (!this.auth.assertStrongPassword(newPassword)) return res.status(400).json({ success: false, message: 'Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.' });
      const user = await this.users.findById(req.user.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
      if (!(await user.comparePassword(currentPassword))) return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
      await this.users.update(user, { password: newPassword, first_login: 'N' });
      await this.audit.record({ userId: user.id, action: 'UPDATE', module: 'auth', recordId: user.id, newValue: { action: 'password_changed' }, ipAddress: req.ip });
      return res.json({ success: true, message: 'Password changed successfully.' });
    } catch (error) { return next(error); }
  };

  forgotPassword = async (req, res, next) => {
    try {
      if (!req.body.usernameOrPhone) return res.status(400).json({ success: false, message: 'Username or phone is required.' });
      const { otp } = await this.auth.requestPasswordReset(req.body.usernameOrPhone);
      const body = { success: true, message: 'If the account exists, a reset code has been sent to its registered contact.' };
      if (otp && this.config.exposeResetOtp) body.otp = otp;
      return res.json(body);
    } catch (error) { return next(error); }
  };

  verifyOtp = async (req, res, next) => {
    try {
      const { username, otp } = req.body;
      if (!username || !otp) return res.status(400).json({ success: false, message: 'Username and OTP are required.' });
      const resetToken = await this.auth.verifyOtp(username, otp);
      if (!resetToken) return res.status(400).json({ success: false, message: 'Invalid or expired OTP.' });
      return res.json({ success: true, resetToken });
    } catch (error) { return next(error); }
  };

  resetPassword = async (req, res, next) => {
    try {
      const { resetToken, newPassword } = req.body;
      if (!resetToken || !newPassword) return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
      if (!this.auth.assertStrongPassword(newPassword)) return res.status(400).json({ success: false, message: 'Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.' });
      await this.auth.resetPassword(resetToken, newPassword, req.ip);
      return res.json({ success: true, message: 'Password has been reset successfully.' });
    } catch (error) {
      if (['JsonWebTokenError', 'TokenExpiredError'].includes(error.name) || error.message === 'INVALID_RESET_TOKEN') {
        return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
      }
      return next(error);
    }
  };

  validate = async (req, res) => {
    const token = bearerFromAuthorization(req.headers.authorization);
    if (!token) return res.status(401).json({ success: false, error: { code: 'MISSING_TOKEN', message: 'Bearer token required.' } });
    try {
      const decoded = this.auth.verifyAccessToken(token);
      const context = await this.auth.buildContext(decoded.id);
      if (!context) return res.status(401).json({ success: false, error: { code: 'INVALID_SESSION', message: 'Session is no longer active.' } });
      return res.json({ success: true, context });
    } catch {
      return res.status(401).json({ success: false, error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token.' } });
    }
  };
}

function bearerFromAuthorization(value) {
  return value?.startsWith('Bearer ') ? value.slice(7) : null;
}

module.exports = { AuthController };
