const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class MarRecord extends Model {}

MarRecord.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  admissionId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'ADMISSION_ID',
  },
  prescriptionItemId: {
    type: DataTypes.NUMBER,
    field: 'PRESCRIPTION_ITEM_ID',
  },
  medicineName: {
    type: DataTypes.STRING(200),
    field: 'MEDICINE_NAME',
  },
  dose: {
    type: DataTypes.STRING(50),
    field: 'DOSE',
  },
  route: {
    type: DataTypes.STRING(30),
    field: 'ROUTE',
  },
  scheduledTime: {
    type: DataTypes.DATE,
    field: 'SCHEDULED_TIME',
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Pending',
    field: 'STATUS',
  },
  administeredBy: {
    type: DataTypes.NUMBER,
    field: 'ADMINISTERED_BY',
  },
  administeredAt: {
    type: DataTypes.DATE,
    field: 'ADMINISTERED_AT',
  },
  holdReason: {
    type: DataTypes.STRING(500),
    field: 'HOLD_REASON',
  },
  notes: {
    type: DataTypes.STRING(500),
    field: 'NOTES',
  },
}, {
  sequelize,
  modelName: 'MarRecord',
  tableName: 'HMS_MAR_RECORDS',
  timestamps: false,
});

module.exports = MarRecord;
