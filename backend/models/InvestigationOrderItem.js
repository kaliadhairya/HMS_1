const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const InvestigationOrderItem = sequelize.define('InvestigationOrderItem', {
  id: { type: DataTypes.INTEGER, primaryKey: true,  field: 'ID' },
  order_id: { type: DataTypes.INTEGER, allowNull: false, field: 'ORDER_ID' },
  test_name: { type: DataTypes.STRING(255), allowNull: false, field: 'ITEM_NAME' },
  department: { type: DataTypes.STRING(100), field: 'TEST_CATEGORY' },
  status: { type: DataTypes.STRING(50), defaultValue: 'Pending', field: 'STATUS' },
  item_type: { type: DataTypes.STRING(50), field: 'ITEM_TYPE' },
  result_value: { type: DataTypes.STRING(500), field: 'RESULT_VALUE' },
  reference_range: { type: DataTypes.STRING(500), field: 'REFERENCE_RANGE' },
  remarks: { type: DataTypes.TEXT, field: 'REMARKS' }
}, {
  tableName: 'HMS_INVESTIGATION_ORDER_ITEMS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = InvestigationOrderItem;
