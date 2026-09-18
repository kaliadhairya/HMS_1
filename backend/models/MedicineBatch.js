const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const MedicineBatch = sequelize.define('MedicineBatch', {
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
  supplierId: {
    type: DataTypes.INTEGER,
    field: 'SUPPLIER_ID',
    references: { model: 'HMS_SUPPLIERS', key: 'ID' },
  },
  batchNumber: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'BATCH_NUMBER',
  },
  expiryDate: {
    type: DataTypes.DATE,
    allowNull: false,
    field: 'EXPIRY_DATE',
  },
  quantity: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
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
  gstAmount: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: 'GST_AMOUNT',
  },
}, {
  tableName: 'HMS_MEDICINE_BATCHES',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: false,
});

module.exports = MedicineBatch;
