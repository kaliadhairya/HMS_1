const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class IpdVitals extends Model {}

IpdVitals.init({
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
  recordedBy: {
    type: DataTypes.INTEGER,
    field: 'RECORDED_BY',
  },
  recordedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'RECORDED_AT',
  },
  bpSystolic: {
    type: DataTypes.INTEGER,
    field: 'BP_SYSTOLIC',
  },
  bpDiastolic: {
    type: DataTypes.INTEGER,
    field: 'BP_DIASTOLIC',
  },
  temperature: {
    type: DataTypes.FLOAT,
    field: 'TEMPERATURE',
  },
  spo2: {
    type: DataTypes.FLOAT,
    field: 'SPO2',
  },
  pulse: {
    type: DataTypes.INTEGER,
    field: 'PULSE',
  },
  respiratoryRate: {
    type: DataTypes.INTEGER,
    field: 'RESPIRATORY_RATE',
  },
  painScore: {
    type: DataTypes.INTEGER,
    field: 'PAIN_SCORE',
  },
  intakeOralMl: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'INTAKE_ORAL_ML',
  },
  intakeIvMl: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'INTAKE_IV_ML',
  },
  outputUrineMl: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'OUTPUT_URINE_ML',
  },
  outputDrainMl: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    field: 'OUTPUT_DRAIN_ML',
  },
  shift: {
    type: DataTypes.STRING(20),
    field: 'SHIFT',
  },
}, {
  sequelize,
  modelName: 'IpdVitals',
  tableName: 'HMS_IPD_VITALS',
  timestamps: false,
});

module.exports = IpdVitals;
