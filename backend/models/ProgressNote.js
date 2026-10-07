const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class ProgressNote extends Model {}

ProgressNote.init({
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
  patientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID',
  },
  doctorId: {
    type: DataTypes.INTEGER,
    field: 'DOCTOR_ID',
  },
  noteDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'NOTE_DATE',
  },
  subjective: {
    type: DataTypes.TEXT,
    field: 'SUBJECTIVE',
  },
  objective: {
    type: DataTypes.TEXT,
    field: 'OBJECTIVE',
  },
  assessment: {
    type: DataTypes.TEXT,
    field: 'ASSESSMENT',
  },
  plan: {
    type: DataTypes.TEXT,
    field: 'PLAN',
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
}, {
  sequelize,
  modelName: 'ProgressNote',
  tableName: 'HMS_PROGRESS_NOTES',
  timestamps: false,
});

module.exports = ProgressNote;
