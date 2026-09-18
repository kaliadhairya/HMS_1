const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const RestForm = sequelize.define('RestForm', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
    field: 'ID'
  },
  patient_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'PATIENT_ID'
  },
  doctor_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DOCTOR_ID'
  },
  encounter_id: {
    type: DataTypes.INTEGER, // optional
    field: 'ENCOUNTER_ID'
  },
  book_no: {
    type: DataTypes.STRING(20),
    field: 'BOOK_NO'
  },
  sr_no: {
    type: DataTypes.STRING(20),
    field: 'SR_NO'
  },
  attended_date: {
    type: DataTypes.DATE,
    field: 'ATTENDED_DATE'
  },
  advised_days: {
    type: DataTypes.STRING(50),
    field: 'ADVISED_DAYS'
  },
  from_date: {
    type: DataTypes.DATE,
    field: 'FROM_DATE'
  },
  to_date: {
    type: DataTypes.DATE,
    field: 'TO_DATE'
  },
  disease: {
    type: DataTypes.STRING(255),
    field: 'DISEASE'
  },
  fit_date: {
    type: DataTypes.DATE,
    field: 'FIT_DATE'
  },
  working_as: {
    type: DataTypes.STRING(100),
    field: 'WORKING_AS'
  },
  department: {
    type: DataTypes.STRING(100),
    field: 'DEPARTMENT'
  },
  extended_date: {
    type: DataTypes.DATE,
    field: 'EXTENDED_DATE'
  }
}, {
  tableName: 'HMS_REST_FORMS',
  timestamps: true,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
});

module.exports = RestForm;
