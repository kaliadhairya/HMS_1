const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Diagnosis = sequelize.define('Diagnosis', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  encounter_id: { type: DataTypes.INTEGER, allowNull: false,
    field: 'ENCOUNTER_ID' },
  icd10_code: { type: DataTypes.STRING(50),
    field: 'ICD10_CODE' },
  icd10_description: { type: DataTypes.STRING(500),
    field: 'ICD10_DESCRIPTION' },
  diagnosis_type: { 
    type: DataTypes.STRING(50), 
    defaultValue: 'Primary', // Primary, Secondary, Comorbidity
    field: 'DIAGNOSIS_TYPE'
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'Provisional', // Provisional, Confirmed
    field: 'STATUS'
  },
  clinical_notes: { type: DataTypes.TEXT,
    field: 'CLINICAL_NOTES'}
}, {
  tableName: 'HMS_DIAGNOSES',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  });

module.exports = Diagnosis;
