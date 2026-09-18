const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Medicine = sequelize.define('Medicine', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  genericName: {
    type: DataTypes.STRING(200),
    allowNull: false,
    field: 'GENERIC_NAME',
  },
  brandNames: {
    type: DataTypes.TEXT,
    field: 'BRAND_NAMES',
  },
  category: {
    type: DataTypes.STRING(100),
    field: 'CATEGORY',
  },
  formulation: {
    type: DataTypes.STRING(50),
    field: 'FORMULATION',
  },
  strength: {
    type: DataTypes.STRING(50),
    field: 'STRENGTH',
  },
  strengthUnit: {
    type: DataTypes.STRING(20),
    field: 'STRENGTH_UNIT',
  },
  unitOfSale: {
    type: DataTypes.STRING(30),
    field: 'UNIT_OF_SALE',
  },
  hsnCode: {
    type: DataTypes.STRING(20),
    field: 'HSN_CODE',
  },
  gstRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    field: 'GST_RATE',
  },
  isControlled: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    field: 'IS_CONTROLLED',
  },
  isActive: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
}, {
  tableName: 'HMS_MEDICINES',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = Medicine;
