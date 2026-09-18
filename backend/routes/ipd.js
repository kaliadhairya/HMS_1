const express = require('express');
const router = express.Router();
const { sequelize, Ward, Bed, Admission, Patient, User, ProgressNote, NursingNote, IpdVitals, MarRecord, IpdRequest } = require('../models');
const { protect, checkPermission } = require('../middleware/auth');
const logAction = require('../utils/auditLogger');
const { clobToString } = require('../utils/clobToString');

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

// ── POST /api/ipd/admissions ───────────────────────────────
router.post('/admissions', protect, checkPermission('ipd', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { patientId, admittingDoctorId, department, bedId, admissionType, expectedDischargeDate, patientName, uhid } = req.body;

    // Check if bed is available
    const [[bedRow]] = await sequelize.query(`SELECT STATUS FROM HMS_BEDS WHERE ID = :bedId`, { replacements: { bedId: Number(bedId) }, transaction: t });
    if (bedRow && bedRow.status === 'Occupied') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Selected bed is not available.' });
    }

    // Lookup patient
    let patient = null;
    try { patient = await Patient.findByPk(patientId, { transaction: t }); } catch (e) { /* ignore */ }
    const pName = patient?.name || patientName || 'Unknown Patient';
    const pUhid = patient?.uhid || uhid || 'N/A';

    // Lookup doctor name
    let doctorName = 'Unknown Doctor';
    try {
      const doc = await User.findByPk(admittingDoctorId || req.user.id, { transaction: t });
      if (doc) doctorName = `Dr. ${doc.name || doc.first_name || ''}`.trim();
    } catch (e) { /* ignore */ }

    // Generate admission ID
    const [[seqRow]] = await sequelize.query(`SELECT nextval('hms_admissions_seq') AS "ID"`, { transaction: t });
    const admissionId = seqRow.ID || seqRow.id;
    const year = new Date().getFullYear();
    const formattedId = `ADM-${year}-${String(admissionId).padStart(6, '0')}`;

    // Mark bed as occupied in DB
    await sequelize.query(`UPDATE HMS_BEDS SET STATUS = 'Occupied' WHERE ID = :bedId`, {
      replacements: { bedId: Number(bedId) },
      transaction: t
    });

    // Persist admission to DB
    await sequelize.query(`
      INSERT INTO HMS_ADMISSIONS (
        ID, PATIENT_ID, ADMITTING_DOCTOR_ID, DEPARTMENT, BED_ID,
        ADMISSION_TYPE, ADMISSION_DATE, STATUS, ADMISSION_ID_FORMATTED, CREATED_BY, CREATED_AT
      ) VALUES (
        :id, :patientId, :doctorId, :department, :bedId,
        :admType, CURRENT_TIMESTAMP, 'Active', :formatted, :createdBy, CURRENT_TIMESTAMP
      )
    `, {
      replacements: {
        id: admissionId,
        patientId,
        doctorId: admittingDoctorId || req.user.id,
        department: department || 'General',
        bedId: Number(bedId),
        admType: admissionType || 'Routine',
        formatted: formattedId,
        createdBy: req.user.id,
      },
      transaction: t
    });

    await t.commit();

    const responseAdmission = {
      id: admissionId, ID: admissionId,
      PATIENT_ID: Number(patientId),
      ADMITTING_DOCTOR_ID: Number(admittingDoctorId) || req.user.id,
      BED_ID: Number(bedId),
      DEPARTMENT: department,
      ADMISSION_TYPE: admissionType,
      ADMISSION_ID_FORMATTED: formattedId,
      ADMISSION_DATE: new Date().toISOString(),
      STATUS: 'Active',
      PATIENT_NAME: pName,
      UHID: pUhid,
      GENDER: patient?.gender || '',
      AGE: patient?.age || '',
      DOCTOR_NAME: doctorName,
      DAYS_ADMITTED: 0,
    };

    console.log('✅ Admission saved to DB, ID:', admissionId);
    return res.json({ success: true, data: responseAdmission });

  } catch (err) {
    if (t) await t.rollback();
    console.error('❌ Admission failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to admit patient' });
  }
});

// ── GET /api/ipd/admissions ────────────────────────────────
router.get('/admissions', protect, checkPermission('ipd', 'read'), async (req, res) => {
  const { status } = req.query;

  try {
    let query = `
      SELECT a.*, p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             b.ROOM_NUMBER, b.BED_NUMBER, w.NAME as WARD_NAME,
             u.NAME as DOCTOR_NAME,
             EXTRACT(DAY FROM (CURRENT_TIMESTAMP - a.ADMISSION_DATE)) as DAYS_ADMITTED,
             r.REASON_FOR_ADMISSION, r.PRIMARY_DIAGNOSIS
      FROM HMS_ADMISSIONS a
      LEFT JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      LEFT JOIN HMS_USERS u ON u.ID = a.ADMITTING_DOCTOR_ID
      LEFT JOIN HMS_IPD_REQUESTS r ON r.ADMISSION_ID = a.ID
    `;
    const replacements = {};
    if (status) {
      query += ` WHERE a.STATUS = :status`;
      replacements.status = status;
    }
    query += ` ORDER BY a.ADMISSION_DATE DESC`;

    const [adms] = await sequelize.query(query, { replacements });
    res.json({ success: true, data: adms || [] });
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
    res.json({ success: true, data: reqs || [] });
  } catch (err) {
    console.error('DB request fetch failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch IPD requests' });
  }
});

// ── POST /api/ipd/requests ────────────────────────────────
router.post('/requests', protect, checkPermission('ipd', 'write'), async (req, res) => {
  console.log('📥 INCOMING IPD REQUEST from User ID:', req.user?.id);
  try {
    const { patientId, reasonForAdmission, primaryDiagnosis, icd10Code, wardPreference, urgencyLevel, estimatedDuration, durationUnit, specialRequirements, initialOrders } = req.body;
    
    // Fetch patient details
    const patient = await Patient.findByPk(patientId);
    
    const [[seqRow]] = await sequelize.query(`SELECT nextval('hms_ipd_req_seq') AS "ID"`);
    const newId = seqRow.ID || seqRow.id;
    
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
        reason: reasonForAdmission || null,
        diagnosis: primaryDiagnosis || null,
        icd10: icd10Code || null,
        ward: wardPreference || null,
        urgency: urgencyLevel || null,
        estDuration: estimatedDuration || null,
        durUnit: durationUnit || null,
        specialReq: JSON.stringify(specialRequirements || []),
        orders: initialOrders || null,
      }
    });

    const requestData = {
      id: newId, ID: newId,
      PATIENT_ID: patientId,
      DOCTOR_ID: req.user.id,
      PATIENT_NAME: patient ? patient.name : 'Unknown Patient',
      UHID: patient ? patient.uhid : 'UNKNOWN',
      DOCTOR_NAME: req.user.name || 'Current Doctor',
      REASON_FOR_ADMISSION: reasonForAdmission,
      PRIMARY_DIAGNOSIS: primaryDiagnosis,
      ICD10_CODE: icd10Code,
      WARD_PREFERENCE: wardPreference,
      URGENCY_LEVEL: urgencyLevel,
      ESTIMATED_DURATION: estimatedDuration,
      DURATION_UNIT: durationUnit,
      SPECIAL_REQUIREMENTS: JSON.stringify(specialRequirements || []),
      INITIAL_ORDERS: initialOrders,
      STATUS: 'Pending',
      REQUEST_DATE: new Date().toISOString()
    };
    console.log('✅ IPD Request saved to DB, ID:', newId);

    // Emit real-time notification to nurses
    const io = req.app.get('io');
    if (io) {
      io.to('nurse').emit('new_ipd_request', requestData);
    }

    return res.json({ success: true, data: requestData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to create IPD request' });
  }
});

// ── PATCH /api/ipd/requests/:id/status ───────────────────────
router.patch('/requests/:id/status', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const { status, admissionId } = req.body;
    const reqId = req.params.id;

    await sequelize.query(`
      UPDATE HMS_IPD_REQUESTS SET STATUS = :status, ADMISSION_ID = :admissionId
      WHERE ID = :id
    `, { replacements: { status, admissionId: admissionId || null, id: reqId }});

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update request' });
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
    const admissionId = req.params.id;
    const [adms] = await sequelize.query(`
      SELECT a.*, p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             p.DOB, p.BLOOD_GROUP, p.PHONENUMBER as CONTACT_NUMBER,
             p.HOUSE_NO, p.STREET, p.CITY, p.STATE, p.PIN,
             p.EMERGENCY_CONTACT_NAME, p.EMERGENCY_CONTACT_RELATION,
             b.ROOM_NUMBER, b.BED_NUMBER, w.NAME as WARD_NAME,
             u.NAME as DOCTOR_NAME,
             EXTRACT(DAY FROM (CURRENT_TIMESTAMP - a.ADMISSION_DATE)) as DAYS_ADMITTED,
             r.REASON_FOR_ADMISSION, r.PRIMARY_DIAGNOSIS, r.SPECIAL_REQUIREMENTS
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

    res.json({ success: true, data: adms[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch admission' });
  }
});

// ── PATCH /api/ipd/admissions/:id/discharge ────────────────
router.patch('/admissions/:id/discharge', protect, checkPermission('ipd', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const admissionId = req.params.id;
    const { finalDiagnosis, courseInHospital, conditionAtDischarge, adviceOnDischarge,
            chiefComplaint, comorbidities, allergies, historyOfIllness,
            investigations, dischargeMedications, dietLifestyle, warningSigns,
            followUpAppointments } = req.body;
    let admission = await Admission.findByPk(admissionId, { transaction: t });
    
    if (!admission) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Admission record not found' });
    }

    if (admission.status === 'Discharged') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Already discharged' });
    }

    await sequelize.query(`
      UPDATE HMS_ADMISSIONS 
      SET DISCHARGE_DATE = CURRENT_TIMESTAMP, STATUS = 'Discharged' 
      WHERE ID = :admissionId
    `, { replacements: { admissionId }, transaction: t });

    await sequelize.query(`
      UPDATE HMS_BEDS SET STATUS = 'Available' WHERE ID = :bedId
    `, { replacements: { bedId: admission.bedId }, transaction: t });

    // Insert Discharge Summary
    try {
      const [[seqRow]] = await sequelize.query(`SELECT nextval('hms_discharge_seq') AS "ID"`, { transaction: t });
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
          id: seqRow.ID,
          admId: admissionId,
          fd: finalDiagnosis || null,
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
          createdBy: req.user.id
        },
        transaction: t
      });
    } catch (e) {
      console.warn('Failed to insert discharge summary:', e.message);
    }

    await t.commit();
    await logAction(req.user.id, 'UPDATE', 'ipd', admissionId, null, { action: 'discharge_patient' }, req.ip);

    res.json({ success: true, message: 'Patient discharged successfully' });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to discharge patient' });
  }
});

// ── GET /api/ipd/discharge-summaries ──────────
router.get('/discharge-summaries', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [summaries] = await sequelize.query(`
      SELECT s.ID, s.ADMISSION_ID, s.FINAL_DIAGNOSIS, s.CREATED_AT as DISCHARGE_DATE,
             a.ADMISSION_DATE,
             p.NAME as PATIENT_NAME, p.UHID, p.GENDER, p.AGE,
             u.NAME as DOCTOR_NAME
      FROM HMS_DISCHARGE_SUMMARIES s
      JOIN HMS_ADMISSIONS a ON a.ID = s.ADMISSION_ID
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = s.CREATED_BY
      ORDER BY s.CREATED_AT DESC
    `);
    res.json({ success: true, data: summaries });
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

    res.json({ success: true, data: summary });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch discharge summary' });
  }
});

// ── NOTES & VITALS ─────────────────────────────────────────

router.post('/progress-notes', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const note = await ProgressNote.create({ ...req.body, doctorId: req.user.id });
    res.json({ success: true, data: note });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save progress note' });
  }
});

router.get('/progress-notes/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [notes] = await sequelize.query(`
      SELECT n.*, u.NAME as DOCTOR_NAME
      FROM HMS_PROGRESS_NOTES n
      JOIN HMS_USERS u ON u.ID = n.DOCTOR_ID
      WHERE n.ADMISSION_ID = :admissionId
      ORDER BY n.NOTE_DATE DESC
    `, { replacements: { admissionId: req.params.admissionId } });
    
    for (let note of notes) {
      if (note.NOTE_TEXT) {
        note.NOTE_TEXT = await clobToString(note.NOTE_TEXT);
      }
    }
    res.json({ success: true, data: notes });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch progress notes' });
  }
});

router.post('/nursing-notes', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const conditionNotes = req.body.conditionNotes || req.body.noteText || req.body.note_text || '';
    const complaints = req.body.complaints || '';
    const actionsTaken = req.body.actionsTaken || req.body.actions_taken || '';
    const admissionId = req.body.admissionId || req.body.admission_id;

    if (!admissionId) {
      return res.status(400).json({ success: false, message: 'admissionId is required' });
    }

    const note = await NursingNote.create({
      admissionId: Number(admissionId),
      nurseId: req.user.id,
      conditionNotes,
      complaints,
      actionsTaken,
      noteDate: new Date(),
    });
    res.json({ success: true, data: note });
  } catch (err) {
    console.error('Failed to save nursing note:', err);
    res.status(500).json({ success: false, message: 'Failed to save nursing note' });
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
    res.json({ success: true, data: notes });
  } catch (err) {
    console.error('Failed to fetch nursing notes:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch notes' });
  }
});

router.post('/vitals', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const payload = { ...req.body, recordedBy: req.user.id };
    // Sanitize empty strings to null for numeric fields
    const numericFields = ['bpSystolic', 'bpDiastolic', 'temperature', 'spo2', 'pulse', 'respiratoryRate', 'painScore', 'intakeOralMl', 'intakeIvMl', 'outputUrineMl', 'outputDrainMl'];
    numericFields.forEach(field => {
      if (payload[field] === '') payload[field] = null;
      else if (payload[field] !== undefined && payload[field] !== null) payload[field] = Number(payload[field]);
    });

    const v = await IpdVitals.create(payload);
    res.json({ success: true, data: v });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save vitals' });
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

router.post('/mar', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const m = await MarRecord.create(req.body); // For creating schedules
    res.json({ success: true, data: m });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to save MAR' });
  }
});

router.get('/mar/:admissionId', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const [mar] = await sequelize.query(`
      SELECT * FROM HMS_MAR_RECORDS
      WHERE ADMISSION_ID = :admissionId
      AND TRUNC(SCHEDULED_TIME) = TRUNC(CURRENT_TIMESTAMP)
      ORDER BY SCHEDULED_TIME ASC
    `, { replacements: { admissionId: req.params.admissionId } });
    
    res.json({ success: true, data: mar });
  } catch (err) {
    console.error('Failed to fetch MAR:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch MAR' });
  }
});

router.patch('/mar/:id/status', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const { status, holdReason } = req.body;
    await sequelize.query(`
      UPDATE HMS_MAR_RECORDS 
      SET STATUS = :status, ADMINISTERED_BY = :userId, ADMINISTERED_AT = CURRENT_TIMESTAMP, HOLD_REASON = :reason
      WHERE ID = :id
    `, { replacements: { status, userId: req.user.id, reason: holdReason || null, id: req.params.id } });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// ── IPD BILLING — WARD RATES & CHARGES ─────────────────────

const WARD_RATES = {
  'General': 400,
  'Private': 800,
  'Critical Care': 400,
  'Maternity': 400,
};

let activeDraftCharges = {};

// ── GET /api/ipd/admissions/:id/charges ────────────────────
router.get('/admissions/:id/charges', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const admissionId = String(req.params.id);

    // Get admission details for ward rate calculation
    const [adms] = await sequelize.query(`
      SELECT a.*, w.TYPE as WARD_TYPE, w.NAME as WARD_NAME,
             EXTRACT(DAY FROM (CURRENT_TIMESTAMP - a.ADMISSION_DATE)) as DAYS_ADMITTED
      FROM HMS_ADMISSIONS a
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      WHERE a.ID = :admissionId
    `, { replacements: { admissionId } });

    if (adms.length === 0) {
      return res.status(404).json({ success: false, message: 'Admission not found' });
    }

    const admission = adms[0];
    const charges = activeDraftCharges[admissionId] || [];

    // Calculate ward charges
    const daysAdmitted = Math.max(1, Number(admission.DAYS_ADMITTED) || 1);
    const wardType = admission.WARD_TYPE || 'General';
    const wardRate = WARD_RATES[wardType] || 400;
    const wardTotal = daysAdmitted * wardRate;

    // Calculate medicine total
    const medicineTotal = charges.reduce((sum, c) => sum + (c.TOTAL_PRICE || 0), 0);

    res.json({
      success: true,
      data: {
        charges,
        wardInfo: {
          wardName: admission.WARD_NAME,
          wardType,
          wardRate,
          daysAdmitted,
          wardTotal,
        },
        medicineTotal,
        grandTotal: wardTotal + medicineTotal,
      }
    });
  } catch (err) {
    console.error('❌ Fetch charges failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch charges' });
  }
});

// ── POST /api/ipd/admissions/:id/charges ───────────────────
router.post('/admissions/:id/charges', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const admissionId = String(req.params.id);
    const { medicineId, medicineName, formulation, strength, quantity } = req.body;

    if (!medicineId || !medicineName || !quantity) {
      return res.status(400).json({ success: false, message: 'Medicine ID, name, and quantity are required' });
    }

    // Look up MRP from batches
    let unitPrice = 0;
    try {
      const [batches] = await sequelize.query(`
        SELECT MRP FROM HMS_MEDICINE_BATCHES
        WHERE MEDICINE_ID = :medicineId AND QUANTITY > 0
        ORDER BY EXPIRY_DATE ASC
        LIMIT 1
      `, { replacements: { medicineId } });
      if (batches.length > 0) {
        unitPrice = Number(batches[0].MRP) || 0;
      }
    } catch (e) {
      console.warn('MRP lookup failed:', e.message);
    }

    if (unitPrice === 0) {
      try {
        const [purchaseItems] = await sequelize.query(`
          SELECT MRP FROM HMS_PURCHASE_ITEMS
          WHERE MEDICINE_ID = :medicineId
          ORDER BY ID DESC
          LIMIT 1
        `, { replacements: { medicineId } });
        if (purchaseItems.length > 0) {
          unitPrice = Number(purchaseItems[0].MRP) || 0;
        }
      } catch (e) { /* ignore */ }
    }

    if (!activeDraftCharges[admissionId]) {
      activeDraftCharges[admissionId] = [];
    }

    const chargeId = Date.now();
    const charge = {
      ID: chargeId,
      ADMISSION_ID: admissionId,
      MEDICINE_ID: Number(medicineId),
      MEDICINE_NAME: medicineName,
      FORMULATION: formulation || '',
      STRENGTH: strength || '',
      QUANTITY: Number(quantity),
      UNIT_PRICE: unitPrice,
      TOTAL_PRICE: unitPrice * Number(quantity),
      ADDED_BY: req.user.id,
      ADDED_AT: new Date().toISOString(),
    };

    activeDraftCharges[admissionId].push(charge);
    res.json({ success: true, data: charge });
  } catch (err) {
    console.error('❌ Add charge failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to add charge' });
  }
});

// ── PATCH /api/ipd/admissions/:id/charges/:chargeId ────────
router.patch('/admissions/:id/charges/:chargeId', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const admissionId = String(req.params.id);
    const chargeId = Number(req.params.chargeId);
    const { quantity } = req.body;
    
    const charges = activeDraftCharges[admissionId] || [];
    const charge = charges.find(c => c.ID === chargeId);
    if (!charge) return res.status(404).json({ success: false, message: 'Charge not found' });

    charge.QUANTITY = Number(quantity);
    charge.TOTAL_PRICE = charge.UNIT_PRICE * charge.QUANTITY;
    res.json({ success: true, data: charge });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to update charge' });
  }
});

// ── DELETE /api/ipd/admissions/:id/charges/:chargeId ───────
router.delete('/admissions/:id/charges/:chargeId', protect, checkPermission('ipd', 'write'), async (req, res) => {
  try {
    const admissionId = String(req.params.id);
    const chargeId = Number(req.params.chargeId);
    const charges = activeDraftCharges[admissionId] || [];
    const idx = charges.findIndex(c => c.ID === chargeId);
    if (idx === -1) return res.status(404).json({ success: false, message: 'Charge not found' });

    charges.splice(idx, 1);
    res.json({ success: true, message: 'Charge removed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to remove charge' });
  }
});

// ── POST /api/ipd/admissions/:id/generate-bill ─────────────
router.post('/admissions/:id/generate-bill', protect, checkPermission('ipd', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const admissionId = String(req.params.id);

    // Get admission info
    const [adms] = await sequelize.query(`
      SELECT a.*, w.TYPE as WARD_TYPE, w.NAME as WARD_NAME,
             EXTRACT(DAY FROM (CURRENT_TIMESTAMP - a.ADMISSION_DATE)) as DAYS_ADMITTED
      FROM HMS_ADMISSIONS a
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      WHERE a.ID = :admissionId
    `, { replacements: { admissionId }, transaction: t });

    if (adms.length === 0) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Admission not found' });
    }

    const admission = adms[0];
    const charges = activeDraftCharges[admissionId] || [];
    const daysAdmitted = Math.max(1, Number(admission.DAYS_ADMITTED) || 1);
    const wardType = admission.WARD_TYPE || 'General';
    const wardRate = WARD_RATES[wardType] || 400;
    const wardTotal = daysAdmitted * wardRate;
    const medicineTotal = charges.reduce((sum, c) => sum + (c.TOTAL_PRICE || 0), 0);
    const totalAmount = wardTotal + medicineTotal;

    const year = new Date().getFullYear();

    // Generate bill ID and number
    const [[billSeq]] = await sequelize.query(`SELECT nextval('hms_bills_seq') AS "ID"`, { transaction: t });
    const billId = billSeq.ID || billSeq.id;
    const billNumber = `IPD-${year}-${String(billId).padStart(6, '0')}`;

    await sequelize.query(`
      INSERT INTO HMS_BILLS (
        ID, PATIENT_ID, ADMISSION_ID, BILL_TYPE, BILL_NUMBER, STATUS,
        TOTAL_AMOUNT, DISCOUNT_AMOUNT, GST_AMOUNT, NET_PAYABLE, ADVANCE_ADJUSTED,
        CREATED_BY, CREATED_AT, UPDATED_AT
      ) VALUES (
        :id, :patientId, :admissionId, 'IPD', :billNumber, 'Pending',
        :totalAmount, 0, 0, :totalAmount, 0,
        :createdBy, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, {
      replacements: {
        id: billId,
        patientId: admission.PATIENT_ID,
        admissionId: Number(admissionId),
        billNumber,
        totalAmount,
        createdBy: req.user.id,
      },
      transaction: t,
    });

    // Insert bill items — ward charges
    const [[wardItemSeq]] = await sequelize.query(`SELECT nextval('hms_bill_items_seq') AS "ID"`, { transaction: t });
    await sequelize.query(`
      INSERT INTO HMS_BILL_ITEMS (ID, BILL_ID, ITEM_TYPE, ITEM_NAME, QUANTITY, RATE, AMOUNT, SERVICE_DATE)
      VALUES (:id, :billId, 'Ward', :itemName, :qty, :rate, :amount, CURRENT_TIMESTAMP)
    `, {
      replacements: {
        id: wardItemSeq.ID,
        billId,
        itemName: `${admission.WARD_NAME || wardType} Ward Charges (${daysAdmitted} days)`,
        qty: daysAdmitted,
        rate: wardRate,
        amount: wardTotal,
      },
      transaction: t,
    });

    // Insert bill items — each medicine
    for (const charge of charges) {
      const [[medItemSeq]] = await sequelize.query(`SELECT nextval('hms_bill_items_seq') AS "ID"`, { transaction: t });
      await sequelize.query(`
        INSERT INTO HMS_BILL_ITEMS (ID, BILL_ID, ITEM_TYPE, ITEM_NAME, QUANTITY, RATE, AMOUNT, SERVICE_DATE)
        VALUES (:id, :billId, 'Medicine', :itemName, :qty, :rate, :amount, CURRENT_TIMESTAMP)
      `, {
        replacements: {
          id: medItemSeq.ID,
          billId,
          itemName: `${charge.MEDICINE_NAME}${charge.STRENGTH ? ' ' + charge.STRENGTH : ''}`,
          qty: charge.QUANTITY,
          rate: charge.UNIT_PRICE,
          amount: charge.TOTAL_PRICE,
        },
        transaction: t,
      });
    }

    await t.commit();

    // Clear draft charges for this admission after billing
    delete activeDraftCharges[admissionId];

    console.log('✅ IPD Bill generated:', billNumber);
    res.json({
      success: true,
      data: {
        billId,
        billNumber,
        totalAmount,
        wardTotal,
        medicineTotal,
      }
    });
  } catch (err) {
    await t.rollback();
    console.error('❌ Generate IPD bill failed:', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate IPD bill' });
  }
});

// ── GET /api/ipd/billing/saved-drafts ───────────────────────
router.get('/billing/saved-drafts', protect, checkPermission('ipd', 'read'), async (req, res) => {
  try {
    const draftAdmissionIds = Object.keys(activeDraftCharges).filter(id => activeDraftCharges[id].length > 0);
    
    if (draftAdmissionIds.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const [admissions] = await sequelize.query(`
      SELECT a.*, p.NAME as PATIENT_NAME, p.UHID,
             b.BED_NUMBER, w.NAME as WARD_NAME
      FROM HMS_ADMISSIONS a
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      LEFT JOIN HMS_BEDS b ON b.ID = a.BED_ID
      LEFT JOIN HMS_WARDS w ON w.ID = b.WARD_ID
      WHERE a.ID IN (:ids)
    `, { replacements: { ids: draftAdmissionIds } });

    const results = admissions.map(adm => {
      const draftCharges = activeDraftCharges[String(adm.ID)] || [];
      const draftTotal = draftCharges.reduce((sum, c) => sum + (c.TOTAL_PRICE || 0), 0);
      return { ...adm, draftTotal, itemCount: draftCharges.length };
    });

    res.json({ success: true, data: results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

module.exports = router;
