const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Bed extends Model {}

Bed.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  wardId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'WARD_ID',
  },
  roomNumber: {
    type: DataTypes.STRING(20),
    field: 'ROOM_NUMBER',
  },
  bedNumber: {
    type: DataTypes.STRING(20),
    allowNull: false,
    field: 'BED_NUMBER',
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Available',
    field: 'STATUS',
  },
  isActive: {
    type: DataTypes.NUMBER(1),
    defaultValue: 1,
    field: 'IS_ACTIVE',
  },
}, {
  sequelize,
  modelName: 'Bed',
  tableName: 'HMS_BEDS',
  timestamps: false,
});

module.exports = Bed;
