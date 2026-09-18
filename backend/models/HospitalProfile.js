const { DataTypes, Model } = require('sequelize');
const { sequelize } = require('./db');

class HospitalProfile extends Model {}

HospitalProfile.init({
  id: {
    type: DataTypes.NUMBER,
    primaryKey: true,
        field: 'ID'
  },
  name: {
    type: DataTypes.STRING(200),
    allowNull: false,
    field: 'NAME',
  },
  tagline: {
    type: DataTypes.STRING(300),
    field: 'TAGLINE',
  },
  logoUrl: {
    type: DataTypes.STRING(500),
    field: 'LOGO_URL',
  },
  address: {
    type: DataTypes.STRING(500),
    field: 'ADDRESS',
  },
  city: {
    type: DataTypes.STRING(100),
    field: 'CITY',
  },
  state: {
    type: DataTypes.STRING(100),
    field: 'STATE',
  },
  pin: {
    type: DataTypes.STRING(10),
    field: 'PIN',
  },
  phone: {
    type: DataTypes.STRING(20),
    field: 'PHONE',
  },
  email: {
    type: DataTypes.STRING(100),
    field: 'EMAIL',
  },
  website: {
    type: DataTypes.STRING(200),
    field: 'WEBSITE',
  },
  gstin: {
    type: DataTypes.STRING(20),
    field: 'GSTIN',
  },
  regNumber: {
    type: DataTypes.STRING(100),
    field: 'REG_NUMBER',
  },
  nabhStatus: {
    type: DataTypes.NUMBER(1),
    defaultValue: 0,
    field: 'NABH_STATUS',
  },
  cghsEmpanelled: {
    type: DataTypes.NUMBER(1),
    defaultValue: 0,
    field: 'CGHS_EMPANELLED',
  },
  letterheadConfig: {
    type: DataTypes.TEXT,
    field: 'LETTERHEAD_CONFIG',
  },
  updatedBy: {
    type: DataTypes.NUMBER,
    field: 'UPDATED_BY',
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'UPDATED_AT',
  },
}, {
  sequelize,
  modelName: 'HospitalProfile',
  tableName: 'HMS_HOSPITAL_PROFILE',
  timestamps: false,
});

module.exports = HospitalProfile;
