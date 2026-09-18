const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const IpdRequest = sequelize.define('IpdRequest', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'ID'
  },
  patientId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID'
  },
  doctorId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DOCTOR_ID'
  },
  reasonForAdmission: {
    type: DataTypes.STRING(1000),
    field: 'REASON_FOR_ADMISSION'
  },
  primaryDiagnosis: {
    type: DataTypes.STRING(500),
    field: 'PRIMARY_DIAGNOSIS'
  },
  icd10Code: {
    type: DataTypes.STRING(50),
    field: 'ICD10_CODE'
  },
  wardPreference: {
    type: DataTypes.STRING(100),
    field: 'WARD_PREFERENCE'
  },
  urgencyLevel: {
    type: DataTypes.STRING(50),
    field: 'URGENCY_LEVEL'
  },
  estimatedDuration: {
    type: DataTypes.INTEGER,
    field: 'ESTIMATED_DURATION'
  },
  durationUnit: {
    type: DataTypes.STRING(20),
    field: 'DURATION_UNIT'
  },
  specialRequirements: {
    type: DataTypes.STRING(1000),
    field: 'SPECIAL_REQUIREMENTS'
  },
  initialOrders: {
    type: DataTypes.TEXT, // CLOB
    field: 'INITIAL_ORDERS'
  },
  status: {
    type: DataTypes.STRING(50),
    defaultValue: 'Pending',
    field: 'STATUS'
  },
  requestDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'REQUEST_DATE'
  },
  admissionId: {
    type: DataTypes.INTEGER,
    field: 'ADMISSION_ID'
  }
}, {
  tableName: 'HMS_IPD_REQUESTS',
  timestamps: true,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = IpdRequest;
