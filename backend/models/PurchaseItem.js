const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PurchaseItem = sequelize.define('PurchaseItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  purchaseOrderId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PURCHASE_ORDER_ID',
    references: { model: 'HMS_PURCHASE_ORDERS', key: 'ID' },
  },
  medicineId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'MEDICINE_ID',
    references: { model: 'HMS_MEDICINES', key: 'ID' },
  },
  batchNumber: {
    type: DataTypes.STRING(100),
    field: 'BATCH_NUMBER',
  },
  expiryDate: {
    type: DataTypes.DATE,
    field: 'EXPIRY_DATE',
  },
  quantity: {
    type: DataTypes.INTEGER,
    field: 'QUANTITY',
  },
  purchaseRate: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'PURCHASE_RATE',
  },
  mrp: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'MRP',
  },
  gstRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    field: 'GST_RATE',
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
  tableName: 'HMS_PURCHASE_ITEMS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = PurchaseItem;
