const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');

const emptyHaematology = { hb: { result: '' }, tlc: { result: '' }, dlc: { polymorphs: { result: '' }, lymphocytes: { result: '' }, eosinophils: { result: '' }, monocytes: { result: '' }, basophils: { result: '' } }, rbc: { result: '' }, pcv: { result: '' }, mcv: { result: '' }, mch: { result: '' }, mchc: { result: '' }, platelets: { result: '' }, reticulocytes: { result: '' }, esr: { result: '' }, bt: { result: '' }, ct: { result: '' }, mp: { result: '' }, peripheral_smear: { result: '' } };
const emptyBio = { fbs: { result: '' }, ppbs: { result: '' }, rbs: { result: '' }, blood_urea: { result: '' }, sCreatinine: { result: '' }, sUricAcid: { result: '' }, sCholesterol: { result: '' }, sTriglycerides: { result: '' }, hdl: { result: '' }, ldl: { result: '' }, vldl: { result: '' }, sBilirubinTotal: { result: '' }, sBilirubinDirect: { result: '' }, sBilirubinIndirect: { result: '' }, sgot: { result: '' }, sgpt: { result: '' }, sAlkalinePhosphatase: { result: '' }, sCalcium: { result: '' }, sPhosphorus: { result: '' }, sElectrolytes: { na: { result: '' }, k: { result: '' }, cl: { result: '' } }, sTotalProteins: { result: '' }, sAlbumin: { result: '' }, sGlobulin: { result: '' }, agRatio: { result: '' } };
const emptySero = { widal: { to: { result: '' }, th: { result: '' }, ah: { result: '' }, bh: { result: '' } }, raFactor: { result: '' }, crp: { result: '' }, asoTitre: { result: '' }, hbsag: { result: '' }, hcv: { result: '' }, vdrl: { result: '' }, hiv: { result: '' }, dengue: { result: '' }, chikungunya: { result: '' }, malariaAntigen: { result: '' }, typhidot: { result: '' } };
const emptyUrine = { physical: { quantity: { result: '' }, color: { result: '' }, appearance: { result: '' }, spGravity: { result: '' } }, chemical: { reaction: { result: '' }, albumin: { result: '' }, sugar: { result: '' }, ketoneBits: { result: '' }, bileSalts: { result: '' }, bilePigments: { result: '' }, urobilinogen: { result: '' }, blood: { result: '' } }, microscopic: { pusCells: { result: '' }, rbcs: { result: '' }, epithelialCells: { result: '' }, casts: { result: '' }, crystals: { result: '' }, bacteria: { result: '' }, others: { result: '' } } };
const emptyOther = { stool: { physical: { result: '' }, microscopic: { result: '' } }, semen: { physical: { result: '' }, microscopic: { result: '' } }, sputum: { afb: { result: '' } } };

const TestReport = sequelize.define('TestReport', {
  id: { type: DataTypes.INTEGER, primaryKey: true,  field: 'ID' },
  patientId: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' },
  haematology: { type: DataTypes.TEXT, get() { return JSON.parse(this.getDataValue('haematology') || '{}'); }, set(val) { this.setDataValue('haematology', JSON.stringify(val)); }, field: 'HAEMATOLOGY' },
  biochemistry: { type: DataTypes.TEXT, get() { return JSON.parse(this.getDataValue('biochemistry') || '{}'); }, set(val) { this.setDataValue('biochemistry', JSON.stringify(val)); }, field: 'BIOCHEMISTRY' },
  serology: { type: DataTypes.TEXT, get() { return JSON.parse(this.getDataValue('serology') || '{}'); }, set(val) { this.setDataValue('serology', JSON.stringify(val)); }, field: 'SEROLOGY' },
  urine: { type: DataTypes.TEXT, get() { return JSON.parse(this.getDataValue('urine') || '{}'); }, set(val) { this.setDataValue('urine', JSON.stringify(val)); }, field: 'URINE' },
  other: { type: DataTypes.TEXT, get() { return JSON.parse(this.getDataValue('other') || '{}'); }, set(val) { this.setDataValue('other', JSON.stringify(val)); }, field: 'OTHER' },
  remarks: { type: DataTypes.TEXT, field: 'REMARKS' },
  suggestions: { type: DataTypes.TEXT, field: 'SUGGESTIONS' },
  reportedBy: { type: DataTypes.INTEGER, field: 'REPORTED_BY' },
  reportDate: { type: DataTypes.DATE, field: 'REPORT_DATE' },
  status: { type: DataTypes.STRING(20), defaultValue: 'Draft', field: 'STATUS' },
  createdAt: { type: DataTypes.DATE, field: 'CREATED_AT' },
  updatedAt: { type: DataTypes.DATE, field: 'UPDATED_AT' }
}, {
  tableName: 'HMS_TEST_REPORTS',
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  
});

module.exports = TestReport;
module.exports.emptyHaematology = emptyHaematology;
module.exports.emptyBio = emptyBio;
module.exports.emptySero = emptySero;
module.exports.emptyUrine = emptyUrine;
module.exports.emptyOther = emptyOther;