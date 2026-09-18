const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const securitySettings = require('../utils/settings');

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

    // Check if account is active
    if (!user.isActive) {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'account_inactive' }, ip);
      return res.status(403).json({ success: false, message: 'Account is deactivated. Contact your administrator.' });
    }

    // Check if account is locked
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'account_locked' }, ip);
      return res.status(423).json({
        success: false,
        message: 'Account locked due to too many failed attempts.',
        lockedUntil: user.locked_until,
      });
    }

    // Check maintenance mode
    if (securitySettings.maintenance_mode && user.role !== 'super_admin') {
      await logAction(user.id, 'LOGIN_FAILED', 'auth', null, null, { reason: 'maintenance_mode' }, ip);
      return res.status(503).json({
        success: false,
        message: securitySettings.maintenance_message,
      });
    }

    // Compare password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      // Increment failed attempts
      const attempts = (user.failed_attempts || 0) + 1;
      const updateData = { failed_attempts: attempts };

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

    // Successful login — reset failed_attempts, update last_login
    await User.update(
      { failed_attempts: 0, locked_until: null, last_login: new Date() },
      { where: { id: user.id } }
    );

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    await logAction(user.id, 'LOGIN', 'auth', null, null, { role: user.role }, ip);

    res.json({
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
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword; // beforeUpdate hook will hash it
    user.first_login = 'N';
    await user.save();

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
    const resetToken = jwt.sign(
      { id: user.id, purpose: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

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
      decoded = jwt.verify(resetToken, process.env.JWT_SECRET);
    } catch (e) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    if (decoded.purpose !== 'password_reset') {
      return res.status(400).json({ success: false, message: 'Invalid reset token.' });
    }

    const user = await User.findByPk(decoded.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    user.password = newPassword; // hook hashes it
    user.otp_code = null;
    user.otp_expires = null;
    user.first_login = 'N';
    await user.save();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(user.id, 'UPDATE', 'auth', user.id, null, { action: 'password_reset' }, ip);

    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── POST /api/auth/emergency-reset ─────────────────────────────
router.post('/emergency-reset', protect, async (req, res) => {
  try {
    if (req.user.role !== 'super_admin' && process.env.NODE_ENV !== 'development') {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }
    const hashedPasswordDoctor = await bcrypt.hash('doctor@123', 10);
    const hashedPasswordReceptionist = await bcrypt.hash('receptionist@123', 10);

    await User.update({ password: hashedPasswordDoctor }, { where: { username: 'doctor_user' } });
    await User.update({ password: hashedPasswordReceptionist }, { where: { username: 'receptionist_user' } });

    res.json({ success: true, message: "Passwords for doctor_user and receptionist_user have been reset to defaults." });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Server error during reset." });
  }
});

module.exports = router;