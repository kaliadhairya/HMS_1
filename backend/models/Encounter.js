const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

// Clinical note fields mapped as DataTypes.TEXT
const Encounter = sequelize.define('Encounter', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  patient_id: { type: DataTypes.INTEGER, allowNull: false,
    field: 'PATIENT_ID' },
  doctor_id: { type: DataTypes.INTEGER, allowNull: false,
    field: 'DOCTOR_ID' },
  department_id: { type: DataTypes.INTEGER,
    field: 'DEPARTMENT_ID'},
  token_id: { type: DataTypes.INTEGER,
    field: 'TOKEN_ID'},
  appointment_id: { type: DataTypes.INTEGER,
    field: 'APPOINTMENT_ID'},
  
  chief_complaint: { type: DataTypes.TEXT,
    field: 'CHIEF_COMPLAINT'},
  hopi: { type: DataTypes.TEXT,
    field: 'HOPI'},
  past_medical_history: { type: DataTypes.TEXT,
    field: 'PAST_MEDICAL_HISTORY'},
  surgical_history: { type: DataTypes.TEXT,
    field: 'SURGICAL_HISTORY'},
  family_history: { type: DataTypes.TEXT,
    field: 'FAMILY_HISTORY'},
  social_history: { type: DataTypes.TEXT,
    field: 'SOCIAL_HISTORY'},
  current_medications: { type: DataTypes.TEXT,
    field: 'CURRENT_MEDICATIONS'},
  
  general_examination: { type: DataTypes.TEXT,
    field: 'GENERAL_EXAMINATION'},
  cvs_findings: { type: DataTypes.TEXT,
    field: 'CVS_FINDINGS'},
  rs_findings: { type: DataTypes.TEXT,
    field: 'RS_FINDINGS'},
  abdomen_findings: { type: DataTypes.TEXT,
    field: 'ABDOMEN_FINDINGS'},
  cns_findings: { type: DataTypes.TEXT,
    field: 'CNS_FINDINGS'},
  
  encounter_date: { 
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'ENCOUNTER_DATE'
  },
  encounter_type: { 
    type: DataTypes.STRING(50),
    defaultValue: 'OPD',
    field: 'ENCOUNTER_TYPE'
  },
  status: { 
    type: DataTypes.STRING(50),
    defaultValue: 'Draft',
    field: 'STATUS' 
  }
}, {
  tableName: 'HMS_ENCOUNTERS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  });

module.exports = Encounter;
