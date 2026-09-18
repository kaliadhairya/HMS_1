const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Ward extends Model {}

Ward.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
     // Uses sequence + trigger,
    field: 'ID'
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'NAME',
  },
  type: {
    type: DataTypes.STRING(30),
    field: 'TYPE',
  },
  floor: {
    type: DataTypes.STRING(20),
    field: 'FLOOR',
  },
  totalBeds: {
    type: DataTypes.NUMBER,
    defaultValue: 0,
    field: 'TOTAL_BEDS',
  },
  isActive: {
    type: DataTypes.NUMBER(1),
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
}, {
  sequelize,
  modelName: 'Ward',
  tableName: 'HMS_WARDS',
  timestamps: false,
});

module.exports = Ward;
