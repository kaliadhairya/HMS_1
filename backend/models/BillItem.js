const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class BillItem extends Model {}

BillItem.init({
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
  itemType: {
    type: DataTypes.STRING(30),
    field: 'ITEM_TYPE',
  },
  itemName: {
    type: DataTypes.STRING(200),
    field: 'ITEM_NAME',
  },
  quantity: {
    type: DataTypes.NUMBER,
    defaultValue: 1,
    field: 'QUANTITY',
  },
  rate: {
    type: DataTypes.NUMBER,
    field: 'RATE',
  },
  gstRate: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'GST_RATE',
  },
  gstAmount: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'GST_AMOUNT',
  },
  amount: {
    type: DataTypes.NUMBER,
    field: 'AMOUNT',
  },
  serviceDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'SERVICE_DATE',
  },
}, {
  sequelize,
  modelName: 'BillItem',
  tableName: 'HMS_BILL_ITEMS',
  timestamps: false,
});

module.exports = BillItem;
