const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const PrescriptionItem = sequelize.define('PrescriptionItem', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  prescription_id: { type: DataTypes.INTEGER, allowNull: false,
    field: 'PRESCRIPTION_ID' },
  medicine_name: { type: DataTypes.STRING(255), allowNull: false,
    field: 'MEDICINE_NAME' },
  generic_name: { type: DataTypes.STRING(255),
    field: 'GENERIC_NAME' },
  dose: { type: DataTypes.STRING(100),
    field: 'DOSE' },
  dose_unit: { type: DataTypes.STRING(50),
    field: 'DOSE_UNIT' },
  route: { type: DataTypes.STRING(100),
    field: 'ROUTE' }, // Oral, IV, IM, Topical, etc.
  frequency: { type: DataTypes.STRING(100),
    field: 'FREQUENCY' }, // OD, BD, TID, etc.
  duration_days: { type: DataTypes.INTEGER,
    field: 'DURATION_DAYS'},
  instructions: { type: DataTypes.STRING(500),
    field: 'INSTRUCTIONS' },
  is_iv_fluid: { type: DataTypes.TINYINT, defaultValue: 0,
    field: 'IS_IV_FLUID' },
  iv_rate: { type: DataTypes.STRING(100),
    field: 'IV_RATE' },
  iv_duration: { type: DataTypes.STRING(100),
    field: 'IV_DURATION' }
}, {
  tableName: 'HMS_PRESCRIPTION_ITEMS',
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  });

module.exports = PrescriptionItem;
