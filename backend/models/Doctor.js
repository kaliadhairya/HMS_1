const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Doctor = sequelize.define('Doctor', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true,
        field: 'ID'
  },
  user_id: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'USER_ID'
  },
  department_id: {
    type: DataTypes.INTEGER,
    field: 'DEPARTMENT_ID'
  },
  speciality: {
    type: DataTypes.STRING(100),
    field: 'SPECIALITY'
  },
  registration_number: {
    type: DataTypes.STRING(50),
    field: 'REGISTRATION_NUMBER'
  },
  qualifications: {
    type: DataTypes.STRING(500),
    field: 'QUALIFICATIONS'
  },
  consulting_days: {
    type: DataTypes.STRING(200), // Stored as JSON string,
    field: 'CONSULTING_DAYS'
  },
  slot_start_time: {
    type: DataTypes.STRING(10),
    field: 'SLOT_START_TIME'
  },
  slot_end_time: {
    type: DataTypes.STRING(10),
    field: 'SLOT_END_TIME'
  },
  slot_duration_mins: {
    type: DataTypes.INTEGER,
    defaultValue: 15,
    field: 'SLOT_DURATION_MINS'
  },
  fee: {
    type: DataTypes.DECIMAL(10, 2),
    defaultValue: 0,
    field: 'FEE'
  },
  photo_url: {
    type: DataTypes.STRING(500),
    field: 'PHOTO_URL'
  },
  signature_url: {
    type: DataTypes.STRING(500),
    field: 'SIGNATURE_URL'
  },
  is_active: {
    type: DataTypes.CHAR(1),
    defaultValue: 'Y',
    field: 'IS_ACTIVE'
  },
}, {
  tableName: 'HMS_DOCTORS',
  freezeTableName: true,
  timestamps: false,
});

module.exports = Doctor;
