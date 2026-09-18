const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Token = sequelize.define('Token', {
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
  doctor_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DOCTOR_ID'
  },
  department_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DEPARTMENT_ID'
  },
  token_number: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'TOKEN_NUMBER'
  },
  token_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'TOKEN_DATE'
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Waiting',
    field: 'STATUS'
  },
  generated_by: {
    type: DataTypes.INTEGER,
    field: 'GENERATED_BY'
  },
}, {
  tableName: 'HMS_TOKENS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Token;
