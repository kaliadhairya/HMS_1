class PermissionRepository {
  constructor(Permission) {
    this.Permission = Permission;
  }

  list() {
    return this.Permission.findAll({ order: [['role', 'ASC'], ['module', 'ASC']] });
  }

  listForRole(role) {
    return this.Permission.findAll({ where: { role }, order: [['module', 'ASC']] });
  }

  async replaceMany(permissions, transaction) {
    for (const permission of permissions) {
      const values = {
        can_read: permission.can_read,
        can_write: permission.can_write,
        can_edit: permission.can_edit,
        can_delete: permission.can_delete,
      };
      const [record, created] = await this.Permission.findOrCreate({
        where: { role: permission.role, module: permission.module },
        defaults: { ...permission, ...values },
        transaction,
      });
      if (!created) await record.update(values, { transaction });
    }
  }
}

module.exports = { PermissionRepository };
