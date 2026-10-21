const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const User = require('../models/User');
const { sequelize } = require('../models/db');
const { protect } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { setActor } = require('../utils/auditContext');
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

    // Successful login — reset failed_attempts, update last_login (attributed to this user in the audit)
    setActor({ id: user.id });
    await User.update(
      { failed_attempts: 0, locked_until: null, last_login: new Date() },
      { where: { id: user.id } }
    );

    const session = await createSession(user.id, req);
    const token = signSessionToken(user, session.id,session.facilityId);
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
        facilityId:session.facilityId,
        facilityTimezone:session.facilityTimezone,
      },
      first_login: user.first_login || 'N',
    });
  } catch (err) {
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
    res.status(err.status || 500).json({ success: false, ...(err.code ? {code:err.code}:{}), message: err.status ? err.message : 'Server error.' });
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

router.get('/facilities',protect,async(req,res)=>{
  try{res.set('Cache-Control','no-store');res.json({success:true,data:await require('../services/facilityMemberships.cts').available(req.user.id)});}
  catch(error){res.status(error.status||503).json({success:false,code:error.code||'FACILITY_OBSERVATION_UNAVAILABLE',message:error.status?error.message:'Your facility memberships could not be confirmed.'});}
});
// Session credentials never enter command receipts. A switch creates a new
// facility-bound session and revokes only this device's previous session.
router.post('/facility-session',protect,async(req,res)=>{
  try{
    if(require('../middleware/auth').identityServiceEnabled())return res.status(409).json({success:false,code:'IDENTITY_FACILITY_SWITCH_REQUIRED',message:'Switch the facility through the configured authoritative identity service.'});
    if(!req.body||Object.keys(req.body).some(k=>k!=='facility_id')||!require('../services/identities.cts').isUuid(req.body.facility_id))return res.status(422).json({success:false,code:'INVALID_FACILITY_ID',message:'Select an exact facility UUID.'});
    const session=await sequelize.transaction(async transaction=>{
      const [old]=await sequelize.query('SELECT id FROM hms_sessions WHERE id=:sid AND user_id=:user AND revoked_at IS NULL AND expires_at>now() FOR UPDATE',{replacements:{sid:req.user.sessionId,user:req.user.id},type:'SELECT',transaction});
      if(!old)throw Object.assign(new Error('This session is no longer active. Sign in again.'),{status:401,code:'SESSION_ENDED'});
      const created=await createSession(req.user.id,req,req.body.facility_id,transaction);
      await sequelize.query("UPDATE hms_sessions SET revoked_at=now(),revoked_reason='facility context switched' WHERE id=:sid",{replacements:{sid:old.id},transaction});
      await sequelize.query("INSERT INTO hms_audit_logs(user_id,action,module,new_value) VALUES(:user,'SWITCH','facility_session',:value)",{replacements:{user:req.user.id,value:JSON.stringify({from:req.user.facilityId,to:created.facilityId,session_id:created.id})},transaction});return created;
    });
    const token=signSessionToken(req.user,session.id,session.facilityId);setSessionCookie(req,res,token);
    req.app.get('io')?.in(`session:${req.user.sessionId}`).disconnectSockets(true);
    res.set('Cache-Control','no-store');res.json({success:true,...(req.get('X-Auth-Transport')==='bearer'?{token}:{}),user:{...req.user,sessionId:session.id,facilityId:session.facilityId,facilityTimezone:session.facilityTimezone}});
  }catch(error){res.status(error.status||503).json({success:false,code:error.code||'FACILITY_SWITCH_UNCONFIRMED',message:error.status?error.message:'The facility switch could not be confirmed. Sign in again before continuing.'});}
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
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
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

    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });
      const reject = (message, status = 400) => { const error = new Error(message); error.status = status; throw error; };
      if (!user) reject('User not found.', 404);
      if (!await user.comparePassword(currentPassword)) reject('Current password is incorrect.');
      if (await user.comparePassword(newPassword)) reject('Choose a new password that is different from the current one.');
      user.password = newPassword;
      user.first_login = 'N';
      await user.save({ transaction });
      await revokeUserSessions(user.id, 'password changed', { transaction, io: req.app.get('io'), exceptSessionId: req.user.sessionId || null });
    });
    const user = { id: req.user.id };

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(user.id, 'UPDATE', 'auth', user.id, null, { action: 'password_changed' }, ip);

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Server error.' });
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
    const sent = { success: true, message: 'OTP generated. Please check your registered contact.' };

    // The answer is the same whether or not the account exists, so this cannot be used to find
    // usernames or phone numbers.
    if (!user) return res.json(sent);

    // Generate 6-digit OTP from a cryptographic source.
    const otp = String(crypto.randomInt(100000, 1000000));
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    await User.update(
      { otp_code: otp, otp_expires: otpExpires },
      { where: { id: user.id } }
    );

    const responsePayload = { ...sent };

    if (process.env.NODE_ENV === 'development' && process.env.EXPOSE_DEV_OTP === 'true') {
      responsePayload.dev_otp = otp;
    }

    res.json(responsePayload);
  } catch (err) {
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
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

    // One guess per code: a wrong code cancels it, so guessing needs a new code each time, and
    // requesting codes is rate-limited. The comparison takes the same time for every guess.
    const given = Buffer.from(String(otp));
    const expected = Buffer.from(String(user?.otp_code || ''));
    const matches = Boolean(user?.otp_code) && given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!matches) {
      if (user?.otp_code) await User.update({ otp_code: null, otp_expires: null }, { where: { id: user.id } });
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Request a new one.' });
    }

    if (!user.otp_expires || new Date(user.otp_expires) < new Date()) {
      await User.update({ otp_code: null, otp_expires: null }, { where: { id: user.id } });
      return res.status(400).json({ success: false, message: 'Invalid or expired OTP. Request a new one.' });
    }

    // Generate short-lived reset token
    const resetToken = signPasswordResetToken(user);

    res.json({ success: true, resetToken });
  } catch (err) {
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
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

    await sequelize.transaction(async (transaction) => {
      const user = await User.findByPk(decoded.id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!user || !resetTokenMatchesUser(decoded, user)) {
        const error = new Error('Invalid or expired reset token.'); error.status = 400; throw error;
      }
      setActor(user);
      await sequelize.query("SELECT set_config('hms.actor_user_id', :actor, true)", { replacements: { actor: String(user.id) }, transaction });
      user.password = newPassword;
      user.otp_code = null;
      user.otp_expires = null;
      user.first_login = 'N';
      await user.save({ transaction });
      await revokeUserSessions(user.id, 'password reset', { transaction, io: req.app.get('io') });
    });
    const user = { id: decoded.id };

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(user.id, 'UPDATE', 'auth', user.id, null, { action: 'password_reset' }, ip);

    res.json({ success: true, message: 'Password has been reset successfully.' });
  } catch (err) {
    if (!err.status) console.error('Authentication operation failed:', err.code || err.name);
    res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Server error.' });
  }
});

module.exports = router;
