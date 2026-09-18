const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PatientDocument = sequelize.define('PatientDocument', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  patient_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID'
  },
  file_name: {
    type: DataTypes.STRING(255),
    field: 'FILE_NAME'
  },
  file_url: {
    type: DataTypes.STRING(500),
    field: 'FILE_URL'
  },
  doc_type: {
    type: DataTypes.STRING(50),
    field: 'DOC_TYPE'
  },
  uploaded_by: {
    type: DataTypes.INTEGER,
    field: 'UPLOADED_BY'
  },
}, {
  tableName: 'HMS_PATIENT_DOCUMENTS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'uploaded_at',
  updatedAt: false,
});

module.exports = PatientDocument;
