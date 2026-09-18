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
router.put('/:id', async (req, res) => {
  try {
    const { name, username, role, isActive, password, first_name, last_name, phone } = req.body;
    const user = await User.findByPk(req.params.id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
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
    if (isActive !== undefined) user.isActive = isActive;
    if (password) user.password = password;
    if (first_name !== undefined) user.first_name = first_name;
    if (last_name !== undefined) user.last_name = last_name;
    if (phone !== undefined) user.phone = phone;

    await user.save();

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
router.put('/:id/password', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ success: false, message: 'Please provide a new password.' });
    }

    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.password = password;
    user.first_login = 'Y';
    await user.save();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', user.id, null, { action: 'admin_password_reset' }, ip);

    res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('Error changing password:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── PATCH /api/users/:id/toggle-active ─────────────────────────
router.patch('/:id/toggle-active', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const oldActive = user.isActive;
    user.isActive = user.isActive ? 0 : 1;
    await user.save();

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
router.get('/:id/login-history', async (req, res) => {
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

    for (const perm of permissions) {
      const existing = await Permission.findAll({
        where: { role: perm.role, module: perm.module },
      });

      if (existing.length > 0) {
        await Permission.update(
          {
            can_read: perm.can_read,
            can_write: perm.can_write,
            can_edit: perm.can_edit,
            can_delete: perm.can_delete,
          },
          { where: { role: perm.role, module: perm.module } }
        );
      } else {
        await Permission.create(perm);
      }
    }

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'admin', null, null, { action: 'permissions_updated', count: permissions.length }, ip);

    res.json({ success: true, message: 'Permissions updated.' });
  } catch (err) {
    console.error('Error updating permissions:', err);
    res.status(500).json({ success: false, message: 'Server Error' });
  }
});

// ─── DELETE /api/users/:id ──────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const user = await User.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (user.id === req.user.id) {
      return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
    }

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'DELETE', 'admin', user.id, { username: user.username, role: user.role }, null, ip);

    // Cascade delete doctor profile if it exists
    if (user.role === 'doctor') {
      await Doctor.destroy({ where: { user_id: user.id } });
    }

    await user.destroy();
    res.json({ success: true, message: 'User deleted.' });
  } catch (err) {
    console.error('Error deleting user:', err);
    res.status(400).json({
      success: false,
      message: 'Failed to delete user. They may be linked to existing records. Consider deactivating the account instead.',
    });
  }
});

module.exports = router;
