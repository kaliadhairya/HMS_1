const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const Allergy = sequelize.define('Allergy', {
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
  allergen: {
    type: DataTypes.STRING(200),
    field: 'ALLERGEN'
  },
  reaction: {
    type: DataTypes.STRING(200),
    field: 'REACTION'
  },
  severity: {
    type: DataTypes.STRING(20),
    field: 'SEVERITY'
  },
  noted_by: {
    type: DataTypes.INTEGER,
    field: 'NOTED_BY'
  },
}, {
  tableName: 'HMS_ALLERGIES',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  createdAt: 'noted_at',
  updatedAt: false,
});

module.exports = Allergy;
