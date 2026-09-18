const express = require('express');
const router = express.Router();
const { Op } = require('sequelize');
const { sequelize } = require('../models/db');          // ✅ added for sequelize.fn
const { QueryTypes } = require('sequelize');
const { sequelize: seq } = require('../models');        // ✅ for transactions
const Patient = require('../models/Patient');
const TestReport = require('../models/TestReport');
const User = require('../models/User');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const { encrypt, decrypt, maskAadhaar } = require('../utils/encryption');
const { Allergy, ChronicCondition, PatientDocument } = require('../models');
const { body, validationResult } = require('express-validator');

const VALID_PATIENT_TYPES = new Set(['corporate_employee', 'cisf_employee', 'other']);
const PHONE_REQUIRED_PATIENT_TYPES = new Set(['other']);

function splitPatientName(rawName) {
  const normalized = String(rawName || '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return { firstName: null, lastName: null };
  }

  const parts = normalized.split(' ');
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: null };
  }

  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

// POST /api/patients — Register new patient
router.post('/', [
  body('name').trim().escape(),
  body('phoneNumber').optional({ checkFalsy: true }).trim().escape(),
  body('empNumber').optional({ checkFalsy: true }).trim().escape(),
], protect, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const {
      patientType, name, age, gender, opdIndoor, ward,
      testDate, provDiagnosis, empNumber, relationship, phoneNumber,
      doctorId, departmentId,
    } = req.body;
    const { firstName, lastName } = splitPatientName(name);

    if (!patientType || !name || !age || !gender || !opdIndoor || !testDate) {
      return res.status(400).json({ success: false, message: 'Required fields missing.' });
    }
    if (patientType === 'corporate_employee' && !empNumber) {
      return res.status(400).json({ success: false, message: 'Employee number is required for corporate employees.' });
    }
    if (!VALID_PATIENT_TYPES.has(patientType)) {
      return res.status(400).json({ success: false, message: 'Invalid patient type.' });
    }
    const cleanPhoneNumber = phoneNumber ? String(phoneNumber).replace(/\s/g, '') : null;
    if (PHONE_REQUIRED_PATIENT_TYPES.has(patientType) && (!cleanPhoneNumber || !/^\d{10}$/.test(cleanPhoneNumber))) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Phone Number is required.' });
    }

    const patientData = {
      patientType,
      name,
      age: Number(age),
      gender,
      opdIndoor,
      ward: ward || 'N/A',
      testDate,
      provDiagnosis,
      registeredBy: Number(req.user.id),
      doctor_id: doctorId ? Number(doctorId) : null,
      department_id: departmentId ? Number(departmentId) : null,
    };

    if (patientType === 'corporate_employee') {
      patientData.empNumber = empNumber;
      patientData.relationship = relationship || 'Self';
    } else {
      patientData.phoneNumber = cleanPhoneNumber;
      if (patientType === 'cisf_employee') patientData.empNumber = empNumber || null;
    }

    const result = await sequelize.transaction(async (t) => {
      // ✅ Fetch IDs from sequences
      const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_patients_seq') AS \"NEXTVAL\"", { transaction: t });
      const [[{ NEXTVAL: reportId }]] = await sequelize.query("SELECT nextval('hms_test_reports_seq') AS \"NEXTVAL\"", { transaction: t });

      const year = new Date().getFullYear();
      const paddedId = String(nextId).padStart(6, '0');
      const uhid = `HOSP-${year}-${paddedId}`;

      // ✅ Raw SQL Insert for Patient (ensures perfect data alignment)
      await sequelize.query(`
        INSERT INTO HMS_PATIENTS (
          ID, UHID, NAME, FIRST_NAME, LAST_NAME, AGE, GENDER, PATIENTTYPE, OPDINDOOR, WARD,
          TESTDATE, PROVDIAGNOSIS, EMPNUMBER, RELATIONSHIP, PHONENUMBER,
          REGISTEREDBY, IS_ACTIVE, CREATED_AT, UPDATED_AT
        ) VALUES (
          :id, :uhid, :name, :firstName, :lastName, :age, :gender, :patientType, :opdIndoor, :ward,
          TO_DATE(:testDate, 'YYYY-MM-DD'), :provDiagnosis, :empNumber, :relationship, :phoneNumber,
          :registeredBy, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: nextId,
          uhid: uhid,
          name: name,
          firstName,
          lastName,
          age: Number(age),
          gender: gender,
          patientType: patientType,
          opdIndoor: opdIndoor,
          ward: ward || 'N/A',
          testDate: testDate, // format YYYY-MM-DD from frontend
          provDiagnosis: provDiagnosis || null,
          empNumber: patientType === 'corporate_employee' || patientType === 'cisf_employee' ? (empNumber || null) : null,
          relationship: patientType === 'corporate_employee' ? (relationship || 'Self') : null,
          phoneNumber: cleanPhoneNumber,
          registeredBy: Number(req.user.id)
        },
        transaction: t
      });

      // ✅ Raw SQL Insert for Test Report
      await sequelize.query(`
        INSERT INTO HMS_TEST_REPORTS (
          ID, PATIENT_ID, REPORTED_BY, STATUS, CREATED_AT, UPDATED_AT
        ) VALUES (
          :id, :patientId, :reportedBy, 'Draft', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: reportId,
          patientId: nextId,
          reportedBy: Number(req.user.id)
        },
        transaction: t
      });

      return { id: nextId, uhid: uhid, reportId: reportId };
    });

    res.status(201).json({
      success: true,
      message: 'Patient registered successfully.',
      patient: { id: result.id, uhid: result.uhid },
      reportId: result.reportId,
    });
  } catch (err) {
    console.error(err);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Duplicate entry detected.' });
    }
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients — List all patients with optional filters
router.get('/', protect, async (req, res) => {
  try {
    const { empNumber, phoneNumber, fromDate, toDate, patientType, page = 1, limit = 20 } = req.query;

    const where = {};

    // Wrap with UPPER() for case-insensitive search
    if (empNumber) {
      where[Op.and] = [
        sequelize.where(
          sequelize.fn('UPPER', sequelize.col('empNumber')),
          { [Op.like]: `%${empNumber.toUpperCase()}%` }
        ),
      ];
    }
    if (phoneNumber) {
      where[Op.and] = [
        ...(where[Op.and] || []),
        sequelize.where(
          sequelize.fn('UPPER', sequelize.col('phoneNumber')),
          { [Op.like]: `%${phoneNumber.toUpperCase()}%` }
        ),
      ];
    }
    if (patientType) where.patientType = patientType;
    if (fromDate || toDate) {
      where[Op.and] = where[Op.and] || [];
      if (fromDate) {
        where[Op.and].push(
          sequelize.where(
            sequelize.fn('TRUNC', sequelize.col('testDate')),
            '>=',
            sequelize.literal(`TO_DATE('${fromDate}', 'YYYY-MM-DD')`)
          )
        );
      }
      if (toDate) {
        where[Op.and].push(
          sequelize.where(
            sequelize.fn('TRUNC', sequelize.col('testDate')),
            '<=',
            sequelize.literal(`TO_DATE('${toDate}', 'YYYY-MM-DD')`)
          )
        );
      }
    }

    // JS-level pagination slicing
    const allPatients = await Patient.findAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: User,
        as: 'registeredByUser',
        attributes: ['name', 'username'],
      }],
    });

    const total = allPatients.length;
    const pg = Number(page);
    const lim = Number(limit);
    const start = (pg - 1) * lim;
    const patients = allPatients.slice(start, start + lim);

    res.json({ success: true, total, page: pg, patients });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ═══════════════════════════════════════════════════════════════
// SPRINT 2: HMS PATIENT EXTENSIONS
// ═══════════════════════════════════════════════════════════════

// POST /api/patients/hms — Full HMS Patient Registration
router.post('/hms', [
  body('name').trim().escape(),
  body('first_name').optional({ checkFalsy: true }).trim().escape(),
  body('last_name').optional({ checkFalsy: true }).trim().escape(),
  body('phoneNumber').optional({ checkFalsy: true }).trim().escape(),
  body('empNumber').optional({ checkFalsy: true }).trim().escape(),
  body('relationship').optional({ checkFalsy: true }).trim().escape(),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail(),
], protect, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const normalizeOptional = (value) => {
      if (value === undefined || value === null) return null;
      if (typeof value === 'string' && value.trim() === '') return null;
      return value;
    };

    const {
      patientType, name, first_name, last_name, age, gender, opdIndoor,
      testDate, phoneNumber, dob, blood_group, alt_phone, email,
      house_no, street, city, state, pin, country,
      emergency_contact_name, emergency_contact_relation, emergency_contact_phone,
      aadhaar, photo_url, empNumber, relationship
    } = req.body;

    if (!name || !age || !gender || !patientType || !opdIndoor || !testDate) {
      return res.status(400).json({ success: false, message: 'Required core fields missing.' });
    }
    if (!VALID_PATIENT_TYPES.has(patientType)) {
      return res.status(400).json({ success: false, message: 'Invalid patient type.' });
    }
    const cleanPhoneNumber = normalizeOptional(phoneNumber)?.replace(/\s/g, '') || null;
    if (PHONE_REQUIRED_PATIENT_TYPES.has(patientType) && (!cleanPhoneNumber || !/^\d{10}$/.test(cleanPhoneNumber))) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Phone Number is required.' });
    }

    const patientData = {
      patientType,
      name,
      age,
      gender,
      opdIndoor,
      testDate,
      first_name: normalizeOptional(first_name),
      last_name: normalizeOptional(last_name),
      dob: normalizeOptional(dob),
      blood_group: normalizeOptional(blood_group),
      alt_phone: normalizeOptional(alt_phone),
      email: normalizeOptional(email),
      house_no: normalizeOptional(house_no),
      street: normalizeOptional(street),
      city: normalizeOptional(city),
      state: normalizeOptional(state),
      pin: normalizeOptional(pin),
      country: normalizeOptional(country),
      emergency_contact_name: normalizeOptional(emergency_contact_name),
      emergency_contact_relation: normalizeOptional(emergency_contact_relation),
      emergency_contact_phone: normalizeOptional(emergency_contact_phone),
      photo_url: normalizeOptional(photo_url),
      registeredBy: req.user.id,
    };

    if (aadhaar) {
      patientData.aadhaar = aadhaar; // Model beforeCreate hook will encrypt — do NOT encrypt here (causes double encryption)
    }

    if (patientType === 'corporate_employee') {
      patientData.empNumber = normalizeOptional(empNumber);
      patientData.relationship = normalizeOptional(relationship) || 'Self';
    } else {
      patientData.phoneNumber = cleanPhoneNumber;
      if (patientType === 'cisf_employee') patientData.empNumber = normalizeOptional(empNumber);
    }

    // ✅ Generate ID and UHID manually to ensure they are returned
    const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_patients_seq') AS \"NEXTVAL\"");
    const year = new Date().getFullYear();
    const paddedId = String(nextId).padStart(6, '0');
    const uhid = `HOSP-${year}-${paddedId}`;

    patientData.id = nextId;
    patientData.uhid = uhid;

    const patient = await Patient.create(patientData);

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'patient', patient.id, null, { name: patient.name, type: patientType }, ip);

    // Return without sensitive encrypted data
    const resPatient = patient.toJSON();
    delete resPatient.aadhaar;

    res.status(201).json({ success: true, message: 'Patient registered.', data: resPatient });
  } catch (err) {
    console.error(err);
    if (err.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({ success: false, message: 'Duplicate entry detected.' });
    }
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/emp/:empNumber — Get Corporate Employee & Dependents
const getCorporateDependentsHandler = async (req, res) => {
  try {
    const { empNumber } = req.params;

    // Extract numeric part in case they send "EMP-12345"
    const numericEmpN = empNumber.replace(/\D/g, '');

    if (!numericEmpN) {
      return res.json({ success: true, data: [] });
    }

    // Query DEPENDENT_MASTER_SAP directly; falls back to HMS_PATIENTS if table is unavailable
    let records = [];
    try {
      records = await sequelize.query(`
        SELECT 
          EMPN, DNAME, REL, SEX, EXTRACT(YEAR FROM CURRENT_DATE) - EXTRACT(YEAR FROM DOB) AS CALC_AGE
        FROM DEPENDENT_MASTER_SAP
        WHERE EMPN = :empn
      `, {
        replacements: { empn: Number(numericEmpN) },
        type: QueryTypes.SELECT
      });
    } catch (localMasterErr) {
      // Fallback: Local patient records (only shows already registered dependents)
      const localRows = await sequelize.query(`
        SELECT NAME AS DNAME, RELATIONSHIP AS REL, GENDER AS SEX, AGE AS CALC_AGE
        FROM HMS_PATIENTS
        WHERE EMPNUMBER = :empn AND PATIENTTYPE = 'corporate_employee'
      `, {
        replacements: { empn: numericEmpN },
        type: QueryTypes.SELECT
      });
      records = localRows.map(r => ({
        DNAME: r.DNAME,
        REL: r.REL === 'Self' ? 'X' : r.REL === 'Spouse' ? 'W' : r.REL === 'Son' ? 'S' : r.REL === 'Daughter' ? 'D' : r.REL === 'Father' ? 'F' : r.REL === 'Mother' ? 'M' : 'O',
        SEX: r.SEX === 'Male' ? 'M' : r.SEX === 'Female' ? 'F' : 'O',
        CALC_AGE: r.CALC_AGE
      }));
    }
    // Map the database values to our standardized formats
    const mapRel = (rel) => {
      const r = (rel || '').toUpperCase();
      if (r === 'X') return 'Self';
      if (r === 'W') return 'Spouse';
      if (r === 'H') return 'Spouse';
      if (r === 'S') return 'Son';
      if (r === 'D') return 'Daughter';
      if (r === 'F') return 'Father';
      if (r === 'M') return 'Mother';
      return 'Other';
    };

    const mapSex = (sex) => {
      const s = (sex || '').toUpperCase();
      if (s === 'M') return 'Male';
      if (s === 'F') return 'Female';
      return 'Other';
    };

    // Map keys to camelCase for the frontend
    const formatRecords = records.map(r => ({
      name: r.DNAME || '',
      age: r.CALC_AGE || 0,
      gender: mapSex(r.SEX),
      relationship: mapRel(r.REL)
    }));

    // Remove duplicates based on Name and Relationship
    const uniqueRecordsMap = new Map();
    for (const record of formatRecords) {
      const key = `${record.name.trim().toUpperCase()}|${record.relationship}`;
      if (!uniqueRecordsMap.has(key)) {
        uniqueRecordsMap.set(key, record);
      }
    }
    const finalRecords = Array.from(uniqueRecordsMap.values());

    // Sort Self first
    finalRecords.sort((a, b) => {
      if (a.relationship === 'Self') return -1;
      if (b.relationship === 'Self') return 1;
      return 0;
    });

    res.json({ success: true, data: finalRecords });
  } catch (err) {
    console.error('Error fetching corporate dependents:', err);
    res.status(500).json({ success: false, message: 'Server error fetching dependents' });
  }
};
router.get('/hms/emp/:empNumber', protect, getCorporateDependentsHandler);

// GET /api/patients/hms/search?q=&empNumber=&phoneNumber=&fromDate=&toDate=&patientType= — Advanced Search
router.get('/hms/search', protect, async (req, res) => {
  try {
    const { q, empNumber, phoneNumber, fromDate, toDate, patientType, doctorId } = req.query;
    const searchTerm = q ? q.toUpperCase() : '';
    const empFilter = empNumber ? empNumber.toUpperCase() : '';
    const phoneFilter = phoneNumber ? phoneNumber.trim() : '';
    const typeFilter = patientType ? patientType : '';

    let filterClauses = [];
    let replacements = { searchTerm };

    // General search term
    if (searchTerm) {
      filterClauses.push(`(
        UPPER(p.NAME) LIKE '%' || :searchTerm || '%' OR 
        UPPER(p.UHID) LIKE '%' || :searchTerm || '%' OR
        UPPER(p.PHONENUMBER) LIKE '%' || :searchTerm || '%' OR
        UPPER(p.EMPNUMBER) LIKE '%' || :searchTerm || '%' OR
        UPPER(p.RELATIONSHIP) LIKE '%' || :searchTerm || '%'
      )`);
    }

    // Specific filters
    if (empFilter) {
      filterClauses.push(`UPPER(p.EMPNUMBER) LIKE '%' || :empFilter || '%'`);
      replacements.empFilter = empFilter;
    }
    if (phoneFilter) {
      filterClauses.push(`p.PHONENUMBER LIKE '%' || :phoneFilter || '%'`);
      replacements.phoneFilter = phoneFilter;
    }
    if (typeFilter) {
      filterClauses.push(`p.PATIENTTYPE = :typeFilter`);
      replacements.typeFilter = typeFilter;
    }
    if (doctorId) {
      filterClauses.push(`e.DOCTOR_ID = :doctorId`);
      replacements.doctorId = Number(doctorId);
    }
    if (fromDate) {
      filterClauses.push(`TRUNC(p.CREATED_AT) >= TO_DATE(:fromDate, 'YYYY-MM-DD')`);
      replacements.fromDate = fromDate;
    }
    if (toDate) {
      filterClauses.push(`TRUNC(p.CREATED_AT) <= TO_DATE(:toDate, 'YYYY-MM-DD')`);
      replacements.toDate = toDate;
    }

    const whereClause = filterClauses.length > 0
      ? 'WHERE ' + filterClauses.join(' AND ')
      : '';

    const query = `
      SELECT 
        p.ID as "id", p.UHID as "uhid", p.NAME as "patient_name", p.FIRST_NAME as "first_name", p.LAST_NAME as "last_name", 
        p.AGE as "age", p.GENDER as "gender", p.PATIENTTYPE as "patient_type", 
        p.EMPNUMBER as "emp_number", p.RELATIONSHIP as "relationship", p.PHONENUMBER as "phone_number", 
        p.CREATED_AT as "registration_date",
        princ.NAME AS "employee_name",
        e.ENCOUNTER_DATE AS "consultation_date",
        u.NAME AS "doctor_name"
      FROM HMS_PATIENTS p
      LEFT JOIN (
         SELECT EMPNUMBER, MAX(NAME) as NAME 
         FROM HMS_PATIENTS 
         WHERE RELATIONSHIP = 'Self' AND PATIENTTYPE = 'corporate_employee'
         GROUP BY EMPNUMBER
      ) princ ON p.EMPNUMBER = princ.EMPNUMBER 
      LEFT JOIN (
         SELECT PATIENT_ID, ENCOUNTER_DATE, DOCTOR_ID,
         ROW_NUMBER() OVER(PARTITION BY PATIENT_ID ORDER BY ENCOUNTER_DATE DESC) as rn
         FROM HMS_ENCOUNTERS
      ) e ON e.PATIENT_ID = p.ID AND e.rn = 1
      LEFT JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
      ${whereClause}
      ORDER BY p.CREATED_AT DESC
    `;

    const results = await sequelize.query(query, {
      replacements,
      type: QueryTypes.SELECT
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error('Patient Search API Error:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/today-patients — All patients registered today, with consulting doctor info
router.get('/hms/today-patients', protect, async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const rows = await sequelize.query(`
      SELECT 
        p.ID, p.UHID, p.NAME, p.FIRST_NAME, p.LAST_NAME, p.AGE, p.GENDER, 
        p.PATIENTTYPE, p.EMPNUMBER, p.RELATIONSHIP, p.PHONENUMBER,
        p.CREATED_AT,
        e.ID AS ENCOUNTER_ID, e.DOCTOR_ID AS CONSULTING_DOCTOR_ID, e.STATUS AS ENCOUNTER_STATUS,
        u.NAME AS CONSULTING_DOCTOR_NAME
      FROM HMS_PATIENTS p
      LEFT JOIN (
        SELECT ID, PATIENT_ID, DOCTOR_ID, STATUS,
               ROW_NUMBER() OVER (PARTITION BY PATIENT_ID ORDER BY ID DESC) as rn
        FROM HMS_ENCOUNTERS
        WHERE TRUNC(ENCOUNTER_DATE) = TO_DATE(:today, 'YYYY-MM-DD')
      ) e ON e.PATIENT_ID = p.ID AND e.rn = 1
      LEFT JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
      WHERE TRUNC(p.CREATED_AT) = TO_DATE(:today, 'YYYY-MM-DD')
         OR e.ID IS NOT NULL
      ORDER BY p.CREATED_AT DESC
    `, {
      replacements: { today },
      type: QueryTypes.SELECT
    });

    const patients = rows.map(r => ({
      id: r.id ?? r.ID,
      uhid: r.uhid ?? r.UHID,
      name: r.name ?? r.NAME,
      first_name: r.first_name ?? r.FIRST_NAME,
      last_name: r.last_name ?? r.LAST_NAME,
      age: r.age ?? r.AGE,
      gender: r.gender ?? r.GENDER,
      patientType: r.patienttype ?? r.PATIENTTYPE,
      empNumber: r.empnumber ?? r.EMPNUMBER,
      relationship: r.relationship ?? r.RELATIONSHIP,
      phoneNumber: r.phonenumber ?? r.PHONENUMBER,
      created_at: r.created_at ?? r.CREATED_AT,
      encounter_id: r.encounter_id ?? r.ENCOUNTER_ID ?? null,
      consulting_doctor_id: r.consulting_doctor_id ?? r.CONSULTING_DOCTOR_ID ?? null,
      consulting_doctor_name: r.consulting_doctor_name ?? r.CONSULTING_DOCTOR_NAME ?? null,
      encounter_status: r.encounter_status ?? r.ENCOUNTER_STATUS ?? null,
    }));

    res.json({ success: true, data: patients });
  } catch (err) {
    console.error('Error fetching today patients:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/pending-consultation — Patients registered in past days but never consulted
router.get('/hms/pending-consultation', protect, async (req, res) => {
  try {
    const rows = await sequelize.query(`
      SELECT 
        p.ID, p.UHID, p.NAME, p.FIRST_NAME, p.LAST_NAME, p.AGE, p.GENDER, 
        p.PATIENTTYPE, p.EMPNUMBER, p.RELATIONSHIP, p.PHONENUMBER,
        p.CREATED_AT,
        TRUNC(CURRENT_TIMESTAMP) - TRUNC(p.CREATED_AT) AS DAYS_AGO
      FROM HMS_PATIENTS p
      WHERE TRUNC(p.CREATED_AT) < TRUNC(CURRENT_TIMESTAMP)
        AND NOT EXISTS (
          SELECT 1 FROM HMS_ENCOUNTERS e WHERE e.PATIENT_ID = p.ID
        )
      ORDER BY p.CREATED_AT DESC
    `, {
      type: QueryTypes.SELECT
    });

    const patients = rows.map(r => ({
      id: r.id ?? r.ID,
      uhid: r.uhid ?? r.UHID,
      name: r.name ?? r.NAME,
      first_name: r.first_name ?? r.FIRST_NAME,
      last_name: r.last_name ?? r.LAST_NAME,
      age: r.age ?? r.AGE,
      gender: r.gender ?? r.GENDER,
      patientType: r.patienttype ?? r.PATIENTTYPE,
      empNumber: r.empnumber ?? r.EMPNUMBER,
      relationship: r.relationship ?? r.RELATIONSHIP,
      phoneNumber: r.phonenumber ?? r.PHONENUMBER,
      created_at: r.created_at ?? r.CREATED_AT,
      days_ago: Number(r.days_ago ?? r.DAYS_AGO) || 0,
    }));

    res.json({ success: true, data: patients });
  } catch (err) {
    console.error('Error fetching pending consultation patients:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/:id — Full Profile
router.get('/hms/:id', protect, async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const pData = patient.toJSON();
    pData.aadhaar_masked = maskAadhaar(pData.aadhaar);
    delete pData.aadhaar;

    if (pData.patientType === 'corporate_employee' && pData.empNumber) {
      try {
        const query = `
          SELECT MAX(NAME) as "employee_name" 
          FROM HMS_PATIENTS 
          WHERE RELATIONSHIP = 'Self' AND EMPNUMBER = :empNum
        `;
        const [[empRecord]] = await sequelize.query(query, { replacements: { empNum: String(pData.empNumber) } });
        pData.employee_name = empRecord ? empRecord.employee_name : null;
      } catch (e) {
        console.error('Error fetching employee name:', e);
        pData.employee_name = null;
      }
    }

    // Retrieve lab reports count for patient
    const [labReportsRow] = await sequelize.query(
      `SELECT COUNT(*) AS CNT FROM HMS_TEST_REPORTS WHERE PATIENT_ID = :patientId`,
      {
        replacements: { patientId: patient.id },
        type: QueryTypes.SELECT,
      }
    );
    const labReportsCount = Number(labReportsRow?.CNT || labReportsRow?.cnt || 0);

    // Get Lists
    const allergies = await Allergy.findAll({ where: { patient_id: patient.id } });
    const conditions = await ChronicCondition.findAll({ where: { patient_id: patient.id } });

    res.json({
      success: true,
      data: {
        ...pData,
        counts: { lab_reports: labReportsCount, visits: 0, prescriptions: 0 },
        allergies,
        chronic_conditions: conditions
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/:id/visits
router.get('/hms/:id/visits', protect, async (req, res) => {
  try {
    const patientId = req.params.id;

    // Fetch OPD encounters
    const encounters = await sequelize.query(
      `SELECT
         e.ID,
         e.ENCOUNTER_DATE,
         e.ENCOUNTER_TYPE,
         e.STATUS,
         e.CHIEF_COMPLAINT,
         u.NAME AS DOCTOR_NAME,
         d.NAME AS DEPT_NAME
       FROM HMS_ENCOUNTERS e
       LEFT JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
       LEFT JOIN HMS_DEPARTMENTS d ON d.ID = e.DEPARTMENT_ID
       WHERE e.PATIENT_ID = :patientId
       ORDER BY e.ENCOUNTER_DATE DESC`,
      {
        replacements: { patientId },
        type: QueryTypes.SELECT,
      }
    );

    // Fetch lab reports
    const reports = await sequelize.query(
      `SELECT
         tr.ID,
         tr.CREATED_AT,
         tr.STATUS,
         u.NAME AS REPORTED_BY_NAME
       FROM HMS_TEST_REPORTS tr
       LEFT JOIN HMS_USERS u ON u.ID = tr.REPORTED_BY
       WHERE tr.PATIENT_ID = :patientId
       ORDER BY tr.CREATED_AT DESC`,
      {
        replacements: { patientId },
        type: QueryTypes.SELECT,
      }
    );

    const visits = [];

    // Map encounters
    encounters.forEach((e) => {
      visits.push({
        date: e.ENCOUNTER_DATE,
        type: e.ENCOUNTER_TYPE || 'OPD',
        doctor: e.DOCTOR_NAME || 'N/A',
        department: e.DEPT_NAME || 'General',
        status: e.STATUS || 'Completed',
        complaint: e.CHIEF_COMPLAINT || '',
        reference_id: e.ID,
      });
    });

    // Map lab reports
    reports.forEach((r) => {
      visits.push({
        date: r.CREATED_AT,
        type: 'Lab Test',
        doctor: r.REPORTED_BY_NAME || 'Lab',
        department: 'Pathology',
        status: r.STATUS,
        reference_id: r.ID,
      });
    });

    // Sort newest first
    visits.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));

    res.json({ success: true, data: visits });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/:id/documents
router.get('/hms/:id/documents', protect, async (req, res) => {
  try {
    const docs = await PatientDocument.findAll({
      where: { patient_id: req.params.id },
      order: [['uploaded_at', 'DESC']]
    });
    res.json({ success: true, data: docs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/:id/allergies
router.get('/hms/:id/allergies', protect, async (req, res) => {
  try {
    const items = await Allergy.findAll({ where: { patient_id: req.params.id }, order: [['noted_at', 'DESC']] });
    res.json({ success: true, data: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/patients/hms/:id/chronic-conditions
router.get('/hms/:id/chronic-conditions', protect, async (req, res) => {
  try {
    const items = await ChronicCondition.findAll({ where: { patient_id: req.params.id }, order: [['created_at', 'DESC']] });
    res.json({ success: true, data: items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/patients/hms/:id/allergies
router.post('/hms/:id/allergies', protect, async (req, res) => {
  try {
    const { allergen, reaction, severity } = req.body;
    if (!allergen) return res.status(400).json({ success: false, message: 'Allergen is required.' });

    const allergy = await Allergy.create({
      patient_id: req.params.id,
      allergen, reaction, severity,
      noted_by: req.user.id
    });
    res.status(201).json({ success: true, data: allergy });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// POST /api/patients/hms/:id/chronic-conditions
router.post('/hms/:id/chronic-conditions', protect, async (req, res) => {
  try {
    const { condition_name, since_when, notes } = req.body;
    if (!condition_name) return res.status(400).json({ success: false, message: 'Condition name required.' });

    const condition = await ChronicCondition.create({
      patient_id: req.params.id,
      condition_name, since_when, notes
    });
    res.status(201).json({ success: true, data: condition });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// Note: POST /hms/:id/documents omitted here, will be added after multer installed and separate route if complex

// ═══════════════════════════════════════════════════════════════
// WILDCARD /:id ROUTES — Must be AFTER all /hms/* routes
// to prevent /:id from intercepting /hms/emp/:empNumber etc.
// ═══════════════════════════════════════════════════════════════

// PUT /api/patients/:id — Edit existing patient
router.put('/:id', protect, async (req, res) => {
  try {
    const {
      patientType, name, age, gender, opdIndoor, ward,
      testDate, provDiagnosis, empNumber, relationship, phoneNumber,
      doctorId, departmentId,
    } = req.body;

    const patient = await Patient.findByPk(req.params.id);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    if (patientType && !VALID_PATIENT_TYPES.has(patientType)) {
      return res.status(400).json({ success: false, message: 'Invalid patient type.' });
    }
    const nextPatientType = patientType || patient.patientType;
    const cleanPhoneNumber = phoneNumber ? String(phoneNumber).replace(/\s/g, '') : null;
    const nextPhoneNumber = phoneNumber !== undefined ? cleanPhoneNumber : patient.phoneNumber;
    if (PHONE_REQUIRED_PATIENT_TYPES.has(nextPatientType) && (!nextPhoneNumber || !/^\d{10}$/.test(String(nextPhoneNumber)))) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit Phone Number is required.' });
    }

    patient.patientType = nextPatientType;
    patient.name = name || patient.name;
    patient.age = age || patient.age;
    patient.gender = gender || patient.gender;
    patient.opdIndoor = opdIndoor || patient.opdIndoor;
    patient.ward = ward || patient.ward;
    patient.testDate = testDate || patient.testDate;
    patient.provDiagnosis = provDiagnosis || patient.provDiagnosis;
    patient.doctor_id = doctorId ? Number(doctorId) : patient.doctor_id;
    patient.department_id = departmentId ? Number(departmentId) : patient.department_id;

    if (patient.patientType === 'corporate_employee') {
      patient.empNumber = empNumber || patient.empNumber;
      patient.relationship = relationship || patient.relationship;
      patient.phoneNumber = null;
    } else if (patient.patientType === 'cisf_employee') {
      patient.empNumber = empNumber !== undefined ? (empNumber || null) : patient.empNumber;
      patient.phoneNumber = phoneNumber !== undefined ? cleanPhoneNumber : patient.phoneNumber;
      patient.relationship = null;
    } else {
      patient.phoneNumber = phoneNumber !== undefined ? cleanPhoneNumber : patient.phoneNumber;
      patient.empNumber = null;
      patient.relationship = null;
    }

    await patient.save();

    res.json({ success: true, message: 'Patient updated successfully.', patient });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error updating patient.' });
  }
});

// GET /api/patients/:id — Single patient with their report
router.get('/:id', protect, async (req, res) => {
  try {
    const patient = await Patient.findByPk(req.params.id, {
      include: [{
        model: User,
        as: 'registeredByUser',
        attributes: ['name'],
        foreignKey: 'registeredBy',
      }],
    });

    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' });

    const reports = await TestReport.findAll({
      where: { patientId: patient.id },
      include: [{
        model: User,
        as: 'reportedByUser',
        attributes: ['name', 'role'],
        foreignKey: 'reportedBy',
      }],
    });
    const report = reports.length > 0 ? reports[0] : null;

    res.json({ success: true, patient, report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// DELETE /api/patients/:id — Super Admin only
router.delete('/:id', protect, restrictTo('super_admin'), async (req, res) => {
  try {
    const patientId = req.params.id;
    const patient = await Patient.findByPk(patientId);
    if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });

    // Clean up IPD traces: Free up beds and delete admissions
    try {
      await sequelize.query(`
        UPDATE HMS_BEDS 
        SET STATUS = 'Available'
        WHERE ID IN (
          SELECT BED_ID FROM HMS_ADMISSIONS WHERE PATIENT_ID = :pid AND BED_ID IS NOT NULL
        )
      `, { replacements: { pid: patientId } });

      await sequelize.query(`
        DELETE FROM HMS_ADMISSIONS WHERE PATIENT_ID = :pid
      `, { replacements: { pid: patientId } });

      await sequelize.query(`
        DELETE FROM HMS_IPD_REQUESTS WHERE PATIENT_ID = :pid
      `, { replacements: { pid: patientId } });
    } catch (cleanupErr) {
      console.warn('Warning: Failed to clean up related IPD admissions:', cleanupErr.message);
    }

    // We physically delete the record since this is for cleaning up test data
    await patient.destroy();

    // Log the deletion to audit logs
    await logAction(req.user.id, 'DELETE', 'patient', req.params.id, null, patient.toJSON(), req.ip);

    res.json({ success: true, message: 'Patient record successfully deleted.' });
  } catch (err) {
    console.error('Patient Delete Error:', err);
    res.status(500).json({ success: false, message: 'Server error during deletion.' });
  }
});

module.exports = router;
