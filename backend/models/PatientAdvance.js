const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class PatientAdvance extends Model {}

PatientAdvance.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  patientId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'PATIENT_ID',
  },
  admissionId: {
    type: DataTypes.NUMBER,
    field: 'ADMISSION_ID',
  },
  amount: {
    type: DataTypes.NUMBER,
    field: 'AMOUNT',
  },
  paymentMode: {
    type: DataTypes.STRING(20),
    field: 'PAYMENT_MODE',
  },
  receivedBy: {
    type: DataTypes.NUMBER,
    field: 'RECEIVED_BY',
  },
  receivedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'RECEIVED_AT',
  },
  adjustedBillId: {
    type: DataTypes.NUMBER,
    field: 'ADJUSTED_BILL_ID',
  },
  isRefunded: {
    type: DataTypes.NUMBER(1),
    defaultValue: 0,
    field: 'IS_REFUNDED',
  },
  notes: {
    type: DataTypes.STRING(500),
    field: 'NOTES',
  },
}, {
  sequelize,
  modelName: 'PatientAdvance',
  tableName: 'HMS_PATIENT_ADVANCES',
  timestamps: false,
});

module.exports = PatientAdvance;
