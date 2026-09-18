const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Department = sequelize.define('Department', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'NAME'
  },
  short_code: {
    type: DataTypes.STRING(10),
    field: 'SHORT_CODE'
  },
  head_doctor_id: {
    type: DataTypes.INTEGER,
    field: 'HEAD_DOCTOR_ID'
  },
  floor_location: {
    type: DataTypes.STRING(50),
    field: 'FLOOR_LOCATION'
  },
  is_active: {
    type: DataTypes.CHAR(1),
    defaultValue: 'Y',
    field: 'IS_ACTIVE'
  },
}, {
  tableName: 'HMS_DEPARTMENTS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Department;
