const { DataTypes } = require('sequelize');
const { sequelize } = require('./db');
const crypto = require('crypto');

// ── Aadhaar Encryption (AES-256-CBC) ────────────────────────────
const ENCRYPTION_KEY = process.env.AADHAAR_ENCRYPTION_KEY || '0'.repeat(64);
const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(ENCRYPTION_KEY, 'hex');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return null;
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const encryptedText = Buffer.from(parts[1], 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (e) {
    return null;
  }
}
const Patient = sequelize.define('Patient', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
        field: 'ID'
  },
  patientType: {
    type: DataTypes.STRING(20),                           // ✅ ENUM → STRING
    allowNull: false,
    validate: {
      isIn: [['corporate_employee', 'cisf_employee', 'other']]}, field: 'PATIENTTYPE',
  },
  // ── Common fields ─────────────────────────────
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    field: 'NAME'
  },
  age: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'AGE'
  },
  gender: {
    type: DataTypes.STRING(10),                           // ✅ ENUM → STRING
    allowNull: false,
    validate: {
      isIn: [['Male', 'Female', 'Other']]}, field: 'GENDER',
  },
  opdIndoor: {
    type: DataTypes.STRING(10),                           // ✅ ENUM → STRING
    allowNull: false,
    validate: {
      isIn: [['OPD', 'Indoor']]}, field: 'OPDINDOOR',
  },
  ward: {
    type: DataTypes.STRING(20),                           // ✅ ENUM → STRING
    defaultValue: 'N/A',
    validate: {
      isIn: [['Medical', 'Surgical', 'Gynaecology', 'Private', 'N/A']]}, field: 'WARD',
  },
  testDate: {
    type: DataTypes.DATEONLY,
    allowNull: false,
    field: 'TESTDATE'
  },
  provDiagnosis: {
    type: DataTypes.STRING(255),
    allowNull: true,
    field: 'PROVDIAGNOSIS'
  },
  // ── Corporate Employee only ─────────────────────────
  empNumber: {
    type: DataTypes.STRING(50),
    allowNull: true,
    field: 'EMPNUMBER'
  },
  relationship: {
    type: DataTypes.STRING(20),                           // ✅ ENUM → STRING
    allowNull: true,
    validate: {
      isIn: [['Self', 'Spouse', 'Son', 'Daughter', 'Father', 'Mother', 'Other']]}, field: 'RELATIONSHIP',
  },
  // ── Others only ───────────────────────────────
  phoneNumber: {
    type: DataTypes.STRING(10),
    allowNull: true,
    field: 'PHONENUMBER'
  },
  // ── Sprint 2: HMS Extension Fields ────────────
  uhid: {
    type: DataTypes.STRING(20),
    allowNull: true,
    unique: true,
    field: 'UHID'
  },
  first_name: {
    type: DataTypes.STRING(100),
    field: 'FIRST_NAME'
  },
  last_name: {
    type: DataTypes.STRING(100),
    field: 'LAST_NAME'
  },
  dob: {
    type: DataTypes.DATEONLY,
    field: 'DOB'
  },
  blood_group: {
    type: DataTypes.STRING(5),
    field: 'BLOOD_GROUP'
  },
  alt_phone: {
    type: DataTypes.STRING(20),
    field: 'ALT_PHONE'
  },
  email: {
    type: DataTypes.STRING(100),
    field: 'EMAIL'
  },
  house_no: {
    type: DataTypes.STRING(50),
    field: 'HOUSE_NO'
  },
  street: {
    type: DataTypes.STRING(200),
    field: 'STREET'
  },
  city: {
    type: DataTypes.STRING(100),
    field: 'CITY'
  },
  state: {
    type: DataTypes.STRING(100),
    field: 'STATE'
  },
  pin: {
    type: DataTypes.STRING(10),
    field: 'PIN'
  },
  country: {
    type: DataTypes.STRING(100),
    defaultValue: 'India',
    field: 'COUNTRY'
  },
  emergency_contact_name: {
    type: DataTypes.STRING(100),
    field: 'EMERGENCY_CONTACT_NAME'
  },
  emergency_contact_relation: {
    type: DataTypes.STRING(50),
    field: 'EMERGENCY_CONTACT_RELATION'
  },
  emergency_contact_phone: {
    type: DataTypes.STRING(20),
    field: 'EMERGENCY_CONTACT_PHONE'
  },
  aadhaar: {
    type: DataTypes.STRING(255), // Encrypted AES-256-CBC,
    field: 'AADHAAR'
  },
  photo_url: {
    type: DataTypes.STRING(500),
    field: 'PHOTO_URL'
  },
  is_active: {
    type: DataTypes.INTEGER,
    defaultValue: 1,
    field: 'IS_ACTIVE'
  },
  // ── Meta ──────────────────────────────────────
  registeredBy: {
    type: DataTypes.INTEGER,
    allowNull: true,
    field: 'REGISTEREDBY',
    references: {
      model: 'HMS_USERS',
      key: 'ID'
    },
  },
  createdAt: {
    type: DataTypes.DATE,
    field: 'CREATED_AT',
  },
  updatedAt: {
    type: DataTypes.DATE,
    field: 'UPDATED_AT',
  },
}, {
  tableName: 'HMS_PATIENTS',
  freezeTableName: true,
  timestamps: false,
  createdAt: 'CREATED_AT',
  updatedAt: 'UPDATED_AT',
  indexes: [
    { fields: ['empNumber'] },
    { fields: ['phoneNumber'] },
    { fields: ['testDate'] },
    { fields: ['name'] },
    { fields: ['uhid'] }, // Sprint 2
  ],
  hooks: {
    beforeCreate: (patient) => {
      if (patient.aadhaar) {
        patient.aadhaar = encrypt(patient.aadhaar);
      }
    },
    beforeUpdate: (patient) => {
      if (patient.changed('aadhaar') && patient.aadhaar) {
        patient.aadhaar = encrypt(patient.aadhaar);
      }
    },
    afterFind: (result) => {
      const maskAadhaar = (patient) => {
        if (patient && patient.aadhaar) {
          const decrypted = decrypt(patient.aadhaar);
          patient.dataValues.aadhaarMasked = decrypted
            ? 'XXXX-XXXX-' + decrypted.slice(-4) : null;
          patient.dataValues.aadhaar = undefined;
        }
      };
      if (Array.isArray(result)) {
        result.forEach(maskAadhaar);
      } else {
        maskAadhaar(result);
      }
    },
  }
});

module.exports = Patient;
