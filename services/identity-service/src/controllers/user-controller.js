const { sanitizeUser } = require('../services/auth-service');

class UserController {
  constructor({ users, permissions, audit, sequelize, config, logger }) {
    this.users = users;
    this.permissions = permissions;
    this.audit = audit;
    this.sequelize = sequelize;
    this.config = config;
    this.logger = logger;
  }

  list = async (req, res, next) => {
    try {
      const users = await this.users.list(req.query.role);
      return res.json({ success: true, count: users.length, data: users });
    } catch (error) { return next(error); }
  };

  listStaff = async (req, res, next) => {
    try { return res.json({ success: true, data: await this.users.listStaff() }); }
    catch (error) { return next(error); }
  };

  updateStaff = async (req, res, next) => {
    try {
      const user = await this.users.findById(req.params.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (['super_admin', 'admin'].includes(user.role) || ['super_admin', 'admin'].includes(req.body.role)) {
        return res.status(403).json({ success: false, message: 'Cannot modify or assign admin/super_admin users' });
      }
      const values = {};
      for (const field of ['name', 'phone', 'role']) if (req.body[field] !== undefined) values[field] = req.body[field];
      if (req.body.isActive !== undefined) values.isActive = Number(Boolean(req.body.isActive));
      if (values.role === 'doctor' && user.role !== 'doctor') await this.provisionDoctor(user);
      await this.users.update(user, values);
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'staff', recordId: user.id, newValue: { action: 'update_staff', name: user.name }, ipAddress: req.ip });
      return res.json({ success: true, data: sanitizeUser(user) });
    } catch (error) { return next(error); }
  };

  forceLogout = async (req, res, next) => {
    try {
      if (!(await this.users.forceLogout(req.params.userId))) return res.status(404).json({ success: false, message: 'User not found.' });
      await this.audit.record({ userId: req.user.id, action: 'FORCE_LOGOUT', module: 'security', recordId: req.params.userId, newValue: { target_user: req.params.userId }, ipAddress: req.ip });
      return res.json({ success: true, message: 'User session terminated.' });
    } catch (error) { return next(error); }
  };

  unlock = async (req, res, next) => {
    try {
      if (!(await this.users.unlock(req.params.id))) return res.status(404).json({ success: false, message: 'User not found.' });
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'security', recordId: req.params.id, newValue: { action: 'account_unlocked' }, ipAddress: req.ip });
      return res.json({ success: true, message: 'Account unlocked.' });
    } catch (error) { return next(error); }
  };

  create = async (req, res, next) => {
    try {
      const { username, password, name, first_name, last_name, phone, role, isActive, department_id } = req.body;
      if (!username || !password || !name) return res.status(400).json({ success: false, message: 'Please provide username, password, and name.' });
      if (await this.users.findByUsername(username, true)) return res.status(400).json({ success: false, message: 'Username already exists.' });
      const user = await this.users.create({ username: username.toLowerCase(), password, name, first_name: first_name || null, last_name: last_name || null, phone: phone || null, role: role || 'lab_technician', department_id: department_id || null, isActive: isActive === undefined ? 1 : Number(Boolean(isActive)), first_login: 'Y' });
      try {
        if (user.role === 'doctor') await this.provisionDoctor(user);
      } catch (error) {
        await this.users.delete(user).catch((compensationError) => this.logger.error({ err: compensationError, userId: user.id }, 'doctor user compensation failed'));
        throw error;
      }
      await this.audit.record({ userId: req.user.id, action: 'CREATE', module: 'admin', recordId: user.id, newValue: { username: user.username, role: user.role }, ipAddress: req.ip });
      return res.status(201).json({ success: true, data: sanitizeUser(user) });
    } catch (error) { return next(error); }
  };

  update = async (req, res, next) => {
    try {
      const user = await this.users.findById(req.params.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      const oldValue = { name: user.name, username: user.username, role: user.role, isActive: user.isActive };
      const values = {};
      for (const key of ['name', 'role', 'first_name', 'last_name', 'phone', 'department_id']) {
        if (req.body[key] !== undefined) values[key] = req.body[key];
      }
      if (req.body.isActive !== undefined) values.isActive = Number(Boolean(req.body.isActive));
      if (req.body.password) values.password = req.body.password;
      if (req.body.username && req.body.username.toLowerCase() !== user.username) {
        if (await this.users.findByUsername(req.body.username, true)) return res.status(400).json({ success: false, message: 'Username already taken.' });
        values.username = req.body.username.toLowerCase();
      }
      if (values.role === 'doctor' && user.role !== 'doctor') await this.provisionDoctor(user);
      await this.users.update(user, values);
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'admin', recordId: user.id, oldValue, newValue: { name: user.name, role: user.role }, ipAddress: req.ip });
      return res.json({ success: true, data: sanitizeUser(user) });
    } catch (error) { return next(error); }
  };

  password = async (req, res, next) => {
    try {
      if (!req.body.password) return res.status(400).json({ success: false, message: 'Please provide a new password.' });
      const user = await this.users.findById(req.params.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      await this.users.update(user, { password: req.body.password, first_login: 'Y' });
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'admin', recordId: user.id, newValue: { action: 'admin_password_reset' }, ipAddress: req.ip });
      return res.json({ success: true, message: 'Password updated successfully.' });
    } catch (error) { return next(error); }
  };

  toggleActive = async (req, res, next) => {
    try {
      const user = await this.users.findById(req.params.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      const previous = user.isActive;
      await this.users.update(user, { isActive: user.isActive ? 0 : 1 });
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'admin', recordId: user.id, oldValue: { isActive: previous }, newValue: { isActive: user.isActive }, ipAddress: req.ip });
      return res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}.`, isActive: user.isActive });
    } catch (error) { return next(error); }
  };

  history = async (req, res, next) => {
    try { return res.json({ success: true, data: await this.audit.repository.loginHistory(req.params.id) }); }
    catch (error) { return next(error); }
  };

  listPermissions = async (req, res, next) => {
    try { return res.json({ success: true, data: await this.permissions.list() }); }
    catch (error) { return next(error); }
  };

  updatePermissions = async (req, res, next) => {
    if (!Array.isArray(req.body.permissions)) return res.status(400).json({ success: false, message: 'Permissions array required.' });
    try {
      await this.sequelize.transaction(async (transaction) => this.permissions.replaceMany(req.body.permissions, transaction));
      await this.audit.record({ userId: req.user.id, action: 'UPDATE', module: 'admin', newValue: { action: 'permissions_updated', count: req.body.permissions.length }, ipAddress: req.ip });
      return res.json({ success: true, message: 'Permissions updated.' });
    } catch (error) { return next(error); }
  };

  remove = async (req, res, next) => {
    try {
      const user = await this.users.findById(req.params.id, true);
      if (!user) return res.status(404).json({ success: false, message: 'User not found' });
      if (user.id === req.user.id) return res.status(400).json({ success: false, message: 'You cannot delete your own account.' });
      await this.audit.record({ userId: req.user.id, action: 'DELETE', module: 'admin', recordId: user.id, oldValue: { username: user.username, role: user.role }, ipAddress: req.ip });
      await this.users.delete(user);
      return res.json({ success: true, message: 'User deleted.' });
    } catch (error) {
      if (error.name === 'SequelizeForeignKeyConstraintError') return res.status(400).json({ success: false, message: 'Failed to delete user. They may be linked to existing records. Consider deactivating the account instead.' });
      return next(error);
    }
  };

  provisionDoctor = async (user) => {
    try {
      const response = await fetch(`${this.config.monolithUrl}/internal/compat/doctor-profiles`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-internal-service-token': this.config.internalServiceSecret },
        body: JSON.stringify({ userId: user.id }),
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
      });
      if (!response.ok) throw new Error(`doctor profile compatibility endpoint returned ${response.status}`);
    } catch (error) {
      this.logger.error({ err: error, userId: user.id }, 'doctor profile provisioning failed');
      error.statusCode = 502;
      error.code = 'DOCTOR_PROFILE_PROVISION_FAILED';
      throw error;
    }
  };
}

module.exports = { UserController };
