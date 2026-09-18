const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const OtcItem = sequelize.define('OtcItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  otcSaleId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'OTC_SALE_ID',
    references: { model: 'HMS_OTC_SALES', key: 'ID' },
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
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'QUANTITY',
  },
  rate: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'RATE',
  },
  gstAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: 'GST_AMOUNT',
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'AMOUNT',
  },
}, {
  tableName: 'HMS_OTC_ITEMS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = OtcItem;
