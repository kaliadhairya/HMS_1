const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PurchaseOrder = sequelize.define('PurchaseOrder', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  supplierId: {
    type: DataTypes.INTEGER,
    field: 'SUPPLIER_ID',
    references: { model: 'HMS_SUPPLIERS', key: 'ID' },
  },
  invoiceNumber: {
    type: DataTypes.STRING(100),
    field: 'INVOICE_NUMBER',
  },
  invoiceDate: {
    type: DataTypes.DATE,
    field: 'INVOICE_DATE',
  },
  totalAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    field: 'TOTAL_AMOUNT',
  },
  gstAmount: {
    type: DataTypes.DECIMAL(12, 2),
    defaultValue: 0,
    field: 'GST_AMOUNT',
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Received',
    field: 'STATUS',
  },
  createdBy: {
    type: DataTypes.INTEGER,
    field: 'CREATED_BY',
    references: { model: 'HMS_USERS', key: 'ID' },
  },
  expectedDelivery: {
    type: DataTypes.DATE,
    field: 'EXPECTED_DELIVERY',
  },
  remarks: {
    type: DataTypes.STRING(1000),
    field: 'REMARKS',
  },
  orderDate: {
    type: DataTypes.DATE,
    field: 'ORDER_DATE',
  },
}, {
  tableName: 'HMS_PURCHASE_ORDERS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: false,
});

module.exports = PurchaseOrder;
