const { DataTypes } = require('sequelize');
const crypto = require('crypto');

function createModels(sequelize, config) {
  const Patient = sequelize.define('Patient', {
    id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ID' },
    patientType: { type: DataTypes.STRING(20), allowNull: false, field: 'PATIENTTYPE' },
    name: { type: DataTypes.STRING(100), allowNull: false, field: 'NAME' }, age: { type: DataTypes.INTEGER, allowNull: false, field: 'AGE' },
    gender: { type: DataTypes.STRING(10), allowNull: false, field: 'GENDER' }, opdIndoor: { type: DataTypes.STRING(10), allowNull: false, field: 'OPDINDOOR' },
    ward: { type: DataTypes.STRING(20), field: 'WARD' }, testDate: { type: DataTypes.DATEONLY, allowNull: false, field: 'TESTDATE' },
    provDiagnosis: { type: DataTypes.STRING(255), field: 'PROVDIAGNOSIS' }, empNumber: { type: DataTypes.STRING(50), field: 'EMPNUMBER' },
    relationship: { type: DataTypes.STRING(20), field: 'RELATIONSHIP' }, phoneNumber: { type: DataTypes.STRING(20), field: 'PHONENUMBER' },
    uhid: { type: DataTypes.STRING(40), field: 'UHID' }, first_name: { type: DataTypes.STRING(100), field: 'FIRST_NAME' }, last_name: { type: DataTypes.STRING(100), field: 'LAST_NAME' },
    dob: { type: DataTypes.DATEONLY, field: 'DOB' }, blood_group: { type: DataTypes.STRING(5), field: 'BLOOD_GROUP' }, alt_phone: { type: DataTypes.STRING(20), field: 'ALT_PHONE' }, email: { type: DataTypes.STRING(100), field: 'EMAIL' },
    house_no: { type: DataTypes.STRING(50), field: 'HOUSE_NO' }, street: { type: DataTypes.STRING(200), field: 'STREET' }, city: { type: DataTypes.STRING(100), field: 'CITY' }, state: { type: DataTypes.STRING(100), field: 'STATE' }, pin: { type: DataTypes.STRING(10), field: 'PIN' }, country: { type: DataTypes.STRING(100), field: 'COUNTRY' },
    emergency_contact_name: { type: DataTypes.STRING(100), field: 'EMERGENCY_CONTACT_NAME' }, emergency_contact_relation: { type: DataTypes.STRING(50), field: 'EMERGENCY_CONTACT_RELATION' }, emergency_contact_phone: { type: DataTypes.STRING(20), field: 'EMERGENCY_CONTACT_PHONE' },
    aadhaar: { type: DataTypes.STRING(255), field: 'AADHAAR' }, photo_url: { type: DataTypes.STRING(500), field: 'PHOTO_URL' }, is_active: { type: DataTypes.INTEGER, field: 'IS_ACTIVE' }, registeredBy: { type: DataTypes.INTEGER, field: 'REGISTEREDBY' }, createdAt: { type: DataTypes.DATE, field: 'CREATED_AT' }, updatedAt: { type: DataTypes.DATE, field: 'UPDATED_AT' },
  }, { tableName: 'HMS_PATIENTS', freezeTableName: true, timestamps: false });
  const Allergy = sequelize.define('Allergy', { id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ID' }, patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' }, allergen: { type: DataTypes.STRING(200), field: 'ALLERGEN' }, reaction: { type: DataTypes.STRING(200), field: 'REACTION' }, severity: { type: DataTypes.STRING(20), field: 'SEVERITY' }, noted_by: { type: DataTypes.INTEGER, field: 'NOTED_BY' }, noted_at: { type: DataTypes.DATE, field: 'NOTED_AT' } }, { tableName: 'HMS_ALLERGIES', freezeTableName: true, timestamps: false });
  const ChronicCondition = sequelize.define('ChronicCondition', { id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ID' }, patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' }, condition_name: { type: DataTypes.STRING(200), field: 'CONDITION_NAME' }, since_when: { type: DataTypes.STRING(100), field: 'SINCE_WHEN' }, notes: { type: DataTypes.STRING(500), field: 'NOTES' }, created_at: { type: DataTypes.DATE, field: 'CREATED_AT' } }, { tableName: 'HMS_CHRONIC_CONDITIONS', freezeTableName: true, timestamps: false });
  const PatientDocument = sequelize.define('PatientDocument', { id: { type: DataTypes.INTEGER, primaryKey: true, field: 'ID' }, patient_id: { type: DataTypes.INTEGER, allowNull: false, field: 'PATIENT_ID' }, file_name: { type: DataTypes.STRING(255), field: 'FILE_NAME' }, file_url: { type: DataTypes.STRING(500), field: 'FILE_URL' }, doc_type: { type: DataTypes.STRING(50), field: 'DOC_TYPE' }, uploaded_by: { type: DataTypes.INTEGER, field: 'UPLOADED_BY' }, uploaded_at: { type: DataTypes.DATE, field: 'UPLOADED_AT' } }, { tableName: 'HMS_PATIENT_DOCUMENTS', freezeTableName: true, timestamps: false });
  Patient.hasMany(Allergy, { foreignKey: 'patient_id', as: 'allergies' }); Allergy.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
  Patient.hasMany(ChronicCondition, { foreignKey: 'patient_id', as: 'chronic_conditions' }); ChronicCondition.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });
  Patient.hasMany(PatientDocument, { foreignKey: 'patient_id', as: 'documents' }); PatientDocument.belongsTo(Patient, { foreignKey: 'patient_id', as: 'patient' });

  function crypt(value) { if (!value) return null; const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(config.aadhaarKey, 'hex'), iv); return `${iv.toString('hex')}:${Buffer.concat([cipher.update(String(value)), cipher.final()]).toString('hex')}`; }
  function mask(value) { if (!value) return null; try { const [ivHex, body] = String(value).split(':'); const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(config.aadhaarKey, 'hex'), Buffer.from(ivHex, 'hex')); const plain = Buffer.concat([decipher.update(Buffer.from(body, 'hex')), decipher.final()]).toString(); return `XXXX-XXXX-${plain.slice(-4)}`; } catch { return null; } }
  Patient.beforeCreate((p) => { if (p.aadhaar) p.aadhaar = crypt(p.aadhaar); }); Patient.beforeUpdate((p) => { if (p.changed('aadhaar') && p.aadhaar) p.aadhaar = crypt(p.aadhaar); });
  Patient.afterFind((result) => { const one = (p) => { if (!p?.aadhaar) return; p.setDataValue('aadhaar_masked', mask(p.aadhaar)); p.setDataValue('aadhaar', undefined); }; Array.isArray(result) ? result.forEach(one) : one(result); });
  return { Patient, Allergy, ChronicCondition, PatientDocument };
}
module.exports = { createModels };
