const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Permission = sequelize.define('Permission', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  role: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'ROLE',
    validate: {
      isIn: [['super_admin', 'admin', 'doctor', 'lab_technician', 'receptionist', 'pharmacist', 'nurse']],
    },
  },
  module: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'MODULE',
    validate: {
      isIn: [['auth', 'dashboard', 'patient', 'consultation', 'lab', 'radiology', 'pharmacy', 'ipd', 'billing', 'reports', 'admin']],
    },
  },
  can_read: {
    type: DataTypes.CHAR(1),
    defaultValue: 'N',
    field: 'CAN_READ',
  },
  can_write: {
    type: DataTypes.CHAR(1),
    defaultValue: 'N',
    field: 'CAN_WRITE',
  },
  can_edit: {
    type: DataTypes.CHAR(1),
    defaultValue: 'N',
    field: 'CAN_EDIT',
  },
  can_delete: {
    type: DataTypes.CHAR(1),
    defaultValue: 'N',
    field: 'CAN_DELETE',
  },
}, {
  tableName: 'HMS_PERMISSIONS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = Permission;
