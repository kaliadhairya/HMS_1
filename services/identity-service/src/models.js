const bcrypt = require('bcryptjs');
const { DataTypes } = require('sequelize');

const ROLES = ['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse'];
const MODULES = ['auth', 'dashboard', 'patient', 'consultation', 'lab', 'radiology', 'pharmacy', 'ipd', 'billing', 'reports', 'admin'];

function defineModels(sequelize) {
  const User = sequelize.define('IdentityUser', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'ID' },
    username: { type: DataTypes.STRING(50), allowNull: false, unique: true, field: 'USERNAME' },
    password: { type: DataTypes.STRING(255), allowNull: false, field: 'PASSWORD' },
    name: { type: DataTypes.STRING(100), allowNull: false, field: 'NAME' },
    first_name: { type: DataTypes.STRING(100), allowNull: true, field: 'FIRST_NAME' },
    last_name: { type: DataTypes.STRING(100), allowNull: true, field: 'LAST_NAME' },
    phone: { type: DataTypes.STRING(20), allowNull: true, field: 'PHONE' },
    role: { type: DataTypes.STRING(20), allowNull: false, defaultValue: 'lab_technician', validate: { isIn: [ROLES] }, field: 'ROLE' },
    department_id: { type: DataTypes.INTEGER, allowNull: true, field: 'DEPARTMENT_ID' },
    isActive: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1, field: 'IS_ACTIVE' },
    first_login: { type: DataTypes.CHAR(1), defaultValue: 'Y', field: 'FIRST_LOGIN' },
    failed_attempts: { type: DataTypes.INTEGER, defaultValue: 0, field: 'FAILED_ATTEMPTS' },
    locked_until: { type: DataTypes.DATE, allowNull: true, field: 'LOCKED_UNTIL' },
    last_login: { type: DataTypes.DATE, allowNull: true, field: 'LAST_LOGIN' },
    otp_code: { type: DataTypes.STRING(10), allowNull: true, field: 'OTP_CODE' },
    otp_expires: { type: DataTypes.DATE, allowNull: true, field: 'OTP_EXPIRES' },
  }, {
    tableName: 'HMS_USERS',
    freezeTableName: true,
    timestamps: false,
    hooks: {
      beforeCreate: async (user) => { user.password = await bcrypt.hash(user.password, 12); },
      beforeUpdate: async (user) => {
        if (user.changed('password')) user.password = await bcrypt.hash(user.password, 12);
      },
    },
  });
  User.prototype.comparePassword = function comparePassword(candidate) {
    return bcrypt.compare(candidate, this.password);
  };

  const Permission = sequelize.define('IdentityPermission', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'ID' },
    role: { type: DataTypes.STRING(50), allowNull: false, validate: { isIn: [ROLES] }, field: 'ROLE' },
    module: { type: DataTypes.STRING(50), allowNull: false, validate: { isIn: [MODULES] }, field: 'MODULE' },
    can_read: { type: DataTypes.CHAR(1), defaultValue: 'N', field: 'CAN_READ' },
    can_write: { type: DataTypes.CHAR(1), defaultValue: 'N', field: 'CAN_WRITE' },
    can_edit: { type: DataTypes.CHAR(1), defaultValue: 'N', field: 'CAN_EDIT' },
    can_delete: { type: DataTypes.CHAR(1), defaultValue: 'N', field: 'CAN_DELETE' },
  }, { tableName: 'HMS_PERMISSIONS', freezeTableName: true, timestamps: false });

  const AuditLog = sequelize.define('IdentityAuditLog', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, field: 'ID' },
    user_id: { type: DataTypes.INTEGER, allowNull: true, field: 'USER_ID' },
    action: { type: DataTypes.STRING(50), allowNull: false, field: 'ACTION' },
    module: { type: DataTypes.STRING(50), allowNull: true, field: 'MODULE' },
    record_id: { type: DataTypes.INTEGER, allowNull: true, field: 'RECORD_ID' },
    old_value: { type: DataTypes.TEXT, allowNull: true, field: 'OLD_VALUE' },
    new_value: { type: DataTypes.TEXT, allowNull: true, field: 'NEW_VALUE' },
    ip_address: { type: DataTypes.STRING(50), allowNull: true, field: 'IP_ADDRESS' },
    created_at: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'CREATED_AT' },
    idempotency_key: { type: DataTypes.STRING(128), allowNull: true, field: 'IDEMPOTENCY_KEY' },
  }, { tableName: 'HMS_AUDIT_LOGS', freezeTableName: true, timestamps: false });

  return { User, Permission, AuditLog, ROLES, MODULES };
}

module.exports = { defineModels, ROLES, MODULES };
