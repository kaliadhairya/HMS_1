const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { signSessionToken, signPasswordResetToken, verifyPasswordResetToken, resetTokenMatchesUser } = require('../utils/authTokens');
const { createSession, revokeSession, revokeUserSessions, setSessionCookie, clearSessionCookie } = require('../utils/sessions');
const securitySettings = require('../utils/settings');
const { ipAccess } = require('./security');

const { body, validationResult } = require('express-validator');

// ─── POST /api/auth/login ───────────────────────────────────────
router.post('/login', [
  body('username').trim().escape()
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  try {
    const { username, password } = req.body;
    const ip = req.ip || req.connection?.remoteAddress || null;

    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password are required.' });
    }

    // Retrieve user record
    const users = await User.findAll({
      where: { username: username.toLowerCase() },
    });
    const user = users.length > 0 ? users[0] : null;

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // IP allow/block lists from the security centre
    if (!ipAccess.isAllowed(ip, securitySettings)) {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'ip_blocked' }, ip);
      return res.status(403).json({ success: false, message: 'Sign-in from this network address is not allowed. Contact your administrator.' });
    }

    // Check if account is locked
    const lockActive = user.locked_until && new Date(user.locked_until) > new Date();
    if (lockActive) {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'account_locked' }, ip);
      return res.status(423).json({
        success: false,
        message: 'Account locked due to too many failed attempts.',
        lockedUntil: user.locked_until,
      });
    }

    // Compare password before revealing anything else about the account
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Increment failed attempts. A lock that has run out starts a fresh count, so one more
      // mistake after the lock expires does not lock the account again straight away.
      const previous = user.locked_until ? 0 : (user.failed_attempts || 0);
      const attempts = previous + 1;
      const updateData = { failed_attempts: attempts, locked_until: null };

      if (attempts >= 5) {
        const lockUntil = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        updateData.locked_until = lockUntil;
      }

      await User.update(updateData, { where: { id: user.id } });
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { attempts }, ip);

      if (attempts >= 5) {
        return res.status(423).json({
          success: false,
          message: 'Account locked due to too many failed attempts. Try again in 15 minutes.',
          lockedUntil: updateData.locked_until,
        });
      }

      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    // Check if account is active (only told to someone who knows the password)
    if (!user.isActive) {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'account_inactive' }, ip);
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact your administrator.' });
    }

    // Check maintenance mode
    if (securitySettings.maintenance_mode && user.role !== 'super_admin') {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'maintenance_mode' }, ip);
      return res.status(503).json({
        success: false,
        message: securitySettings.maintenance_message,
      });
    }

    // Successful login — reset failed_attempts, update last_login
    await User.update(
      { failed_attempts: 0, locked_until: null, last_login: new Date() },
      { where: { id: user.id } }
    );

    const session = await createSession(user.id, req);
    const token = signSessionToken(user, session.id);
    // Browsers get the token only as an HttpOnly cookie, out of reach of page
    // scripts. Scripts and services ask for it with X-Auth-Transport: bearer.
    setSessionCookie(req, res, token);
    const wantsBearer = req.headers['x-auth-transport'] === 'bearer';

    await logAction(user.id, 'LOGIN', 'auth', null, null, { role: user.role }, ip);

    res.json({
      success: true,
      ...(wantsBearer ? { token } : {}),
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role,
      },
      first_login: user.first_login || 'N',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/auth/me ───────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({
    success: true,
    user: req.user,
    first_login: req.user.first_login || 'N',
  });
});

// ─── POST /api/auth/logout ──────────────────────────────────────
router.post('/logout', protect, async (req, res) => {
  try {
    if (req.user.sessionId) {
      await revokeSession(req.user.sessionId, 'signed out');
      req.app.get('io')?.in(`session:${req.user.sessionId}`).disconnectSockets(true);
    }
    clearSessionCookie(req, res);
    await logAction(req.user.id, 'LOGOUT', 'auth', null, null, null, req.ip || null);
    res.json({ success: true, message: 'Signed out.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/auth/change-password ─────────────────────────────
router.post('/change-password', protect, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new password are required.' });
    }

    // Validate password strength
    const strongRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!strongRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.',
      });
    }

    // Get user with password
    const user = await User.findByPk(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      // 400, not 401: the session is valid, and the web client signs the user out on any 401.
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }
    if (await user.comparePassword(newPassword)) {
      return res.status(400).json({ success: false, message: 'Choose a new password that is different from the current one.' });
    }

    user.password = newPassword; // beforeUpdate hook will hash it
    user.first_login = 'N';
    await user.save();
    // Sign out every other device; this one stays signed in.
    await revokeUserSessions(user.id, 'password changed', { io: req.app.get('io'), exceptSessionId: req.user.sessionId || null });

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(user.id, 'UPDATE', 'auth', user.id, null, { action: 'password_changed' }, ip);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/auth/forgot-password ─────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { usernameOrPhone } = req.body;

    if (!usernameOrPhone) {
      return res.status(400).json({ success: false, message: 'Username or phone is required.' });
    }

    // Try to find by username first, then by phone
    let users = await User.findAll({ where: { username: usernameOrPhone.toLowerCase() } });
    if (users.length === 0) {
      users = await User.findAll({ where: { phone: usernameOrPhone } });
    }
    const user = users.length > 0 ? users[0] : null;

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Generate 6-digit OTP
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.update(
      { otp_code: otp, otp_expires: otpExpires },
      { where: { id: user.id } }
    );

    const responsePayload = {
      success: true,
      message: 'OTP generated. Please check your registered contact.',
    };

    if (process.env.NODE_ENV === 'development' && process.env.EXPOSE_DEV_OTP === 'true') {
      responsePayload.dev_otp = otp;
    }

    res.json(responsePayload);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/auth/verify-otp ──────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { username, otp } = req.body;

    if (!username || !otp) {
      return res.status(400).json({ success: false, message: 'Username and OTP are required.' });
    }

    const users = await User.findAll({ where: { username: username.toLowerCase() } });
    const user = users.length > 0 ? users[0] : null;

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.otp_code !== otp) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    if (!user.otp_expires || new Date(user.otp_expires) < new Date()) {
      return res.status(400).json({ success: false, message: 'OTP has expired.' });
    }

    // Generate short-lived reset token
    const resetToken = signPasswordResetToken(user);

    res.json({ success: true, resetToken });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/auth/reset-password ──────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({ success: false, message: 'Reset token and new password are required.' });
    }

    // Validate password strength
    const strongRegex = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
    if (!strongRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.',
      });
    }

    let decoded;
    try {
      decoded = verifyPasswordResetToken(resetToken);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    const user = await User.findByPk(decoded.id);
    if (!user || !resetTokenMatchesUser(decoded, user)) {
      // A changed password means this token was already used.
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    user.password = newPassword; // hook hashes it
    user.otp_code = null;
    user.otp_expires = null;
    user.first_login = 'N';
    await user.save();
    await revokeUserSessions(user.id, 'password reset', { io: req.app.get('io') });

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(user.id, 'UPDATE', 'auth', user.id, null, { action: 'password_reset' }, ip);

    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;