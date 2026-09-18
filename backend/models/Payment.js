const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Payment extends Model {}

Payment.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  billId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'BILL_ID',
  },
  patientId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'PATIENT_ID',
  },
  paymentMode: {
    type: DataTypes.STRING(20),
    field: 'PAYMENT_MODE',
  },
  amount: {
    type: DataTypes.NUMBER,
    field: 'AMOUNT',
  },
  referenceNumber: {
    type: DataTypes.STRING(100),
    field: 'REFERENCE_NUMBER',
  },
  receivedBy: {
    type: DataTypes.NUMBER,
    field: 'RECEIVED_BY',
  },
  receiptNumber: {
    type: DataTypes.STRING(30),
    unique: true,
    field: 'RECEIPT_NUMBER',
  },
  paymentDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'PAYMENT_DATE',
  },
  notes: {
    type: DataTypes.STRING(500),
    field: 'NOTES',
  },
}, {
  sequelize,
  modelName: 'Payment',
  tableName: 'HMS_PAYMENTS',
  timestamps: false,
});

module.exports = Payment;
