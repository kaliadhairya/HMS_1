const { Op } = require('sequelize');

class AuditRepository {
  constructor(AuditLog) {
    this.AuditLog = AuditLog;
  }

  async create(entry, options = {}) {
    if (entry.idempotency_key) {
      const existing = await this.AuditLog.findOne({ where: { idempotency_key: entry.idempotency_key } });
      if (existing) return { record: existing, created: false };
    }
    const record = await this.AuditLog.create(entry, options);
    return { record, created: true };
  }

  loginHistory(userId) {
    return this.AuditLog.findAll({
      where: { user_id: userId, action: { [Op.in]: ['LOGIN', 'LOGIN_FAILED', 'LOGOUT'] } },
      order: [['created_at', 'DESC']],
      limit: 20,
    });
  }
}

module.exports = { AuditRepository };
