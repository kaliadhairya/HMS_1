const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const InvestigationOrder = sequelize.define('InvestigationOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true,  field: 'ID' },
  encounter_id: { type: DataTypes.INTEGER, allowNull: false, field: 'ENCOUNTER_ID' },
  patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' },
  doctor_id: { type: DataTypes.INTEGER, allowNull: false, field: 'DOCTOR_ID' },
  investigation_type: { type: DataTypes.STRING(100), defaultValue: 'Lab', field: 'ORDER_TYPE' },
  priority: { type: DataTypes.STRING(50), defaultValue: 'Routine', field: 'URGENCY' },
  clinical_notes: { type: DataTypes.STRING(1000), field: 'CLINICAL_NOTES' },
  status: { type: DataTypes.STRING(50), defaultValue: 'Ordered', field: 'STATUS' },
  order_date: { type: DataTypes.DATE, defaultValue: DataTypes.NOW, field: 'CREATED_AT' }
}, {
  tableName: 'HMS_INVESTIGATION_ORDERS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = InvestigationOrder;
