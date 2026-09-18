const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const AuditLog = sequelize.define('AuditLog', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'ID',
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'USER_ID',
    references: { model: 'HMS_USERS', key: 'id' },
  },
  action: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'ACTION',
  },
  module: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'MODULE',
  },
  record_id: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'RECORD_ID',
  },
  old_value: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'OLD_VALUE',
  },
  new_value: {
    type: DataTypes.TEXT,
    allowNull: true,
    field: 'NEW_VALUE',
  },
  ip_address: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'IP_ADDRESS',
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
}, {
  tableName: 'HMS_AUDIT_LOGS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = AuditLog;
