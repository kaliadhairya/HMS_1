const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const DispensingRecord = sequelize.define('DispensingRecord', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  prescriptionId: {
    type: DataTypes.INTEGER,
    field: 'PRESCRIPTION_ID',
    references: { model: 'HMS_PRESCRIPTIONS', key: 'ID' },
  },
  patientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID',
    references: { model: 'HMS_PATIENTS', key: 'ID' },
  },
  dispensedBy: {
    type: DataTypes.INTEGER,
    field: 'DISPENSED_BY',
    references: { model: 'HMS_USERS', key: 'ID' },
  },
  dispensedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'DISPENSED_AT',
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    field: 'TOTAL_AMOUNT',
  },
  billId: {
    type: DataTypes.INTEGER,
    field: 'BILL_ID',
  },
}, {
  tableName: 'HMS_DISPENSING_RECORDS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = DispensingRecord;
