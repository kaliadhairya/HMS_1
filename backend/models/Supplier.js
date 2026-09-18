const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Supplier = sequelize.define('Supplier', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    field: 'NAME',
  },
  supplierNumber: {
    type: DataTypes.STRING(20),
    unique: true,
    field: 'SUPPLIER_NUMBER',
  },
  contactPerson: {
    type: DataTypes.STRING(100),
    field: 'CONTACT_PERSON',
  },
  phone: {
    type: DataTypes.STRING(15),
    field: 'PHONE',
  },
  email: {
    type: DataTypes.STRING(100),
    field: 'EMAIL',
  },
  address: {
    type: DataTypes.TEXT,
    field: 'ADDRESS',
  },
  gstin: {
    type: DataTypes.STRING(20),
    field: 'GSTIN',
  },
  isActive: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
}, {
  tableName: 'HMS_SUPPLIERS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = Supplier;
