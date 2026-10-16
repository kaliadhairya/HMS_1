const express = require('express');
const { openOccupancy, closeOccupancy } = require('../utils/adt');
const { QueryTypes } = require('sequelize');
const router = express.Router();
const { sequelize, Ward, Bed, Admission, Patient, User, ProgressNote, NursingNote, IpdVitals, IpdRequest } = require('../models');
const { publish } = require('../utils/outbox');
const { protect, checkPermission } = require('../middleware/auth');
const logAction = require('../utils/auditLogger');
const { clobToString } = require('../utils/clobToString');

function normalizeRowKeys(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  for (const [k, v] of Object.entries(row)) {
    out[k.toUpperCase()] = v;
    out[k.toLowerCase()] = v;
  }
  return out;
}

// ── GET /api/ipd/wards ─────────────────────────────────────
router.get('/wards', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';
    const where = isAdmin ? {} : { IS_ACTIVE: 1 };
    const [wards] = await sequelize.query(`
      SELECT ID as "id", ID as "ID", NAME as "NAME", TYPE as "TYPE", FLOOR as "FLOOR", TOTAL_BEDS as "TOTAL_BEDS", IS_ACTIVE as "IS_ACTIVE"
      FROM HMS_WARDS ${!isAdmin ? 'WHERE IS_ACTIVE = 1' : ''}
      ORDER BY ID ASC
    `);
    res.json({ success: true, data: wards });
  } catch (err) {
    console.error('Wards fetch error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch wards' });
  }
});

// ── GET /api/ipd/beds ──────────────────────────────────────
router.get('/beds', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const { ward_id } = req.query;
    const isAdmin = req.user.role === 'admin' || req.user.role === 'super_admin';

    let sql = `
      SELECT b.ID as "ID", b.WARD_ID as "WARD_ID", b.ROOM_NUMBER as "ROOM_NUMBER", b.BED_NUMBER as "BED_NUMBER",
             COALESCE(b.STATUS, 'Available') as "STATUS", b.IS_ACTIVE as "IS_ACTIVE",
             a.ID as "ADMISSION_ID", a.ADMISSION_DATE as "ADMISSION_DATE", p.NAME as "PATIENT_NAME"
      FROM HMS_BEDS b
      LEFT JOIN HMS_ADMISSIONS a ON a.BED_ID = b.ID AND a.STATUS = 'Active'
      LEFT JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      WHERE 1=1
    `;
    const replacements = {};
    if (ward_id) {
      sql += ` AND b.WARD_ID = :ward_id`;
      replacements.ward_id = Number(ward_id);
    }
    if (!isAdmin) {
      sql += ` AND b.IS_ACTIVE = 1`;
    }
    sql += ` ORDER BY b.BED_NUMBER ASC`;

    const [beds] = await sequelize.query(sql, { replacements });
    res.json({ success: true, data: beds });
  } catch (err) {
    console.error('Beds fetch error:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch beds' });
  }
});

// ── GET /api/ipd/beds/available ────────────────────────────
router.get('/beds/available', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const { ward_id } = req.query;
    let sql = `
      SELECT b.ID as "ID", b.WARD_ID as "WARD_ID", b.ROOM_NUMBER as "ROOM_NUMBER", b.BED_NUMBER as "BED_NUMBER",
             'Available' as "STATUS", b.IS_ACTIVE as "IS_ACTIVE"
      FROM HMS_BEDS b
      WHERE b.IS_ACTIVE = 1 
        AND b.ID NOT IN (SELECT BED_ID FROM HMS_ADMISSIONS WHERE STATUS = 'Active' AND BED_ID IS NOT NULL)
    `;
    const replacements = {};
    if (ward_id) {
      sql += ` AND b.WARD_ID = :ward_id`;
      replacements.ward_id = Number(ward_id);
    }
    sql += ` ORDER BY b.BED_NUMBER ASC`;

    const [beds] = await sequelize.query(sql, { replacements });
    res.json({ success: true, data: beds });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch available beds' });
  }
});

// ── ADMIN WARD/BED MANAGEMENT ──────────────────────────────

router.patch('/wards/:id/toggle', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const wardId = Number(req.params.id);
    await sequelize.query(`UPDATE HMS_WARDS SET IS_ACTIVE = CASE WHEN IS_ACTIVE = 1 THEN 0 ELSE 1 END WHERE ID = :wardId`, { replacements: { wardId } });
    const [[ward]] = await sequelize.query(`SELECT * FROM HMS_WARDS WHERE ID = :wardId`, { replacements: { wardId } });
    res.json({ success: true, data: ward, message: `Ward updated successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.patch('/beds/:id/toggle', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const bedId = Number(req.params.id);
    await sequelize.query(`UPDATE HMS_BEDS SET IS_ACTIVE = CASE WHEN IS_ACTIVE = 1 THEN 0 ELSE 1 END WHERE ID = :bedId`, { replacements: { bedId } });
    const [[bed]] = await sequelize.query(`SELECT * FROM HMS_BEDS WHERE ID = :bedId`, { replacements: { bedId } });
    res.json({ success: true, data: bed, message: `Bed updated successfully` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/wards', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const { name, type, floor, totalBeds } = req.body;
    const [[seqRow]] = await sequelize.query(`SELECT nextval('hms_wards_seq') AS "ID"`);
    const newId = seqRow.ID || seqRow.id;
    await sequelize.query(`
      INSERT INTO HMS_WARDS (ID, NAME, TYPE, FLOOR, TOTAL_BEDS, IS_ACTIVE, CREATED_AT)
      VALUES (:newId, :name, :type, :floor, :totalBeds, 1, CURRENT_TIMESTAMP)
    `, { replacements: { newId, name, type, floor, totalBeds: totalBeds || 0 } });
    res.json({ success: true, data: { ID: newId, NAME: name, TYPE: type, FLOOR: floor, TOTAL_BEDS: totalBeds || 0, IS_ACTIVE: 1 } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post('/beds', protect, checkPermission('admin', 'write'), async (req, res) => {
  try {
    const { wardId, roomNumber, bedPrefix, count } = req.body;
    const newBeds = [];
    for (let i = 1; i <= count; i++) {
      const [[seqRow]] = await sequelize.query(`SELECT nextval('hms_beds_seq') AS "ID"`);
      const bedId = seqRow.ID || seqRow.id;
      const bedNum = `${bedPrefix}-${String(i).padStart(2, '0')}`;
      await sequelize.query(`
        INSERT INTO HMS_BEDS (ID, WARD_ID, ROOM_NUMBER, BED_NUMBER, STATUS, IS_ACTIVE)
        VALUES (:bedId, :wardId, :roomNumber, :bedNum, 'Available', 1)
      `, { replacements: { bedId, wardId: Number(wardId), roomNumber, bedNum } });
      newBeds.push({ ID: bedId, WARD_ID: Number(wardId), ROOM_NUMBER: roomNumber, BED_NUMBER: bedNum, STATUS: 'Available', IS_ACTIVE: 1 });
    }
    await sequelize.query(`UPDATE HMS_WARDS SET TOTAL_BEDS = TOTAL_BEDS + :count WHERE ID = :wardId`, { replacements: { count, wardId: Number(wardId) } });
    res.json({ success: true, data: newBeds });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Shared helpers for the inpatient workflow ──────────────
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const isAdminRole = (user) => ['admin', 'super_admin'].includes(user?.role);
const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

// Next primary key for an IPD table. Some tables were seeded with explicit ids, which left their
// sequence behind the data (HMS_IPD_VITALS: every insert failed with a duplicate key). When that
// happens the sequence is moved past the highest id instead of failing the insert.
async function nextId(seq, table, transaction) {
  const [[row]] = await sequelize.query(
    `SELECT nextval('${seq}') AS "SEQ", (SELECT COALESCE(MAX(ID), 0) FROM ${table}) AS "MAX_ID"`,
    { transaction },
  );
  const seqVal = Number(row.SEQ ?? row.seq);
  const maxId = Number(row.MAX_ID ?? row.max_id);
  if (seqVal > maxId) return seqVal;
  const [[fixed]] = await sequelize.query(`SELECT setval('${seq}', :next) AS "ID"`, { replacements: { next: maxId + 1 }, transaction });
  return Number(fixed.ID ?? fixed.id);
}

// Admission row (raw, both key cases), optionally locked for the rest of the transaction.
async function findAdmission(id, transaction, lock = false) {
  if (!posInt(id)) return null;
  const [rows] = await sequelize.query(
    `SELECT * FROM HMS_ADMISSIONS WHERE ID = :id${lock ? ' FOR UPDATE' : ''}`,
    { replacements: { id: Number(id) }, transaction },
  );
  return rows[0] || null;
}

// Days charged / shown for a stay: completed days, at least one, counted up to discharge (not to today).
const STAY_DAYS_SQL = `EXTRACT(DAY FROM (COALESCE(a.DISCHARGE_DATE, CURRENT_TIMESTAMP::timestamp) - a.ADMISSION_DATE))`;

const URGENCY_LEVELS = ['Routine', 'Urgent', 'Emergency'];
const DURATION_DAYS = { Days: 1, Weeks: 7, Months: 30 };

// ── POST /api/ipd/admissions ───────────────────────────────
// Admits a patient into a bed. The bed, the patient and the admission request are locked so two desks
// cannot fill the same bed or admit the same patient twice; the request is marked Admitted in the same
// transaction (it used to be a second call from the browser that could fail and leave it Pending).
router.post('/admissions', protect, checkPermission('ipd', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  const abort = async (status, message) => { await t.rollback(); return fail(res, status, message); };
  try {
    const { admittingDoctorId, department, admissionType, expectedDischargeDate } = req.body;
    const patientId = posInt(req.body.patientId);
    const bedId = posInt(req.body.bedId);
    if (!patientId) return abort(400, 'Select a patient.');
    if (!bedId) return abort(400, 'Select a bed.');

    const [[patient]] = await sequelize.query(
      'SELECT ID, NAME, UHID, GENDER, AGE FROM HMS_PATIENTS WHERE ID = :patientId FOR UPDATE',
      { replacements: { patientId }, transaction: t },
    );
    if (!patient) return abort(404, 'Patient not found.');

    const [[current]] = await sequelize.query(
      "SELECT ADMISSION_ID_FORMATTED FROM HMS_ADMISSIONS WHERE PATIENT_ID = :patientId AND STATUS = 'Active' LIMIT 1",
      { replacements: { patientId }, transaction: t },
    );
    if (current) return abort(409, `${patient.NAME} is already admitted (${current.ADMISSION_ID_FORMATTED}).`);

    const [[bed]] = await sequelize.query(
      'SELECT ID, BED_NUMBER, STATUS, IS_ACTIVE FROM HMS_BEDS WHERE ID = :bedId FOR UPDATE',
      { replacements: { bedId }, transaction: t },
    );
    if (!bed) return abort(404, 'Bed not found.');
    const [[inBed]] = await sequelize.query(
      "SELECT ID FROM HMS_ADMISSIONS WHERE BED_ID = :bedId AND STATUS = 'Active' LIMIT 1",
      { replacements: { bedId }, transaction: t },
    );
    const bedStatus = bed.STATUS || 'Available';
    if (Number(bed.IS_ACTIVE) !== 1 || bedStatus !== 'Available' || inBed) {
      return abort(409, `Bed ${bed.BED_NUMBER} is not available (${inBed ? 'Occupied' : Number(bed.IS_ACTIVE) !== 1 ? 'inactive' : bedStatus}).`);
    }

    // The admission request being fulfilled: the one given, else the patient's pending request.
    let request = null;
    if (req.body.requestId !== undefined && req.body.requestId !== null && req.body.requestId !== '') {
      const [[r]] = await sequelize.query(
        'SELECT * FROM HMS_IPD_REQUESTS WHERE ID = :id FOR UPDATE',
        { replacements: { id: posInt(req.body.requestId) || 0 }, transaction: t },
      );
      if (!r) return abort(404, 'Admission request not found.');
      if (Number(r.PATIENT_ID) !== patientId) return abort(400, 'The admission request is for another patient.');
      if (r.STATUS !== 'Pending') return abort(409, `This admission request is already ${String(r.STATUS).toLowerCase()}.`);
      request = r;
    } else {
      const [[r]] = await sequelize.query(
        "SELECT * FROM HMS_IPD_REQUESTS WHERE PATIENT_ID = :patientId AND STATUS = 'Pending' ORDER BY REQUEST_DATE DESC LIMIT 1 FOR UPDATE",
        { replacements: { patientId }, transaction: t },
      );
      request = r || null;
    }

    // Admitting doctor: as chosen, else the requesting doctor, else the user admitting.
    const doctorId = posInt(admittingDoctorId) || (request && posInt(request.DOCTOR_ID)) || req.user.id;
    const [[doctor]] = await sequelize.query(
      `SELECT u.ID, u.NAME, dp.NAME AS DEPARTMENT_NAME, d.SPECIALITY
       FROM HMS_USERS u
       LEFT JOIN HMS_DOCTORS d ON d.USER_ID = u.ID
       LEFT JOIN HMS_DEPARTMENTS dp ON dp.ID = d.DEPARTMENT_ID
       WHERE u.ID = :doctorId`,
      { replacements: { doctorId }, transaction: t },
    );
    if (!doctor) return abort(400, 'Admitting doctor not found.');
    // The department is the admitting doctor's (the requests page used to send the diagnosis here).
    const dept = text(department) || doctor.DEPARTMENT_NAME || doctor.SPECIALITY || 'General';
    const admType = text(admissionType) || (request && request.URGENCY_LEVEL) || 'Routine';

    let expected = null;
    if (expectedDischargeDate) {
      const d = new Date(expectedDischargeDate);
      if (Number.isNaN(d.getTime())) return abort(400, 'Expected discharge date is not a valid date.');
      expected = d;
    } else if (request && posInt(request.ESTIMATED_DURATION)) {
      expected = new Date(Date.now() + Number(request.ESTIMATED_DURATION) * (DURATION_DAYS[request.DURATION_UNIT] || 1) * 86400000);
    }

    const admissionId = await nextId('hms_admissions_seq', 'HMS_ADMISSIONS', t);
    const formattedId = `ADM-${new Date().getFullYear()}-${String(admissionId).padStart(6, '0')}`;

    await sequelize.query(`
      INSERT INTO HMS_ADMISSIONS (
        ID, PATIENT_ID, ADMITTING_DOCTOR_ID, DEPARTMENT, BED_ID, ADMISSION_TYPE, ADMISSION_DATE,
        EXPECTED_DISCHARGE_DATE, STATUS, ADMISSION_ID_FORMATTED, CREATED_BY, CREATED_AT
      ) VALUES (
        :id, :patientId, :doctorId, :department, :bedId, :admType, CURRENT_TIMESTAMP,
        :expected, 'Active', :formatted, :createdBy, CURRENT_TIMESTAMP
      )
    `, {
      replacements: {
        id: admissionId, patientId, doctorId, department: dept, bedId, admType,
        expected, formatted: formattedId, createdBy: req.user.id,
      },
      transaction: t,
    });
    await sequelize.query("UPDATE HMS_BEDS SET STATUS = 'Occupied' WHERE ID = :bedId", { replacements: { bedId }, transaction: t });
    // The bed's occupancy history starts with the admission (migration 0017).
    await openOccupancy(sequelize, { bedId, admissionId, userId: req.user.id, reason: 'admission', transaction: t });
    if (request) {
      await sequelize.query(
        "UPDATE HMS_IPD_REQUESTS SET STATUS = 'Admitted', ADMISSION_ID = :admissionId, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = :id",
        { replacements: { admissionId, id: request.ID }, transaction: t },
      );
    }
    await t.commit();
    await logAction(req.user.id, 'CREATE', 'ipd', admissionId, null, { action: 'admit_patient', bedId, requestId: request?.ID || null }, req.ip);

    const data = {
      id: admissionId, ID: admissionId,
      PATIENT_ID: patientId,
      ADMITTING_DOCTOR_ID: doctorId,
      BED_ID: bedId,
      BED_NUMBER: bed.BED_NUMBER,
      DEPARTMENT: dept,
      ADMISSION_TYPE: admType,
      ADMISSION_ID_FORMATTED: formattedId,
      admissionIdFormatted: formattedId,
      ADMISSION_DATE: new Date().toISOString(),
      EXPECTED_DISCHARGE_DATE: expected ? expected.toISOString() : null,
      STATUS: 'Active',
      REQUEST_ID: request ? Number(request.ID) : null,
      PATIENT_NAME: patient.NAME,
      UHID: patient.UHID,
      GENDER: patient.GENDER || '',
      AGE: patient.AGE || '',
      DOCTOR_NAME: doctor.NAME,
      DAYS_ADMITTED: 0,
    };
    return res.status(201).json({ success: true, data });
  } catch (err) {
    await t.rollback().catch(() => {});
    console.error('Admission failed:', err.message);
    return fail(res, 500, 'Failed to admit patient');
  }
});

// ── GET /api/ipd/admissions ────────────────────────────────
// ?status=Active|Discharged filters by status. ?billing=1 lists what IPD billing works on: admissions still
// in hospital plus discharged ones that have no IPD bill yet (they used to vanish from billing at discharge).
router.get('/admissions', protect, checkPermission('ipd', 'read'), async (req, res) => {
  const { status, billing } = req.query;
  try {
    let query = `
      SELECT a.*, p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             b.ROOM_NUMBER, b.BED_NUMBER, w.NAME as WARD_NAME,
             u.NAME as DOCTOR_NAME,
             ${STAY_DAYS_SQL} as DAYS_ADMITTED,
             r.REASON_FOR_ADMISSION, r.PRIMARY_DIAGNOSIS,
             bill.BILL_NUMBER
      FROM HMS_ADMISSIONS a
      LEFT JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      LEFT JOIN HMS_USERS u ON u.ID = a.ADMITTING_DOCTOR_ID
      LEFT JOIN HMS_IPD_REQUESTS r ON r.ADMISSION_ID = a.ID
      LEFT JOIN LATERAL (
        SELECT BILL_NUMBER FROM HMS_BILLS
        WHERE ADMISSION_ID = a.ID AND BILL_TYPE = 'IPD' AND COALESCE(STATUS, '') <> 'Cancelled'
        ORDER BY ID DESC LIMIT 1
      ) bill ON TRUE
    `;
    const replacements = {};
    if (billing) {
      query += ` WHERE a.STATUS = 'Active' OR (a.STATUS = 'Discharged' AND bill.BILL_NUMBER IS NULL)`;
    } else if (status) {
      query += ` WHERE a.STATUS = :status`;
      replacements.status = status;
    }
    query += ` ORDER BY a.ADMISSION_DATE DESC`;

    const [adms] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: (adms || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error('DB admissions fetch failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch admissions' });
  }
});

// ── GET /api/ipd/requests ────────────────────────────────
router.get('/requests', protect, checkPermission('ipd', 'read'), async (req, res) => {
  const { status } = req.query;
  try {
    let query = `
      SELECT r.*, p.NAME as PATIENT_NAME, p.UHID,
             u.NAME as DOCTOR_NAME
      FROM HMS_IPD_REQUESTS r
      LEFT JOIN HMS_PATIENTS p ON p.ID = r.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = r.DOCTOR_ID
    `;
    const replacements = {};
    if (status) {
      query += ` WHERE r.STATUS = :status`;
      replacements.status = status;
    }
    query += ` ORDER BY r.REQUEST_DATE DESC`;

    const [reqs] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: (reqs || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error('DB request fetch failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch IPD requests' });
  }
});

// ── POST /api/ipd/requests ────────────────────────────────
// A doctor asks for a patient to be admitted. Required fields are checked here as well as in the form
// (a request without a patient used to be stored), and a patient cannot have two open requests or a
// request while already admitted.
router.post('/requests', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const { icd10Code, durationUnit, specialRequirements, initialOrders } = req.body;
    const patientId = posInt(req.body.patientId);
    const reasonForAdmission = text(req.body.reasonForAdmission);
    const primaryDiagnosis = text(req.body.primaryDiagnosis);
    const wardPreference = text(req.body.wardPreference);
    const urgencyLevel = text(req.body.urgencyLevel);
    if (!patientId) return fail(res, 400, 'Select a patient.');
    if (!reasonForAdmission || !primaryDiagnosis || !wardPreference || !urgencyLevel) {
      return fail(res, 400, 'Reason for admission, primary diagnosis, ward preference and urgency are required.');
    }
    if (!URGENCY_LEVELS.includes(urgencyLevel)) return fail(res, 400, `Urgency must be one of ${URGENCY_LEVELS.join(', ')}.`);
    let estimatedDuration = null;
    if (req.body.estimatedDuration !== undefined && req.body.estimatedDuration !== null && req.body.estimatedDuration !== '') {
      estimatedDuration = posInt(req.body.estimatedDuration);
      if (!estimatedDuration || estimatedDuration > 365) return fail(res, 400, 'Estimated duration must be a whole number between 1 and 365.');
    }
    const unit = durationUnit && DURATION_DAYS[durationUnit] ? durationUnit : 'Days';

    const patient = await Patient.findByPk(patientId);
    if (!patient) return fail(res, 404, 'Patient not found.');
    const [[admitted]] = await sequelize.query(
      "SELECT ADMISSION_ID_FORMATTED FROM HMS_ADMISSIONS WHERE PATIENT_ID = :patientId AND STATUS = 'Active' LIMIT 1",
      { replacements: { patientId } },
    );
    if (admitted) return fail(res, 409, `This patient is already admitted (${admitted.ADMISSION_ID_FORMATTED}).`);
    const [[open]] = await sequelize.query(
      "SELECT ID FROM HMS_IPD_REQUESTS WHERE PATIENT_ID = :patientId AND STATUS = 'Pending' LIMIT 1",
      { replacements: { patientId } },
    );
    if (open) return fail(res, 409, 'This patient already has a pending admission request.');

    const newId = await nextId('hms_ipd_req_seq', 'HMS_IPD_REQUESTS');
    const reqs = Array.isArray(specialRequirements) ? specialRequirements.map(text).filter(Boolean) : [];

    const requestData = {
      id: newId, ID: newId,
      PATIENT_ID: patientId,
      DOCTOR_ID: req.user.id,
      PATIENT_NAME: patient.name,
      UHID: patient.uhid,
      DOCTOR_NAME: req.user.name || 'Current Doctor',
      REASON_FOR_ADMISSION: reasonForAdmission,
      PRIMARY_DIAGNOSIS: primaryDiagnosis,
      ICD10_CODE: text(icd10Code) || null,
      WARD_PREFERENCE: wardPreference,
      URGENCY_LEVEL: urgencyLevel,
      ESTIMATED_DURATION: estimatedDuration,
      DURATION_UNIT: unit,
      SPECIAL_REQUIREMENTS: JSON.stringify(reqs),
      INITIAL_ORDERS: text(initialOrders) || null,
      STATUS: 'Pending',
      REQUEST_DATE: new Date().toISOString(),
    };

    // The request and the nurses' notification commit together.
    await sequelize.transaction(async (transaction) => {
      await sequelize.query(`
        INSERT INTO HMS_IPD_REQUESTS (
          ID, PATIENT_ID, DOCTOR_ID, REASON_FOR_ADMISSION, PRIMARY_DIAGNOSIS,
          ICD10_CODE, WARD_PREFERENCE, URGENCY_LEVEL, ESTIMATED_DURATION,
          DURATION_UNIT, SPECIAL_REQUIREMENTS, INITIAL_ORDERS, STATUS, REQUEST_DATE,
          CREATED_AT, UPDATED_AT
        ) VALUES (
          :id, :patientId, :doctorId, :reason, :diagnosis,
          :icd10, :ward, :urgency, :estDuration,
          :durUnit, :specialReq, :orders, 'Pending', CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: newId,
          patientId,
          doctorId: req.user.id,
          reason: reasonForAdmission,
          diagnosis: primaryDiagnosis,
          icd10: text(icd10Code) || null,
          ward: wardPreference,
          urgency: urgencyLevel,
          estDuration: estimatedDuration,
          durUnit: unit,
          specialReq: JSON.stringify(reqs),
          orders: text(initialOrders) || null,
        },
        transaction,
      });
      // Nurses' screens re-read the request through the API (completion A8).
      await publish('new_ipd_request', 'nurse', { request_id: newId, patient_id: patientId, urgency: urgencyLevel || null },
        { transaction, aggregate: { type: 'ipd.request', id: newId } });
    });

    return res.status(201).json({ success: true, data: requestData });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to create IPD request');
  }
});

// ── PATCH /api/ipd/requests/:id/status ───────────────────────
router.patch('/requests/:id/status', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const { status, admissionId } = req.body;
    if (!['Pending', 'Admitted', 'Cancelled'].includes(status)) return fail(res, 400, 'Status must be Pending, Admitted or Cancelled.');
    const [, meta] = await sequelize.query(`
      UPDATE HMS_IPD_REQUESTS SET STATUS = :status, ADMISSION_ID = :admissionId, UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ID = :id
    `, { replacements: { status, admissionId: admissionId || null, id: posInt(req.params.id) || 0 } });
    if (!meta?.rowCount) return fail(res, 404, 'Admission request not found.');
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to update request');
  }
});

// ── DELETE /api/ipd/requests/:id ───────────────────────────
router.delete('/requests/:id', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const reqId = req.params.id;
    await sequelize.query(`DELETE FROM HMS_IPD_REQUESTS WHERE ID = :id`, {
      replacements: { id: reqId }
    });
    return res.json({ success: true, message: 'IPD request deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to delete request' });
  }
});

// ── POST /api/ipd/requests/bulk-delete ─────────────────────
router.post('/requests/bulk-delete', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: 'No IDs provided' });
    }

    let deletedCount = 0;
    for (const id of ids) {
      try {
        await sequelize.query(`DELETE FROM HMS_IPD_REQUESTS WHERE ID = :id`, {
          replacements: { id }
        });
        deletedCount++;
      } catch (e) {
        console.warn(`Failed to delete request ${id}:`, e.message);
      }
    }

    return res.json({ success: true, message: `Deleted ${deletedCount} request(s)`, deletedCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to bulk delete requests' });
  }
});


// ── GET /api/ipd/admissions/:id ────────────────────────────
router.get('/admissions/:id', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const admissionId = posInt(req.params.id);
    if (!admissionId) return fail(res, 404, 'Admission record not found');
    const [adms] = await sequelize.query(`
      SELECT a.*, p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             p.DOB, p.BLOOD_GROUP, p.PHONENUMBER as CONTACT_NUMBER,
             p.HOUSE_NO, p.STREET, p.CITY, p.STATE, p.PIN,
             p.EMERGENCY_CONTACT_NAME, p.EMERGENCY_CONTACT_RELATION,
             b.ROOM_NUMBER, b.BED_NUMBER, w.NAME as WARD_NAME, w.TYPE as WARD_TYPE,
             u.NAME as DOCTOR_NAME,
             ${STAY_DAYS_SQL} as DAYS_ADMITTED,
             r.REASON_FOR_ADMISSION, r.PRIMARY_DIAGNOSIS, r.PRIMARY_DIAGNOSIS as DIAGNOSIS, r.SPECIAL_REQUIREMENTS
      FROM HMS_ADMISSIONS a
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      LEFT JOIN HMS_USERS u ON u.ID = a.ADMITTING_DOCTOR_ID
      LEFT JOIN HMS_IPD_REQUESTS r ON r.ADMISSION_ID = a.ID
      WHERE a.ID = :admissionId
    `, { replacements: { admissionId } });

    if (adms.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission record not found' });
    }

    res.json({ success: true, data: normalizeRowKeys(adms[0]) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch admission' });
  }
});

// ── PATCH /api/ipd/admissions/:id/discharge ────────────────
// Discharges the patient, frees the bed and stores the discharge summary in one transaction. A failed
// summary insert used to be swallowed inside the transaction (Postgres then rolls the whole thing back
// while the API still answered "discharged").
router.patch('/admissions/:id/discharge', protect, checkPermission('ipd', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  const abort = async (status, message) => { await t.rollback(); return fail(res, status, message); };
  try {
    const { courseInHospital, conditionAtDischarge, adviceOnDischarge,
            chiefComplaint, comorbidities, allergies, historyOfIllness,
            investigations, dischargeMedications, dietLifestyle, warningSigns,
            followUpAppointments } = req.body;
    const finalDiagnosis = text(req.body.finalDiagnosis);
    const admission = await findAdmission(req.params.id, t, true);
    if (!admission) return abort(404, 'Admission record not found');
    if (admission.STATUS !== 'Active') return abort(409, `This admission is already ${String(admission.STATUS).toLowerCase()}.`);
    if (!finalDiagnosis) return abort(400, 'Final diagnosis is required to discharge.');
    // A discharge plan, once started, must be clinically ready (migration 0017).
    const [plan] = await sequelize.query('SELECT clinical_ready_at FROM hms_discharge_plans WHERE admission_id = :admissionId', { replacements: { admissionId: admission.ID }, type: QueryTypes.SELECT, transaction: t });
    if (plan && !plan.clinical_ready_at) return abort(409, 'The discharge plan is not clinically ready yet.');

    const [[updated]] = await sequelize.query(`
      UPDATE HMS_ADMISSIONS SET DISCHARGE_DATE = CURRENT_TIMESTAMP, STATUS = 'Discharged'
      WHERE ID = :admissionId
      RETURNING DISCHARGE_DATE AS "DISCHARGE_DATE"
    `, { replacements: { admissionId: admission.ID }, transaction: t });
    // The bed goes to cleaning, not straight back to Ready (blueprint 4.1).
    await closeOccupancy(sequelize, { admissionId: admission.ID, reason: 'discharged', transaction: t });
    if (admission.BED_ID) {
      await sequelize.query("UPDATE HMS_BEDS SET STATUS = 'Dirty' WHERE ID = :bedId", { replacements: { bedId: admission.BED_ID }, transaction: t });
    }

    const summaryId = await nextId('hms_discharge_seq', 'HMS_DISCHARGE_SUMMARIES', t);
    await sequelize.query(`
      INSERT INTO HMS_DISCHARGE_SUMMARIES (
        ID, ADMISSION_ID, FINAL_DIAGNOSIS, COURSE_IN_HOSPITAL,
        DISCHARGE_CONDITION, ADVICE_ON_DISCHARGE,
        CHIEF_COMPLAINT, COMORBIDITIES, ALLERGIES, HISTORY_OF_ILLNESS,
        INVESTIGATIONS, DISCHARGE_MEDICATIONS, DIET_LIFESTYLE,
        WARNING_SIGNS, FOLLOW_UP_APPOINTMENTS,
        CREATED_BY, CREATED_AT
      ) VALUES (
        :id, :admId, :fd, :cih, :dc, :aod,
        :cc, :como, :allg, :hoi,
        :inv, :dm, :dl,
        :ws, :fua,
        :createdBy, CURRENT_TIMESTAMP
      )
    `, {
      replacements: {
        id: summaryId,
        admId: admission.ID,
        fd: finalDiagnosis,
        cih: courseInHospital || null,
        dc: conditionAtDischarge || null,
        aod: adviceOnDischarge || null,
        cc: chiefComplaint || null,
        como: comorbidities || null,
        allg: allergies || null,
        hoi: historyOfIllness || null,
        inv: investigations || null,
        dm: dischargeMedications || null,
        dl: dietLifestyle || null,
        ws: warningSigns || null,
        fua: followUpAppointments || null,
        createdBy: req.user.id,
      },
      transaction: t,
    });

    await t.commit();
    await logAction(req.user.id, 'UPDATE', 'ipd', admission.ID, null, { action: 'discharge_patient', summaryId }, req.ip);

    return res.json({ success: true, message: 'Patient discharged successfully', data: { summaryId, dischargeDate: updated?.DISCHARGE_DATE || new Date() } });
  } catch (err) {
    await t.rollback().catch(() => {});
    console.error(err);
    return fail(res, 500, 'Failed to discharge patient');
  }
});

// ── GET /api/ipd/discharge-summaries ──────────
router.get('/discharge-summaries', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [summaries] = await sequelize.query(`
      SELECT s.ID, s.ADMISSION_ID, s.FINAL_DIAGNOSIS, COALESCE(a.DISCHARGE_DATE, s.CREATED_AT) as DISCHARGE_DATE,
             a.ADMISSION_DATE, a.ADMISSION_ID_FORMATTED,
             p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             u.NAME as DOCTOR_NAME
      FROM HMS_DISCHARGE_SUMMARIES s
      JOIN HMS_ADMISSIONS a ON a.ID = s.ADMISSION_ID
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = s.CREATED_BY
      ORDER BY s.CREATED_AT DESC
    `);
    res.json({ success: true, data: (summaries || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch discharge summaries' });
  }
});

// ── GET /api/ipd/admissions/:id/discharge-summary ──────────
router.get('/admissions/:id/discharge-summary', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const admissionId = req.params.id;
    const [summaries] = await sequelize.query(`
      SELECT s.*, u.NAME as DOCTOR_NAME
      FROM HMS_DISCHARGE_SUMMARIES s
      LEFT JOIN HMS_USERS u ON s.CREATED_BY = u.ID
      WHERE s.ADMISSION_ID = :admissionId
      ORDER BY s.CREATED_AT DESC
    `, { replacements: { admissionId } });

    if (summaries.length === 0) {
      return res.status(404).json({ success: false, message: 'Summary not found' });
    }

    const summary = summaries[0];
    // Convert all CLOB fields
    const clobFields = ['COURSE_IN_HOSPITAL', 'ADVICE_ON_DISCHARGE', 'HISTORY_OF_ILLNESS',
                        'INVESTIGATIONS', 'DISCHARGE_MEDICATIONS', 'DIET_LIFESTYLE', 'FOLLOW_UP_APPOINTMENTS'];
    for (const field of clobFields) {
      if (summary[field]) summary[field] = await clobToString(summary[field]);
    }

    res.json({ success: true, data: normalizeRowKeys(summary) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch discharge summary' });
  }
});

// ── NOTES & VITALS ─────────────────────────────────────────
// Clinical entries go only on an admission that is still active, and the patient is taken from the
// admission rather than from the request body.
async function activeAdmissionOr(res, id) {
  const admission = await findAdmission(id);
  if (!admission) { fail(res, 404, 'Admission record not found'); return null; }
  if (admission.STATUS !== 'Active') { fail(res, 409, 'This patient has been discharged; the chart is read-only.'); return null; }
  return admission;
}

// Progress (SOAP) notes are written by doctors; nursing notes by nurses (admins may write either).
router.post('/progress-notes', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    if (!['doctor', 'admin', 'super_admin'].includes(req.user.role)) return fail(res, 403, 'Only doctors write progress notes.');
    const fields = ['subjective', 'objective', 'assessment', 'plan'];
    const note = Object.fromEntries(fields.map((f) => [f, text(req.body[f])]));
    if (fields.every((f) => !note[f])) return fail(res, 400, 'Write at least one part of the note.');
    const admission = await activeAdmissionOr(res, req.body.admissionId);
    if (!admission) return undefined;
    const saved = await ProgressNote.create({
      id: await nextId('hms_progress_seq', 'HMS_PROGRESS_NOTES'),
      admissionId: Number(admission.ID),
      patientId: Number(admission.PATIENT_ID),
      doctorId: req.user.id,
      noteDate: new Date(),
      ...Object.fromEntries(fields.map((f) => [f, note[f] || null])),
    });
    return res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('Failed to save progress note:', err);
    return fail(res, 500, 'Failed to save progress note');
  }
});

router.get('/progress-notes/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [notes] = await sequelize.query(`
      SELECT n.*, u.NAME as DOCTOR_NAME
      FROM HMS_PROGRESS_NOTES n
      LEFT JOIN HMS_USERS u ON u.ID = n.DOCTOR_ID
      WHERE n.ADMISSION_ID = :admissionId
      ORDER BY n.NOTE_DATE DESC
    `, { replacements: { admissionId: req.params.admissionId } });
    res.json({ success: true, data: (notes || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch progress notes' });
  }
});

router.post('/nursing-notes', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    if (!['nurse', 'admin', 'super_admin'].includes(req.user.role)) return fail(res, 403, 'Only nursing staff write nursing notes.');
    const conditionNotes = text(req.body.conditionNotes || req.body.noteText || req.body.note_text);
    const complaints = text(req.body.complaints);
    const actionsTaken = text(req.body.actionsTaken || req.body.actions_taken);
    if (!conditionNotes) return fail(res, 400, 'Condition summary is required.');
    const admission = await activeAdmissionOr(res, req.body.admissionId || req.body.admission_id);
    if (!admission) return undefined;

    const note = await NursingNote.create({
      id: await nextId('hms_nursing_seq', 'HMS_NURSING_NOTES'),
      admissionId: Number(admission.ID),
      nurseId: req.user.id,
      conditionNotes,
      complaints: complaints || null,
      actionsTaken: actionsTaken || null,
      noteDate: new Date(),
    });
    return res.status(201).json({ success: true, data: note });
  } catch (err) {
    console.error('Failed to save nursing note:', err);
    return fail(res, 500, 'Failed to save nursing note');
  }
});

router.get('/nursing-notes/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [notes] = await sequelize.query(`
      SELECT n.*, u.NAME as NURSE_NAME
      FROM HMS_NURSING_NOTES n
      LEFT JOIN HMS_USERS u ON u.ID = n.NURSE_ID
      WHERE n.ADMISSION_ID = :admissionId
      ORDER BY n.NOTE_DATE DESC
    `, { replacements: { admissionId: req.params.admissionId } });

    for (let note of notes) {
      if (note.CONDITION_NOTES) {
        note.CONDITION_NOTES = await clobToString(note.CONDITION_NOTES);
      }
      if (note.COMPLAINTS) {
        note.COMPLAINTS = await clobToString(note.COMPLAINTS);
      }
      if (note.ACTIONS_TAKEN) {
        note.ACTIONS_TAKEN = await clobToString(note.ACTIONS_TAKEN);
      }
      note.NOTE_TEXT = note.CONDITION_NOTES || '';
    }
    res.json({ success: true, data: (notes || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error('Failed to fetch nursing notes:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notes' });
  }
});

// Physiologically possible ranges (same idea as OPD vitals): values outside are typing or unit mistakes
// and are refused instead of stored. Temperature is charted in °F on the inpatient chart.
const IPD_VITAL_LIMITS = {
  bpSystolic: [40, 300, 'Systolic BP', true],
  bpDiastolic: [20, 200, 'Diastolic BP', true],
  pulse: [20, 250, 'Pulse', true],
  spo2: [40, 100, 'SpO2', true],
  respiratoryRate: [4, 80, 'Respiratory rate', true],
  painScore: [0, 10, 'Pain score', true],
  temperature: [86, 113, 'Temperature (°F)', false],
};
const FLUID_FIELDS = { intakeOralMl: 'Oral intake', intakeIvMl: 'IV intake', outputUrineMl: 'Urine output', outputDrainMl: 'Drain output' };
const SHIFTS = ['Morning', 'Afternoon', 'Night'];
const blank = (v) => v === undefined || v === null || v === '';

router.post('/vitals', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const values = {};
    for (const [key, [min, max, label, whole]] of Object.entries(IPD_VITAL_LIMITS)) {
      if (blank(req.body[key])) { values[key] = null; continue; }
      const n = Number(req.body[key]);
      if (!Number.isFinite(n)) return fail(res, 400, `${label} must be a number.`);
      if (whole && !Number.isInteger(n)) return fail(res, 400, `${label} must be a whole number.`);
      if (n < min || n > max) return fail(res, 400, `${label} must be between ${min} and ${max}.`);
      values[key] = n;
    }
    for (const [key, label] of Object.entries(FLUID_FIELDS)) {
      if (blank(req.body[key])) { values[key] = 0; continue; }
      const n = Number(req.body[key]);
      if (!Number.isInteger(n) || n < 0 || n > 10000) return fail(res, 400, `${label} must be a whole number of mL between 0 and 10000.`);
      values[key] = n;
    }
    const anyVital = Object.keys(IPD_VITAL_LIMITS).some((k) => values[k] !== null);
    const anyFluid = Object.keys(FLUID_FIELDS).some((k) => values[k] > 0);
    if (!anyVital && !anyFluid) return fail(res, 400, 'Enter at least one vital sign or fluid amount.');

    const admission = await activeAdmissionOr(res, req.body.admissionId);
    if (!admission) return undefined;

    const v = await IpdVitals.create({
      id: await nextId('hms_ipd_vitals_seq', 'HMS_IPD_VITALS'),
      admissionId: Number(admission.ID),
      patientId: Number(admission.PATIENT_ID),
      recordedBy: req.user.id,
      recordedAt: new Date(),
      shift: SHIFTS.includes(req.body.shift) ? req.body.shift : null,
      ...values,
    });
    return res.status(201).json({ success: true, data: v });
  } catch (err) {
    console.error(err);
    return fail(res, 500, 'Failed to save vitals');
  }
});

router.get('/vitals/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const v = await IpdVitals.findAll({
      where: { admissionId: req.params.admissionId },
      order: [['recordedAt', 'DESC']]
    });
    res.json({ success: true, data: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch vitals' });
  }
});

router.get('/vitals/patient/:patientId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const v = await IpdVitals.findAll({
      where: { patientId: req.params.patientId },
      order: [['recordedAt', 'DESC']]
    });
    res.json({ success: true, data: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch vitals' });
  }
});

// ── Medication administration record (MAR) ─────────────────
// Retired by Phase 3: doses are scheduled from signed, pharmacist-verified orders and
// recorded in eMAR (/api/medication/emar), with patient and product checks. The old
// free-text records stay readable below; writing new ones is refused.
const LEGACY_MAR_RETIRED = (req, res) => res.status(410).json({
  success: false,
  code: 'LEGACY_MAR_RETIRED',
  message: 'The old medication chart is read-only. Record doses in eMAR (Medications → Nursing).',
});
router.post('/mar', protect, checkPermission('ipd', 'write'), LEGACY_MAR_RETIRED);

// Today's doses plus earlier doses still pending: an overdue dose no longer drops off the chart at midnight.
router.get('/mar/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [mar] = await sequelize.query(`
      SELECT m.*, u.NAME AS ADMINISTERED_BY_NAME
      FROM HMS_MAR_RECORDS m
      LEFT JOIN HMS_USERS u ON u.ID = m.ADMINISTERED_BY
      WHERE m.ADMISSION_ID = :admissionId
        AND (hms_service_date(m.SCHEDULED_TIME) = hms_service_today()
             OR (m.STATUS = 'Pending' AND m.SCHEDULED_TIME < CURRENT_TIMESTAMP))
      ORDER BY m.SCHEDULED_TIME ASC, m.ID ASC
    `, { replacements: { admissionId: req.params.admissionId } });

    res.json({ success: true, data: (mar || []).map(normalizeRowKeys) });
  } catch (err) {
    console.error('Failed to fetch MAR:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch MAR' });
  }
});

router.patch('/mar/:id/status', protect, checkPermission('ipd', 'write'), LEGACY_MAR_RETIRED);

// ── IPD BILLING (retired in Phase 5) ───────────────────────
// Inpatient charges are recorded as they happen (bed days from the bed
// history, dispensed medicines, tests, items added on the billing page) on the
// admission's billing account, and billed through /api/finance. The old
// draft-and-generate endpoints answer 410 so no client builds a bill from a
// page draft again.
const IPD_BILLING_MOVED = (req, res) => res.status(410).json({
  success: false,
  code: 'IPD_BILLING_MOVED',
  message: 'Inpatient billing moved to the billing account (/api/finance/accounts/by-episode?admissionId=...).',
});
router.get('/admissions/:id/charges', protect, checkPermission('ipd', 'read'), IPD_BILLING_MOVED);
router.post('/admissions/:id/charges', protect, checkPermission('ipd', 'write'), IPD_BILLING_MOVED);
router.patch('/admissions/:id/charges/:chargeId', protect, checkPermission('ipd', 'write'), IPD_BILLING_MOVED);
router.delete('/admissions/:id/charges/:chargeId', protect, checkPermission('ipd', 'write'), IPD_BILLING_MOVED);
router.post('/admissions/:id/generate-bill', protect, checkPermission('ipd', 'write'), IPD_BILLING_MOVED);

// ── GET /api/ipd/billing/saved-drafts ───────────────────────
// Admissions with charges not billed yet (what the old "saved drafts" listed).
router.get('/billing/saved-drafts', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT a.*, p.NAME AS PATIENT_NAME, p.UHID, b.BED_NUMBER, w.NAME AS WARD_NAME, acc.id AS ACCOUNT_ID,
             count(c.id)::int AS ITEM_COUNT, COALESCE(sum(c.amount + c.gst_amount), 0) AS DRAFT_TOTAL
        FROM hms_billing_accounts acc
        JOIN hms_admissions a ON a.id = acc.admission_id
        JOIN hms_patients p ON p.id = a.patient_id
        LEFT JOIN hms_beds b ON b.id = a.bed_id
        LEFT JOIN hms_wards w ON w.id = b.ward_id
        JOIN hms_charge_events c ON c.account_id = acc.id
       WHERE c.source_type NOT IN ('reversal', 'ward_day')
         AND NOT EXISTS (SELECT 1 FROM hms_charge_events r WHERE r.reverses_id = c.id)
         AND NOT EXISTS (SELECT 1 FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
                          WHERE l.charge_event_id = c.id AND NOT l.released AND i.status <> 'Draft')
       GROUP BY a.id, p.NAME, p.UHID, b.BED_NUMBER, w.NAME, acc.id
       ORDER BY a.admission_date DESC`);
    res.json({ success: true, data: rows.map(normalizeRowKeys).map((r) => ({ ...r, draftTotal: Math.round(Number(r.DRAFT_TOTAL) * 100) / 100, itemCount: Number(r.ITEM_COUNT) })) });
  } catch (err) {
    console.error('Unbilled admissions failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not list unbilled admissions.' });
  }
});

module.exports = router;
