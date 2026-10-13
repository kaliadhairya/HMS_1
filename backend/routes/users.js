const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const User = require('../models/User');
const Doctor = require('../models/Doctor');
const Permission = require('../models/Permission');
const AuditLog = require('../models/AuditLog');
const { protect, restrictTo } = require('../middleware/auth');
const bcrypt = require('bcryptjs');
const { logAction } = require('../utils/auditLogger');
const { revokeUserSessions } = require('../utils/sessions');
const { ensurePractitioner } = require('../utils/practitioners');
const { sequelize } = require('../models/db');

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];
// Same rule as /api/auth/change-password, so an account never starts with a password the user could not set.
const STRONG_PASSWORD = /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{8,}$/;
const PASSWORD_RULE = 'Password must be min 8 chars with 1 uppercase, 1 number, and 1 special character.';

// Only a super admin may create, change or remove super admin accounts, or hand out the super admin role.
function superAdminGuard(req, targetRole, newRole) {
  if (req.user.role === 'super_admin') return null;
  if (targetRole === 'super_admin') return 'Only a super admin can change a super admin account.';
  if (newRole === 'super_admin') return 'Only a super admin can assign the super admin role.';
  return null;
}

// Columns that tie a staff account to clinical, billing or pharmacy records. No foreign keys exist in the
// database, so deleting an account referenced here would silently orphan those records.
const USER_REFERENCES = [
  ['HMS_ENCOUNTERS', 'DOCTOR_ID', 'consultations'],
  ['HMS_PRESCRIPTIONS', 'DOCTOR_ID', 'prescriptions'],
  ['HMS_INVESTIGATION_ORDERS', 'DOCTOR_ID', 'investigation orders'],
  ['HMS_APPOINTMENTS', 'DOCTOR_ID', 'appointments'],
  ['HMS_APPOINTMENTS', 'BOOKED_BY', 'booked appointments'],
  ['HMS_TOKENS', 'DOCTOR_ID', 'OPD tokens'],
  ['HMS_TOKENS', 'GENERATED_BY', 'issued OPD tokens'],
  ['HMS_ADMISSIONS', 'ADMITTING_DOCTOR_ID', 'admissions'],
  ['HMS_ADMISSIONS', 'CREATED_BY', 'admissions recorded'],
  ['HMS_IPD_REQUESTS', 'DOCTOR_ID', 'admission requests'],
  ['HMS_PROGRESS_NOTES', 'DOCTOR_ID', 'progress notes'],
  ['HMS_DISCHARGE_SUMMARIES', 'CREATED_BY', 'discharge summaries'],
  ['HMS_REFERRALS', 'FROM_DOCTOR_ID', 'referrals'],
  ['HMS_REST_FORMS', 'DOCTOR_ID', 'medical certificates'],
  ['HMS_VITALS', 'RECORDED_BY', 'vitals'],
  ['HMS_IPD_VITALS', 'RECORDED_BY', 'inpatient vitals'],
  ['HMS_NURSING_NOTES', 'NURSE_ID', 'nursing notes'],
  ['HMS_MAR_RECORDS', 'ADMINISTERED_BY', 'medication administrations'],
  ['HMS_ALLERGIES', 'NOTED_BY', 'allergy records'],
  ['HMS_TEST_REPORTS', 'REPORTED_BY', 'lab reports'],
  ['HMS_PATIENT_DOCUMENTS', 'UPLOADED_BY', 'patient documents'],
  ['HMS_BILLS', 'CREATED_BY', 'bills'],
  ['HMS_BILLS', 'DISCOUNT_APPROVED_BY', 'approved discounts'],
  ['HMS_PAYMENTS', 'RECEIVED_BY', 'payments'],
  ['HMS_PATIENT_ADVANCES', 'RECEIVED_BY', 'advance receipts'],
  ['HMS_DISPENSING_RECORDS', 'DISPENSED_BY', 'dispensing records'],
  ['HMS_OTC_SALES', 'SOLD_BY', 'counter sales'],
  ['HMS_STOCK_LEDGER', 'PERFORMED_BY', 'stock movements'],
  ['HMS_PURCHASE_ORDERS', 'CREATED_BY', 'purchase orders'],
  ['HMS_DEPARTMENTS', 'HEAD_DOCTOR_ID', 'department head roles'],
  ['HMS_TARIFFS', 'DOCTOR_ID', 'tariffs'],
];

async function linkedRecords(userId) {
  // Some older appointment/token rows store the doctor profile ID (HMS_DOCTORS.ID) instead of the user ID.
  const profiles = await Doctor.findAll({ where: { user_id: userId }, attributes: ['id'] });
  const doctorIds = [userId, ...profiles.map((d) => d.id)];
  const selects = USER_REFERENCES.map(([table, column], i) => (
    `(SELECT COUNT(*) FROM ${table} WHERE ${column} IN (${/DOCTOR_ID$/.test(column) ? ':doctorIds' : ':id'})) AS C${i}`
  ));
  const [rows] = await sequelize.query(`SELECT ${selects.join(', ')}`, { replacements: { id: userId, doctorIds } });
  const row = rows[0] || {};
  return USER_REFERENCES
    .map(([, , label], i) => ({ label, count: Number(row[`C${i}`] ?? row[`c${i}`] ?? 0) }))
    .filter((r) => r.count > 0);
}

// Apply protection — restrict to admin and super_admin
router.use(protect);
router.use(restrictTo('admin', 'super_admin'));

// ─── GET /api/users ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const where = {};
    if (req.query.role) {
      where.role = req.query.role;
    }

    const users = await User.findAll({
      where,
      attributes: { exclude: ['password', 'otp_code', 'otp_expires'] },
      order: [['id', 'DESC']],
    });
    res.json({ success: true, count: users.length, data: users });
  } catch (err) {
    console.error('Error fetching users:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── POST /api/users ────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { username, password, name, first_name, last_name, phone, role, isActive } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ success: false, message: 'Please provide username, password, and name.' });
    }
    if (role !== undefined && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Unknown role.' });
    }
    const denied = superAdminGuard(req, null, role);
    if (denied) return res.status(403).json({ success: false, message: denied });
    if (!STRONG_PASSWORD.test(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_RULE });
    }

    const existingUser = await User.findOne({ where: { username: username.toLowerCase() } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Username already exists.' });
    }

    const user = await User.create({
      username: username.toLowerCase(),
      password,
      name,
      first_name: first_name || null,
      last_name: last_name || null,
      phone: phone || null,
      role: role || 'lab_technician',
      isActive: isActive !== undefined ? isActive : 1,
      first_login: 'Y',
    });
    if (user.role === 'doctor') await ensurePractitioner(user.id);

    if (user.role === 'doctor') {
      try {
        await Doctor.create({
          user_id: user.id,
          speciality: 'General Physician'
        });
      } catch (err) {
        console.error('Failed to create doctor profile:', err);
      }
    }

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'admin', user.id, null, { username: user.username, role: user.role }, ip);

    const userRes = user.toJSON();
    delete userRes.password;
    res.status(201).json({ success: true, data: userRes });
  } catch (err) {
    console.error('Error creating user:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── PUT /api/users/:id ─────────────────────────────────────────
router.put('/:id(\\d+)', async (req, res) => {
  try {
    const { name, username, role, isActive, password, first_name, last_name, phone } = req.body;
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    if (role !== undefined && role !== '' && !ROLES.includes(role)) {
      return res.status(400).json({ success: false, message: 'Unknown role.' });
    }
    const denied = superAdminGuard(req, user.role, role);
    if (denied) return res.status(403).json({ success: false, message: denied });
    if (user.id === req.user.id) {
      if (role && role !== user.role) {
        return res.status(400).json({ success: false, message: 'You cannot change your own role.' });
      }
      if (isActive !== undefined && !Number(isActive)) {
        return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
      }
    }
    if (password && !STRONG_PASSWORD.test(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_RULE });
    }

    const oldData = { name: user.name, username: user.username, role: user.role, isActive: user.isActive };

    if (username && username.toLowerCase() !== user.username) {
      const existingUser = await User.findOne({ where: { username: username.toLowerCase() } });
      if (existingUser) {
        return res.status(400).json({ success: false, message: 'Username already taken.' });
      }
      user.username = username.toLowerCase();
    }

    if (name) user.name = name;
    if (role) user.role = role;
    if (isActive !== undefined) user.isActive = Number(isActive) ? 1 : 0;
    if (password) user.password = password;
    if (first_name !== undefined) user.first_name = first_name;
    if (last_name !== undefined) user.last_name = last_name;
    if (phone !== undefined) user.phone = phone;

    await user.save();
    if (user.role === 'doctor') await ensurePractitioner(user.id);
    // A new password, a role change or deactivation ends the account's current sessions.
    const roleChanged = role && role !== oldData.role;
    if (password || roleChanged || (isActive !== undefined && !user.isActive)) {
      await revokeUserSessions(user.id, password ? 'password reset by administrator' : roleChanged ? 'role changed' : 'account deactivated', { io: req.app.get('io') });
    }

    if (user.role === 'doctor') {
      try {
        // Fetch associated doctor profile
        const docRows = await Doctor.findAll({ where: { user_id: user.id } });
        let doc = docRows.length > 0 ? docRows[0] : null;
        if (!doc) {
          await Doctor.create({
            user_id: user.id,
            speciality: 'General Physician'
          });
        }
      } catch (err) {
        console.error('Failed to update doctor profile:', err);
      }
    }

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', user.id, oldData, { name: user.name, role: user.role }, ip);

    const userRes = user.toJSON();
    delete userRes.password;
    res.json({ success: true, data: userRes });
  } catch (err) {
    console.error('Error updating user:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── PUT /api/users/:id/password ────────────────────────────────
router.put('/:id(\\d+)/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Please provide a new password.' });
    }

    if (!STRONG_PASSWORD.test(password)) {
      return res.status(400).json({ success: false, message: PASSWORD_RULE });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const denied = superAdminGuard(req, user.role);
    if (denied) return res.status(403).json({ success: false, message: denied });

    user.password = password;
    user.first_login = 'Y';
    await user.save();
    await revokeUserSessions(user.id, 'password reset by administrator', { io: req.app.get('io') });

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', user.id, null, { action: 'admin_password_reset' }, ip);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── PATCH /api/users/:id/toggle-active ─────────────────────────
router.patch('/:id(\\d+)/toggle-active', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const denied = superAdminGuard(req, user.role);
    if (denied) return res.status(403).json({ success: false, message: denied });
    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot deactivate your own account.' });
    }

    const oldActive = user.isActive;
    user.isActive = user.isActive ? 0 : 1;
    await user.save();
    if (!user.isActive) await revokeUserSessions(user.id, 'account deactivated', { io: req.app.get('io') });

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', user.id,
      { isActive: oldActive }, { isActive: user.isActive }, ip);

    res.json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'}.`,
      isActive: user.isActive,
    });
  } catch (err) {
    console.error('Error toggling active:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── GET /api/users/:id/login-history ───────────────────────────
router.get('/:id(\\d+)/login-history', async (req, res) => {
  try {
    const loginLogs = await AuditLog.findAll({
      where: {
        user_id: req.params.id,
        action: { [Op.in]: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] },
      },
      order: [['created_at', 'DESC']],
      limit: 20,
    });

    res.json({ success: true, data: loginLogs });
  } catch (err) {
    console.error('Error fetching login history:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── GET /api/permissions ───────────────────────────────────────
router.get('/permissions', async (req, res) => {
  try {
    const permissions = await Permission.findAll({
      order: [['role', 'ASC'], ['module', 'ASC']],
    });
    res.json({ success: true, data: permissions });
  } catch (err) {
    console.error('Error fetching permissions:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── PUT /api/permissions ───────────────────────────────────────
router.put('/permissions', restrictTo('super_admin'), async (req, res) => {
  try {
    const { permissions } = req.body; // Array of { role, module, can_read, can_write, can_edit, can_delete }

    if (!permissions || !Array.isArray(permissions)) {
      return res.status(400).json({ success: false, message: 'Permissions array required.' });
    }

    const FLAGS = ['can_read', 'can_write', 'can_edit', 'can_delete'];
    const bad = permissions.find((p) => !ROLES.includes(p?.role) || !/^[a-z_]{2,50}$/.test(p?.module || '')
      || FLAGS.some((f) => !['Y', 'N'].includes(p[f])));
    if (bad) {
      return res.status(400).json({ success: false, message: 'Each permission needs a known role, a module and Y/N flags.' });
    }

    // All or nothing: a failure part-way used to leave the matrix half saved.
    await sequelize.transaction(async (transaction) => {
      for (const perm of permissions) {
        const flags = { can_read: perm.can_read, can_write: perm.can_write, can_edit: perm.can_edit, can_delete: perm.can_delete };
        const existing = await Permission.findAll({ where: { role: perm.role, module: perm.module }, transaction });
        if (existing.length > 0) {
          await Permission.update(flags, { where: { role: perm.role, module: perm.module }, transaction });
          continue;
        }
        // No row means no access, so a row that grants nothing is not created.
        if (FLAGS.every((f) => perm[f] === 'N')) continue;
        // The Permission model's ID is not auto-increment (Sequelize sent NULL, so every new row failed).
        const [[seq]] = await sequelize.query(`SELECT nextval('hms_permissions_seq') AS "ID"`, { transaction });
        await Permission.create({ id: Number(seq.ID), role: perm.role, module: perm.module, ...flags }, { transaction });
      }
    });

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', null, null, { action: 'permissions_updated', count: permissions.length }, ip);

    res.json({ success: true, message: 'Permissions updated.' });
  } catch (err) {
    console.error('Error updating permissions:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── DELETE /api/users/:id ──────────────────────────────────────
router.delete('/:id(\\d+)', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }
    const denied = superAdminGuard(req, user.role);
    if (denied) return res.status(403).json({ success: false, message: denied });

    // Accounts that appear on clinical, billing or pharmacy records are kept so those records stay attributable.
    const linked = await linkedRecords(user.id);
    if (linked.length > 0) {
      const summary = linked.map((r) => `${r.count} ${r.label}`).join(', ');
      return res.status(409).json({
        success: false,
        message: `${user.name || user.username} cannot be deleted because the account is linked to existing records (${summary}). Deactivate the account instead.`,
        linked,
      });
    }

    const ip = req.ip || req.connection?.remoteAddress || null;
    await sequelize.transaction(async (transaction) => {
      // The doctor profile goes with the account, in the same transaction.
      await Doctor.destroy({ where: { user_id: user.id }, transaction });
      await user.destroy({ transaction });
    });
    await logAction(req.user.id, 'DELETE', 'admin', user.id, { username: user.username, role: user.role }, null, ip);
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user. Consider deactivating the account instead.',
    });
  }
});

module.exports = router;
