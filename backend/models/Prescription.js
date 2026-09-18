const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Prescription = sequelize.define('Prescription', {
  id: { type: DataTypes.INTEGER, primaryKey: true,  field: 'ID' },
  encounter_id: { type: DataTypes.INTEGER, allowNull: false, field: 'ENCOUNTER_ID' },
  patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' },
  doctor_id: { type: DataTypes.INTEGER, allowNull: false, field: 'DOCTOR_ID' },
  type: { type: DataTypes.STRING(50), defaultValue: 'OPD', field: 'TYPE' },
  status: { type: DataTypes.STRING(50), defaultValue: 'Draft', field: 'STATUS' },
  qr_data: { type: DataTypes.TEXT, field: 'QR_DATA' }
}, {
  tableName: 'HMS_PRESCRIPTIONS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT'
});

module.exports = Prescription;
