const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const DispensingItem = sequelize.define('DispensingItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID',
  },
  dispensingRecordId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DISPENSING_RECORD_ID',
    references: { model: 'HMS_DISPENSING_RECORDS', key: 'ID' },
  },
  medicineId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'MEDICINE_ID',
    references: { model: 'HMS_MEDICINES', key: 'ID' },
  },
  batchId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'BATCH_ID',
    references: { model: 'HMS_MEDICINE_BATCHES', key: 'ID' },
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'QUANTITY',
  },
  rate: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'RATE',
  },
  amount: {
    type: DataTypes.DECIMAL(10, 2),
    field: 'AMOUNT',
  },
}, {
  tableName: 'HMS_DISPENSING_ITEMS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = DispensingItem;
