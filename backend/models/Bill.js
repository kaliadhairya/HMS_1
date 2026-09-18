const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Bill extends Model {}

Bill.init({
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
  encounterId: {
    type: DataTypes.NUMBER,
    field: 'ENCOUNTER_ID',
  },
  billType: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'BILL_TYPE',
  },
  billNumber: {
    type: DataTypes.STRING(30),
    unique: true,
    field: 'BILL_NUMBER',
  },
  status: {
    type: DataTypes.STRING(30),
    defaultValue: 'Pending',
    field: 'STATUS',
  },
  totalAmount: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'TOTAL_AMOUNT',
  },
  discountAmount: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'DISCOUNT_AMOUNT',
  },
  discountApprovedBy: {
    type: DataTypes.NUMBER,
    field: 'DISCOUNT_APPROVED_BY',
  },
  gstAmount: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'GST_AMOUNT',
  },
  netPayable: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'NET_PAYABLE',
  },
  advanceAdjusted: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'ADVANCE_ADJUSTED',
  },
  createdBy: {
    type: DataTypes.NUMBER,
    field: 'CREATED_BY',
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'UPDATED_AT',
  },
}, {
  sequelize,
  modelName: 'Bill',
  tableName: 'HMS_BILLS',
  timestamps: false,
});

module.exports = Bill;
