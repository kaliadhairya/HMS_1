const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Tariff extends Model {}

Tariff.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  category: {
    type: DataTypes.STRING(50),
    allowNull: false,
    field: 'CATEGORY',
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    field: 'NAME',
  },
  rate: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    field: 'RATE',
  },
  gstRate: {
    type: DataTypes.DECIMAL(5, 2),
    defaultValue: 0,
    field: 'GST_RATE',
  },
  perUnit: {
    type: DataTypes.STRING(30),
    field: 'PER_UNIT',
  },
  wardType: {
    type: DataTypes.STRING(30),
    field: 'WARD_TYPE',
  },
  doctorId: {
    type: DataTypes.NUMBER,
    field: 'DOCTOR_ID',
  },
  isActive: {
    type: DataTypes.NUMBER(1),
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
  createdAt: {
    type: DataTypes.DATE,
    field: 'CREATED_AT',
  },
}, {
  sequelize,
  modelName: 'Tariff',
  tableName: 'HMS_TARIFFS',
  timestamps: false,
});

module.exports = Tariff;
