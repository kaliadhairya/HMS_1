const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class Admission extends Model {}

Admission.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  patientId: {
    type: DataTypes.NUMBER,
    allowNull: false,
    field: 'PATIENT_ID',
  },
  admittingDoctorId: {
    type: DataTypes.NUMBER,
    field: 'ADMITTING_DOCTOR_ID',
  },
  department: {
    type: DataTypes.STRING(100),
    field: 'DEPARTMENT',
  },
  bedId: {
    type: DataTypes.NUMBER,
    field: 'BED_ID',
  },
  admissionType: {
    type: DataTypes.STRING(20),
    field: 'ADMISSION_TYPE',
  },
  admissionDate: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'ADMISSION_DATE',
  },
  expectedDischargeDate: {
    type: DataTypes.DATE,
    field: 'EXPECTED_DISCHARGE_DATE',
  },
  dischargeDate: {
    type: DataTypes.DATE,
    field: 'DISCHARGE_DATE',
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Active',
    field: 'STATUS',
  },
  admissionIdFormatted: {
    type: DataTypes.STRING(20),
    unique: true,
    field: 'ADMISSION_ID_FORMATTED',
  },
  createdBy: {
    type: DataTypes.NUMBER,
    field: 'CREATED_BY',
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'CREATED_AT',
  },
}, {
  sequelize,
  modelName: 'Admission',
  tableName: 'HMS_ADMISSIONS',
  timestamps: false,
});

module.exports = Admission;
