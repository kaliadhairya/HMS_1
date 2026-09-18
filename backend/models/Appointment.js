const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Appointment = sequelize.define('Appointment', {
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
  doctor_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DOCTOR_ID'
  },
  department_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'DEPARTMENT_ID'
  },
  appointment_date: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'APPOINTMENT_DATE'
  },
  slot_start: {
    type: DataTypes.STRING(10),
    field: 'SLOT_START'
  },
  slot_end: {
    type: DataTypes.STRING(10),
    field: 'SLOT_END'
  },
  appt_type: {
    type: DataTypes.STRING(20),
    defaultValue: 'walk-in',
    field: 'APPT_TYPE'
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'Scheduled',
    field: 'STATUS'
  },
  cancellation_reason: {
    type: DataTypes.STRING(500),
    field: 'CANCELLATION_REASON'
  },
  booked_by: {
    type: DataTypes.INTEGER,
    field: 'BOOKED_BY'
  },
}, {
  tableName: 'HMS_APPOINTMENTS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'created_at',
  updatedAt: false,
});

module.exports = Appointment;
