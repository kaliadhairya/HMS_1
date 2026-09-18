const { Op, literal } = require('sequelize');

function publicAttributes() {
  return { exclude: ['password', 'otp_code', 'otp_expires'] };
}

class UserRepository {
  constructor(User) {
    this.User = User;
  }

  findById(id, includeSecrets = false, options = {}) {
    return this.User.findByPk(id, {
      ...options,
      attributes: includeSecrets ? undefined : publicAttributes(),
    });
  }

  findByUsername(username, includeSecrets = false) {
    return this.User.findOne({
      where: { username: username.toLowerCase() },
      attributes: includeSecrets ? undefined : publicAttributes(),
    });
  }

  findByUsernameOrPhone(value) {
    return this.User.findOne({
      where: {
        [Op.or]: [
          { username: String(value).toLowerCase() },
          { phone: String(value) },
        ],
      },
    });
  }

  async isLocked(id, transaction) {
    return (await this.User.count({
      where: { id, locked_until: { [Op.gt]: literal('CURRENT_TIMESTAMP') } },
      transaction,
    })) > 0;
  }

  async recordFailedLogin(id) {
    return this.User.sequelize.transaction(async (transaction) => {
      const user = await this.User.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      const attempts = (user.failed_attempts || 0) + 1;
      user.failed_attempts = attempts;
      if (attempts >= 5) user.locked_until = literal("CURRENT_TIMESTAMP + INTERVAL '15 minutes'");
      await user.save({ transaction });
      return { attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null };
    });
  }

  async clearLoginFailures(user) {
    user.failed_attempts = 0;
    user.locked_until = null;
    user.last_login = literal('CURRENT_TIMESTAMP');
    await user.save();
  }

  list(role) {
    return this.User.findAll({
      where: role ? { role } : {},
      attributes: publicAttributes(),
      order: [['id', 'DESC']],
    });
  }

  listStaff() {
    return this.User.findAll({
      where: { role: { [Op.notIn]: ['super_admin', 'admin'] } },
      attributes: publicAttributes(),
      order: [['name', 'ASC']],
    });
  }

  async forceLogout(id) {
    const [updated] = await this.User.update(
      { locked_until: literal("CURRENT_TIMESTAMP + INTERVAL '1 minute'") },
      { where: { id } },
    );
    return updated;
  }

  async unlock(id) {
    const [updated] = await this.User.update(
      { locked_until: null, failed_attempts: 0 },
      { where: { id } },
    );
    return updated;
  }

  create(values, options = {}) {
    return this.User.create(values, options);
  }

  async update(instance, values, options = {}) {
    Object.assign(instance, values);
    await instance.save(options);
    return instance;
  }

  delete(instance, options = {}) {
    return instance.destroy(options);
  }
}

module.exports = { UserRepository, publicAttributes };
