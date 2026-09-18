const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const ChronicCondition = sequelize.define('ChronicCondition', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  patient_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID'
  },
  condition_name: {
    type: DataTypes.STRING(200),
    field: 'CONDITION_NAME'
  },
  since_when: {
    type: DataTypes.STRING(100),
    field: 'SINCE_WHEN'
  },
  notes: {
    type: DataTypes.STRING(500),
    field: 'NOTES'
  },
}, {
  tableName: 'HMS_CHRONIC_CONDITIONS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = ChronicCondition;
