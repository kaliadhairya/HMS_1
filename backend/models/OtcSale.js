const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const OtcSale = sequelize.define('OtcSale', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  patientId: {
    type: DataTypes.INTEGER,
    field: 'PATIENT_ID',
    references: { model: 'HMS_PATIENTS', key: 'ID' },
  },
  soldBy: {
    type: DataTypes.INTEGER,
    field: 'SOLD_BY',
    references: { model: 'HMS_USERS', key: 'ID' },
  },
  soldAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'SOLD_AT',
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    field: 'TOTAL_AMOUNT',
  },
  paymentMode: {
    type: DataTypes.STRING(20),
    field: 'PAYMENT_MODE',
  },
  billNumber: {
    type: DataTypes.STRING(30),
    field: 'BILL_NUMBER',
  },
}, {
  tableName: 'HMS_OTC_SALES',
  freezeTableName: true,
  timestamps: false,
});

module.exports = OtcSale;
