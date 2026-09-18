const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const StockLedger = sequelize.define('StockLedger', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  medicineId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'MEDICINE_ID',
    references: { model: 'HMS_MEDICINES', key: 'ID' },
  },
  batchId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'BATCH_ID',
    references: { model: 'HMS_MEDICINE_BATCHES', key: 'ID' },
  },
  transactionType: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'TRANSACTION_TYPE',
    validate: {
      isIn: [['IN', 'OUT', 'RETURN', 'DISCARD', 'ADJUSTMENT']],
    },
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'QUANTITY',
  },
  referenceType: {
    type: DataTypes.STRING(30),
    field: 'REFERENCE_TYPE',
  },
  referenceId: {
    type: DataTypes.INTEGER,
    field: 'REFERENCE_ID',
  },
  transactionDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'TRANSACTION_DATE',
  },
  performedBy: {
    type: DataTypes.INTEGER,
    field: 'PERFORMED_BY',
    references: { model: 'HMS_USERS', key: 'ID' },
  },
}, {
  tableName: 'HMS_STOCK_LEDGER',
  freezeTableName: true,
  timestamps: false,
});

module.exports = StockLedger;
