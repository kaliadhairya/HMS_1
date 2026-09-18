const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');
const Vital = sequelize.define('Vital', {
  id: { type: DataTypes.INTEGER, primaryKey: true,  field: 'ID' },
  patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' },
  encounter_type: { type: DataTypes.STRING(10), defaultValue: 'OPD', field: 'ENCOUNTER_TYPE' },
  reference_id: { type: DataTypes.INTEGER, field: 'REFERENCE_ID' },
  bp_systolic: { type: DataTypes.INTEGER, field: 'BP_SYSTOLIC' },
  bp_diastolic: { type: DataTypes.INTEGER, field: 'BP_DIASTOLIC' },
  temperature: { type: DataTypes.FLOAT, field: 'TEMPERATURE' },
  temp_unit: { type: DataTypes.STRING(1), defaultValue: 'F', field: 'TEMP_UNIT' },
  weight_kg: { type: DataTypes.FLOAT, field: 'WEIGHT_KG' },
  height_cm: { type: DataTypes.FLOAT, field: 'HEIGHT_CM' },
  bmi: { type: DataTypes.FLOAT, field: 'BMI' },
  spo2: { type: DataTypes.INTEGER, field: 'SPO2' },
  pulse: { type: DataTypes.INTEGER, field: 'PULSE' },
  respiratory_rate: { type: DataTypes.INTEGER, field: 'RESPIRATORY_RATE' },
  alerts: { type: DataTypes.TEXT, field: 'ALERTS' },
  recorded_by: { type: DataTypes.INTEGER, field: 'RECORDED_BY' },
  recorded_at: { type: DataTypes.DATE, field: 'RECORDED_AT' }
}, { tableName: 'HMS_VITALS', timestamps: false });
module.exports = Vital;
