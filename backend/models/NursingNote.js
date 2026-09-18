const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class NursingNote extends Model {}

NursingNote.init({
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'ID'
  },
  admissionId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'ADMISSION_ID',
  },
  nurseId: {
    type: DataTypes.INTEGER,
    field: 'NURSE_ID',
  },
  noteDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'NOTE_DATE',
  },
  conditionNotes: {
    type: DataTypes.TEXT,
    field: 'CONDITION_NOTES',
  },
  complaints: {
    type: DataTypes.TEXT,
    field: 'COMPLAINTS',
  },
  actionsTaken: {
    type: DataTypes.TEXT,
    field: 'ACTIONS_TAKEN',
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
}, {
  sequelize,
  modelName: 'NursingNote',
  tableName: 'HMS_NURSING_NOTES',
  timestamps: false,
});

module.exports = NursingNote;
