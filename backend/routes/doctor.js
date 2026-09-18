const express = require('express');
const router = express.Router();
const { protect, checkPermission } = require('../middleware/auth');
const { sequelize } = require('../models/db');
const Patient = require('../models/Patient');
const Doctor = require('../models/Doctor');
const User = require('../models/User');
const Department = require('../models/Department');
const Token = require('../models/Token');
const Encounter = require('../models/Encounter');
const Prescription = require('../models/Prescription');
const PrescriptionItem = require('../models/PrescriptionItem');
const InvestigationOrder = require('../models/InvestigationOrder');
const InvestigationOrderItem = require('../models/InvestigationOrderItem');
const Admission = require('../models/Admission');
const { Op, QueryTypes } = require('sequelize');
const { clobToString } = require('../utils/clobToString');

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function compactWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function buildClinicalSnippet(encounter) {
  const candidates = [
    encounter.chief_complaint,
    encounter.hopi,
    encounter.general_examination,
    encounter.current_medications,
  ]
    .map(compactWhitespace)
    .filter(Boolean);

  if (candidates.length === 0) {
    return 'Encounter saved without narrative notes yet.';
  }

  const combined = candidates.join(' | ');
  return combined.length > 140 ? `${combined.slice(0, 137)}...` : combined;
}

function buildReferralClinicalNotes(body) {
  const referralType = body.referralType || "Outside";
  if (referralType === "Local") {
    return JSON.stringify({
      _type: "local_referral_details",
      clinicalNotes: body.clinicalNotes || "",
      empName: body.empName || body.emp_name || "",
      patientDepartment: body.patientDepartment || body.patient_department || "",
      caseType: body.caseType || body.case_type || "",
    });
  }

  return JSON.stringify({
    _type: "outside_referral_details",
    clinicalNotes: body.clinicalNotes || "",
    treatmentHospital: body.treatmentHospital || "",
    treatmentLocal: body.treatmentLocal || "",
    treatmentPeriod: body.treatmentPeriod || "",
    escortAllowed: body.escortAllowed === "Yes" ? "Yes" : "No",
    escortCount: body.escortAllowed === "Yes" ? (body.escortCount || "") : "",
    ambulanceAllowed: body.ambulanceAllowed === "Yes" ? "Yes" : "No",
    ambulanceEscortJustification: body.ambulanceEscortJustification || "",
  });
}

async function normalizeReferralDetails(referral) {
  const rawNotes = await clobToString(referral.clinical_notes);
  const baseReferral = { ...referral, clinical_notes: rawNotes || "" };

  if (!rawNotes || typeof rawNotes !== "string") return baseReferral;

  try {
    const parsed = JSON.parse(rawNotes);
    if (!parsed) return baseReferral;

    if (parsed._type === "local_referral_details") {
      return {
        ...baseReferral,
        clinical_notes: parsed.clinicalNotes || "",
        emp_name: parsed.empName || "",
        patient_department: parsed.patientDepartment || "",
        case_type: parsed.caseType || "",
      };
    }

    if (parsed._type !== "outside_referral_details") return baseReferral;

    return {
      ...baseReferral,
      clinical_notes: parsed.clinicalNotes || "",
      treatment_hospital: parsed.treatmentHospital || "",
      treatment_local: parsed.treatmentLocal || "",
      treatment_period: parsed.treatmentPeriod || "",
      escort_allowed: parsed.escortAllowed || "No",
      escort_count: parsed.escortCount || "",
      ambulance_allowed: parsed.ambulanceAllowed || "No",
      ambulance_escort_justification: parsed.ambulanceEscortJustification || "",
    };
  } catch {
    return baseReferral;
  }
}

function classifyEncounterNote(encounterType) {
  switch (String(encounterType || '').toUpperCase()) {
    case 'IPD':
      return 'Progress Note';
    case 'ER':
      return 'Emergency Note';
    default:
      return 'SOAP Note';
  }
}

// ═══════════════════════════════════════════════════════════════
//  Routes
// ═══════════════════════════════════════════════════════════════

router.get('/prescriptions', protect, async (req, res) => {
  try {
    const showAllDoctors = req.query.scope === 'all';
    const doctorWhereClause = showAllDoctors ? '' : 'WHERE pr.DOCTOR_ID = :doctorId';

    const results = await sequelize.query(`
      SELECT 
        pr.ID as "id", pr.ENCOUNTER_ID as "encounter_id", pr.PATIENT_ID as "patient_id",
        pr.DOCTOR_ID as "doctor_id", pr.STATUS as "status", pr.TYPE as "type", pr.CREATED_AT as "created_at",
        p.NAME as "patient_name", p.UHID as "uhid", p.PATIENTTYPE as "patient_type",
        p.EMPNUMBER as "emp_number", p.PHONENUMBER as "phone_number", p.RELATIONSHIP as "relationship",
        p.AGE as "age", p.GENDER as "gender",
        u.NAME as "doctor_name", u.USERNAME as "doctor_username",
        (SELECT COUNT(*) FROM HMS_PRESCRIPTION_ITEMS pi WHERE pi.PRESCRIPTION_ID = pr.ID) as "medicine_count",
        COALESCE(
          (SELECT d.ICD10_DESCRIPTION FROM HMS_DIAGNOSES d WHERE d.ENCOUNTER_ID = pr.ENCOUNTER_ID LIMIT 1),
          e.CHIEF_COMPLAINT
        ) as "diagnosis"
      FROM HMS_PRESCRIPTIONS pr
      JOIN HMS_PATIENTS p ON p.ID = pr.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = pr.DOCTOR_ID
      LEFT JOIN HMS_ENCOUNTERS e ON e.ID = pr.ENCOUNTER_ID
      ${doctorWhereClause}
      ORDER BY pr.CREATED_AT DESC
    `, {
      replacements: showAllDoctors ? {} : { doctorId: req.user.id },
      type: QueryTypes.SELECT
    });

    const data = await Promise.all(results.map(async (row) => {
      const diagnosis = compactWhitespace(await clobToString(row.diagnosis));
      return {
        ...row,
        diagnosis: diagnosis || null,
      };
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Doctor prescriptions error:', err);
    res.status(500).json({ success: false, message: 'Failed to load prescriptions.' });
  }
});

router.get('/labs', protect, async (req, res) => {
  try {
    const orders = await InvestigationOrder.findAll({
      where: { doctor_id: req.user.id },
      include: [
        { model: Patient, as: 'patient', attributes: ['name', 'uhid'] },
        { model: InvestigationOrderItem, as: 'items', attributes: ['id', 'test_name', 'status'] }
      ],
      order: [['id', 'DESC']],
      limit: 50,
    });

    const data = orders.flatMap((order) =>
      (order.items || []).map((item) => ({
        id: `LR-${item.id}`,
        date: order.order_date ? new Date(order.order_date).toISOString().slice(0, 10) : null,
        patient: order.patient?.name || 'Unknown',
        test: item.test_name,
        status: item.status,
        priority: order.priority || 'Routine'
      }))
    );

    res.json({ success: true, data });
  } catch (err) {
    console.error('Doctor labs error:', err);
    res.status(500).json({ success: false, message: 'Failed to load lab orders.' });
  }
});

router.get('/schedule', protect, async (req, res) => {
  try {
    // Retrieve doctor record
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;

    if (!doctorRecord) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    const appointments = await sequelize.query(
      `SELECT
         TO_CHAR(APPOINTMENT_DATE, 'YYYY-MM-DD') AS APPOINTMENT_DATE,
         SLOT_START
       FROM HMS_APPOINTMENTS
      WHERE DOCTOR_ID = :doctorId
        AND STATUS NOT IN ('Cancelled', 'Completed', 'No Show')
      ORDER BY APPOINTMENT_DATE ASC, SLOT_START ASC`,
      {
        replacements: { doctorId: doctorRecord.id },
        type: QueryTypes.SELECT,
      }
    );

    const grouped = new Map();
    for (const appointment of appointments) {
      const date = appointment.APPOINTMENT_DATE;
      const weekday = WEEKDAY_NAMES[new Date(date).getDay()];
      if (!grouped.has(weekday)) {
        grouped.set(weekday, { day: weekday, slots: [], max_patients: 0, upcoming_dates: [] });
      }
      const entry = grouped.get(weekday);
      if (appointment.SLOT_START) {
        entry.slots.push(appointment.SLOT_START);
      }
      entry.max_patients += 1;
      if (!entry.upcoming_dates.includes(date)) {
        entry.upcoming_dates.push(date);
      }
    }

    const availability = Array.from(grouped.values()).map((entry) => ({
      day: entry.day,
      slots: entry.slots.length ? `${entry.slots[0]} - ${entry.slots[entry.slots.length - 1]}` : 'No slots scheduled',
      max_patients: entry.max_patients,
      upcoming_dates: entry.upcoming_dates,
    }));

    res.json({
      success: true,
      data: {
        availability,
        leaves: [],
      }
    });
  } catch (err) {
    console.error('Doctor schedule error:', err);
    res.status(500).json({ success: false, message: 'Failed to load doctor schedule.' });
  }
});

// Hospital search from PANEL_OF_HOSPITALS
router.get('/hospitals/search', protect, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ success: true, data: [] });
    let results = [];
    try {
      results = await sequelize.query(
        `SELECT HOSP_CODE AS "id", HOSPITAL_NAME AS "name", PLACE AS "place"
         FROM PANEL_OF_HOSPITALS
         WHERE UPPER(HOSPITAL_NAME) LIKE :term
         ORDER BY HOSPITAL_NAME
         LIMIT 10`,
        { replacements: { term: `%${q.toUpperCase()}%` }, type: QueryTypes.SELECT }
      );
    } catch (err) {
      console.error('Hospital search error:', err);
      results = [];
    }
    res.json({ success: true, data: results || [] });
  } catch (err) {
    console.error('Hospital search error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/doctor/referrals/reasons — Fetch unique reasons for autocomplete
router.get('/referrals/reasons', protect, async (req, res) => {
  try {
    const results = await sequelize.query(
      `SELECT DISTINCT REASON FROM HMS_REFERRALS WHERE REASON IS NOT NULL LIMIT 50`,
      { type: QueryTypes.SELECT }
    );
    const reasons = results.map(r => String(r.REASON || '').trim()).filter(r => r.length > 0);
    res.json({ success: true, data: reasons });
  } catch (err) {
    console.error('Error fetching referral reasons:', err);
    res.json({ success: true, data: [] });
  }
});

// GET /api/doctor/referrals/patient/:patientId — Fetch referrals across repeat registrations
router.get('/referrals/patient/:patientId', protect, async (req, res) => {
  try {
    const patientId = Number(req.params.patientId);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    const referrals = await sequelize.query(`
      SELECT r.*, p.NAME as PATIENT_NAME, p.UHID, p.PATIENTTYPE as PATIENT_TYPE,
             p.EMPNUMBER as EMP_NUMBER, p.RELATIONSHIP, p.PHONENUMBER as PHONE_NUMBER,
             u.NAME as DOCTOR_NAME
      FROM HMS_REFERRALS r
      LEFT JOIN HMS_PATIENTS p ON r.PATIENT_ID = p.ID
      LEFT JOIN HMS_DOCTORS d ON r.FROM_DOCTOR_ID = d.ID
      LEFT JOIN HMS_USERS u ON d.USER_ID = u.ID
      WHERE r.PATIENT_ID IN (
        SELECT candidate.ID
        FROM HMS_PATIENTS candidate, HMS_PATIENTS target
        WHERE target.ID = :patientId
          AND (
            candidate.ID = target.ID
            OR (
              candidate.UHID IS NOT NULL
              AND target.UHID IS NOT NULL
              AND candidate.UHID = target.UHID
            )
            OR (
              candidate.PATIENTTYPE = target.PATIENTTYPE
              AND UPPER(TRIM(candidate.NAME)) = UPPER(TRIM(target.NAME))
              AND (
                (
                  target.PATIENTTYPE IN ('corporate_employee', 'cisf_employee')
                  AND target.EMPNUMBER IS NOT NULL
                  AND UPPER(TRIM(candidate.EMPNUMBER)) = UPPER(TRIM(target.EMPNUMBER))
                  AND COALESCE(UPPER(TRIM(candidate.RELATIONSHIP)), 'SELF') =
                      COALESCE(UPPER(TRIM(target.RELATIONSHIP)), 'SELF')
                )
                OR (
                  target.PATIENTTYPE = 'other'
                  AND target.PHONENUMBER IS NOT NULL
                  AND TRIM(candidate.PHONENUMBER) = TRIM(target.PHONENUMBER)
                )
              )
            )
          )
      )
      ORDER BY r.CREATED_AT DESC
    `, {
      replacements: { patientId },
      type: QueryTypes.SELECT
    });

    const formatted = await Promise.all(referrals.map((row) => normalizeReferralDetails({
      id: row.ID,
      date: row.CREATED_AT,
      patient: row.PATIENT_NAME,
      uhid: row.UHID,
      patient_id: row.PATIENT_ID,
      patient_type: row.PATIENT_TYPE,
      emp_number: row.EMP_NUMBER,
      relationship: row.RELATIONSHIP,
      phone_number: row.PHONE_NUMBER,
      referral_type: row.REFERRAL_TYPE,
      local_ref_no: row.LOCAL_REF_NO,
      to_specialty: row.TO_SPECIALTY,
      hospital: row.HOSPITAL,
      reason: row.REASON,
      clinical_notes: row.CLINICAL_NOTES,
      status: row.STATUS,
      doctor_name: row.DOCTOR_NAME
    })));

    res.json({ success: true, data: formatted });
  } catch (err) {
    console.error('Error fetching patient referrals:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});
router.get('/referrals', protect, async (req, res) => {
  try {
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;

    if (!doctorRecord) {
      return res.status(404).json({ success: false, message: 'Doctor profile not found.' });
    }

    const outbound = await sequelize.query(
      `SELECT r.ID AS "id", r.LOCAL_REF_NO AS "local_ref_no", r.CREATED_AT AS "date", 
              p.NAME AS "patient", p.ID as "patient_id", p.UHID as "uhid",
              p.AGE as "patient_age", p.GENDER as "patient_gender",
              p.EMPNUMBER as "emp_number", p.RELATIONSHIP as "relationship",
              p.PATIENTTYPE as "patient_type", p.PHONENUMBER as "phone_number",
              r.TO_SPECIALTY AS "to_specialty", r.REASON as "reason", r.STATUS AS "status",
              r.HOSPITAL as "hospital", r.CLINICAL_NOTES as "clinical_notes",
              r.REFERRAL_TYPE as "referral_type",
              u.NAME AS "doctor_name"
       FROM HMS_REFERRALS r
       JOIN HMS_PATIENTS p ON r.PATIENT_ID = p.ID
       LEFT JOIN HMS_DOCTORS d ON r.FROM_DOCTOR_ID = d.ID
       LEFT JOIN HMS_USERS u ON d.USER_ID = u.ID
       WHERE r.FROM_DOCTOR_ID = :doctorId
       ORDER BY r.CREATED_AT DESC`,
      {
        replacements: { doctorId: doctorRecord.id },
        type: QueryTypes.SELECT
      }
    );

    res.json({
      success: true,
      data: {
        inbound: [],
        outbound: await Promise.all((outbound || []).map(normalizeReferralDetails)),
      }
    });

  } catch (err) {
    console.error('Referral generic error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.post('/referrals', protect, async (req, res) => {
  try {
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;
    if (!doctorRecord) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });

    const { patientId, toSpecialty, reason, hospital, referralType } = req.body;
    const clinicalNotes = buildReferralClinicalNotes(req.body);
    if (!patientId || !toSpecialty) return res.status(400).json({ success: false, message: 'Patient ID and Specialty are required.' });

    await sequelize.query(
      `INSERT INTO HMS_REFERRALS (PATIENT_ID, FROM_DOCTOR_ID, TO_SPECIALTY, REASON, HOSPITAL, CLINICAL_NOTES, STATUS, REFERRAL_TYPE, CREATED_AT, UPDATED_AT)
       VALUES (:patientId, :fromDoctorId, :toSpecialty, :reason, :hospital, :clinicalNotes, 'Pending', :referralType, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      {
        replacements: {
          patientId,
          fromDoctorId: doctorRecord.id,
          toSpecialty,
          reason: reason || '',
          hospital: hospital || '',
          clinicalNotes: clinicalNotes || '',
          referralType: referralType || 'Outside'
        }
      }
    );

    res.json({ success: true, message: 'Referral created successfully.' });
  } catch (err) {
    console.error('Referral creation error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.put('/referrals/:id', protect, async (req, res) => {
  try {
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;
    if (!doctorRecord) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });

    const referralId = Number(req.params.id);
    if (!Number.isInteger(referralId) || referralId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid referral ID.' });
    }

    const ownedReferrals = await sequelize.query(
      `SELECT ID, PATIENT_ID, REFERRAL_TYPE
       FROM HMS_REFERRALS
       WHERE ID = :id AND FROM_DOCTOR_ID = :fromDoctorId`,
      {
        replacements: { id: referralId, fromDoctorId: doctorRecord.id },
        type: QueryTypes.SELECT
      }
    );

    if (ownedReferrals.length === 0) {
      return res.status(404).json({ success: false, message: 'Referral not found or not owned by this doctor.' });
    }

    const existingReferral = ownedReferrals[0];
    const patientId = Number(req.body.patientId || existingReferral.PATIENT_ID);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ success: false, message: 'Invalid patient ID.' });
    }

    const referralType = req.body.referralType || existingReferral.REFERRAL_TYPE || 'Outside';
    const toSpecialty = compactWhitespace(req.body.toSpecialty);
    const reason = String(req.body.reason || '').trim();
    const hospital = compactWhitespace(req.body.hospital);
    const clinicalNotes = buildReferralClinicalNotes({ ...req.body, referralType });
    const hasPatientName = Object.prototype.hasOwnProperty.call(req.body, 'patientName');
    const patientName = hasPatientName ? compactWhitespace(req.body.patientName) : '';

    if (hasPatientName && !patientName) {
      return res.status(400).json({ success: false, message: 'Patient name cannot be empty.' });
    }

    const transaction = await sequelize.transaction();
    try {
      await sequelize.query(
        `UPDATE HMS_REFERRALS
         SET PATIENT_ID = :patientId,
             TO_SPECIALTY = :toSpecialty,
             REASON = :reason,
             HOSPITAL = :hospital,
             CLINICAL_NOTES = :clinicalNotes,
             REFERRAL_TYPE = :referralType,
             UPDATED_AT = CURRENT_TIMESTAMP
         WHERE ID = :id AND FROM_DOCTOR_ID = :fromDoctorId`,
        {
          replacements: {
            patientId,
            toSpecialty,
            reason,
            hospital,
            clinicalNotes,
            referralType,
            id: referralId,
            fromDoctorId: doctorRecord.id
          },
          transaction
        }
      );

      if (referralType === 'Local') {
        const patientSetClauses = [];
        const patientReplacements = { patientId };

        if (hasPatientName) {
          patientSetClauses.push('NAME = :patientName');
          patientReplacements.patientName = patientName;
        }

        if (Object.prototype.hasOwnProperty.call(req.body, 'empNumber')) {
          patientSetClauses.push('EMPNUMBER = :empNumber');
          patientReplacements.empNumber = compactWhitespace(req.body.empNumber) || null;
        }

        if (patientSetClauses.length > 0) {
          patientSetClauses.push('UPDATED_AT = CURRENT_TIMESTAMP');
          await sequelize.query(
            `UPDATE HMS_PATIENTS
             SET ${patientSetClauses.join(', ')}
             WHERE ID = :patientId`,
            { replacements: patientReplacements, transaction }
          );
        }
      }

      await transaction.commit();
    } catch (updateError) {
      await transaction.rollback();
      throw updateError;
    }

    const updatedRows = await sequelize.query(
      `SELECT r.ID AS "id", r.LOCAL_REF_NO AS "local_ref_no", r.CREATED_AT AS "date",
              p.NAME AS "patient", p.ID AS "patient_id", p.UHID AS "uhid",
              p.AGE AS "patient_age", p.GENDER AS "patient_gender",
              p.EMPNUMBER AS "emp_number", p.RELATIONSHIP AS "relationship",
              p.PATIENTTYPE AS "patient_type", p.PHONENUMBER AS "phone_number",
              r.TO_SPECIALTY AS "to_specialty", r.REASON AS "reason", r.STATUS AS "status",
              r.HOSPITAL AS "hospital", r.CLINICAL_NOTES AS "clinical_notes",
              r.REFERRAL_TYPE AS "referral_type", u.NAME AS "doctor_name"
       FROM HMS_REFERRALS r
       JOIN HMS_PATIENTS p ON r.PATIENT_ID = p.ID
       LEFT JOIN HMS_DOCTORS d ON r.FROM_DOCTOR_ID = d.ID
       LEFT JOIN HMS_USERS u ON d.USER_ID = u.ID
       WHERE r.ID = :id`,
      { replacements: { id: referralId }, type: QueryTypes.SELECT }
    );

    const updatedReferral = updatedRows[0]
      ? await normalizeReferralDetails(updatedRows[0])
      : null;

    res.json({
      success: true,
      message: 'Referral updated successfully.',
      data: updatedReferral
    });
  } catch (err) {
    console.error('Referral update error:', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
});

router.delete('/referrals/:id', protect, async (req, res) => {
  try {
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;
    if (!doctorRecord) return res.status(404).json({ success: false, message: 'Doctor profile not found.' });

    await sequelize.query(
      `DELETE FROM HMS_REFERRALS WHERE ID = :id AND FROM_DOCTOR_ID = :fromDoctorId`,
      { replacements: { id: req.params.id, fromDoctorId: doctorRecord.id } }
    );
    res.json({ success: true, message: 'Referral deleted successfully.' });
  } catch (err) {
    console.error('Referral delete error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

router.get('/clinical-notes', protect, async (req, res) => {
  try {
    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id'] });
    const doctorRecord = doctorRecords[0] || null;

    const doctorIds = [req.user.id];
    if (doctorRecord && doctorRecord.id && !doctorIds.includes(doctorRecord.id)) {
      doctorIds.push(doctorRecord.id);
    }

    const encounters = await sequelize.query(
      `SELECT
         e.ID,
         TO_CHAR(e.ENCOUNTER_DATE, 'YYYY-MM-DD') AS ENCOUNTER_DATE,
         e.ENCOUNTER_TYPE,
         e.CHIEF_COMPLAINT,
         e.HOPI,
         e.GENERAL_EXAMINATION,
         e.CURRENT_MEDICATIONS,
         p.NAME AS PATIENT_NAME
       FROM HMS_ENCOUNTERS e
       LEFT JOIN HMS_PATIENTS p ON p.ID = e.PATIENT_ID
      WHERE e.DOCTOR_ID IN (:doctorIds)
      ORDER BY e.ENCOUNTER_DATE DESC
      LIMIT 50`,
      {
        replacements: { doctorIds },
        type: QueryTypes.SELECT,
      }
    );

    const data = encounters.map((encounter) => ({
      id: `CN-${encounter.ID}`,
      encounter_id: encounter.ID,
      date: encounter.ENCOUNTER_DATE,
      patient: encounter.PATIENT_NAME || 'Unknown',
      type: classifyEncounterNote(encounter.ENCOUNTER_TYPE),
      snippet: buildClinicalSnippet(encounter),
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('Doctor clinical notes error:', err);
    res.status(500).json({ success: false, message: 'Failed to load clinical notes.' });
  }
});

router.get('/reports', protect, async (req, res) => {
  try {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const doctorRecords = await Doctor.findAll({ where: { user_id: req.user.id }, attributes: ['id', 'slot_duration_mins'] });
    const doctorRecord = doctorRecords[0] || null;

    const [encounters, prescriptions, labOrders, admissions] = await Promise.all([
      Encounter.findAll({
        where: { doctor_id: req.user.id },
        attributes: ['id', 'patient_id', 'encounter_date'],
      }),
      Prescription.findAll({
        where: { doctor_id: req.user.id },
        attributes: ['id', 'createdAt'],
      }),
      InvestigationOrder.findAll({
        where: { doctor_id: req.user.id },
        attributes: ['id', 'order_date'],
      }),
      Admission.findAll({
        where: doctorRecord
          ? { admittingDoctorId: { [Op.in]: [doctorRecord.id, req.user.id] } }
          : { admittingDoctorId: req.user.id },
        attributes: ['id', 'admissionDate'],
      }),
    ]);

    const isThisMonth = (value) => {
      if (!value) return false;
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date >= monthStart;
    };

    const monthlyPatientIds = new Set(
      encounters.filter((encounter) => isThisMonth(encounter.encounter_date)).map((encounter) => encounter.patient_id)
    );
    const monthlyPatients = monthlyPatientIds.size;
    const prescriptionsWritten = prescriptions.filter((prescription) => isThisMonth(prescription.createdAt)).length;
    const referralsMade = labOrders.filter((order) => isThisMonth(order.order_date)).length;
    const ipdAdmissions = admissions.filter((admission) => isThisMonth(admission.admissionDate)).length;
    const avgConsultationTime = doctorRecord?.slot_duration_mins
      ? `${doctorRecord.slot_duration_mins} mins`
      : '15 mins';

    res.json({
      success: true,
      data: {
        monthly_patients: monthlyPatients,
        avg_consultation_time: avgConsultationTime,
        prescriptions_written: prescriptionsWritten,
        referrals_made: referralsMade,
        ipd_admissions: ipdAdmissions,
        lab_orders: referralsMade,
      }
    });
  } catch (err) {
    console.error('Doctor reports error:', err);
    res.json({
      success: true,
      data: {
        monthly_patients: 0,
        avg_consultation_time: '12 mins',
        prescriptions_written: 0,
        referrals_made: 0,
        ipd_admissions: 0,
        lab_orders: 0
      }
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  NEW: Doctor's Assigned Patients & Setup Data
// ═══════════════════════════════════════════════════════════════

// GET /api/doctor/my-patients — Get all patients assigned to logged-in doctor
router.get('/my-patients', protect, async (req, res) => {
  try {
    const userId = req.user.id;

    // Query appointments using the user ID directly (booking stores user ID as doctor_id)
    // Also check tokens with both user ID and HMS_DOCTORS ID for full coverage
    const doctorRecords = await Doctor.findAll({ where: { user_id: userId } });
    const doctorRecord = doctorRecords.length > 0 ? doctorRecords[0] : null;
    const doctorTableId = doctorRecord ? doctorRecord.id : null;

    // 1. Patients from appointments (doctor_id = user ID)
    const { sequelize: seq } = require('../models/db');
    const { QueryTypes } = require('sequelize');

    const appointmentPatients = await seq.query(`
      SELECT DISTINCT p.ID, p.UHID, p.NAME, p.AGE, p.GENDER, p.BLOOD_GROUP,
             p.PHONENUMBER, p.OPDINDOOR, p.PATIENTTYPE, p.PROVDIAGNOSIS,
             p.TESTDATE, p.CREATED_AT, p.IS_ACTIVE,
             a.APPOINTMENT_DATE
      FROM HMS_APPOINTMENTS a
      JOIN HMS_PATIENTS p ON p.ID = a.PATIENT_ID
      WHERE a.DOCTOR_ID = :userId
        AND COALESCE(p.IS_ACTIVE, 1) = 1
      ORDER BY a.APPOINTMENT_DATE DESC
    `, {
      replacements: { userId },
      type: QueryTypes.SELECT
    });

    // 2. Patients from tokens (doctor_id may be HMS_DOCTORS.id or user ID)
    let tokenPatients = [];
    if (doctorTableId) {
      tokenPatients = await seq.query(`
        SELECT DISTINCT p.ID, p.UHID, p.NAME, p.AGE, p.GENDER, p.BLOOD_GROUP,
               p.PHONENUMBER, p.OPDINDOOR, p.PATIENTTYPE, p.PROVDIAGNOSIS,
               p.TESTDATE, p.CREATED_AT, p.IS_ACTIVE,
               t.TOKEN_DATE AS APPOINTMENT_DATE
        FROM HMS_TOKENS t
        JOIN HMS_PATIENTS p ON p.ID = t.PATIENT_ID
        WHERE (t.DOCTOR_ID = :doctorTableId OR t.DOCTOR_ID = :userId)
          AND COALESCE(p.IS_ACTIVE, 1) = 1
        ORDER BY t.TOKEN_DATE DESC
      `, {
        replacements: { doctorTableId, userId },
        type: QueryTypes.SELECT
      });
    }

    // 3. Merge & deduplicate
    const seen = new Set();
    const allPatients = [];
    [...appointmentPatients, ...tokenPatients].forEach(row => {
      if (!seen.has(row.ID)) {
        seen.add(row.ID);
        allPatients.push({
          id: row.ID,
          uhid: row.UHID,
          name: row.NAME,
          age: row.AGE,
          gender: row.GENDER,
          blood_group: row.BLOOD_GROUP,
          phoneNumber: row.PHONENUMBER,
          opdIndoor: row.OPDINDOOR,
          patientType: row.PATIENTTYPE,
          provDiagnosis: row.PROVDIAGNOSIS,
          testDate: row.TESTDATE,
          createdAt: row.CREATED_AT,
          assignedDepartment: null
        });
      }
    });

    res.json({ 
      success: true, 
      data: allPatients,
      total: allPatients.length,
      doctor: {
        id: userId,
        name: req.user.name || req.user.username
      }
    });
  } catch (err) {
    console.error('Error fetching doctor\'s patients:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/doctor/list-doctors — Get all active doctors (for dropdown/assignment)
router.get('/list-doctors', protect, async (req, res) => {
  try {
    const doctors = await Doctor.findAll({
      where: { is_active: 'Y' },
      include: [
        {
          model: User,
          attributes: ['id', 'name', 'username'],
          as: 'user'
        },
        {
          model: Department,
          attributes: ['id', 'name', 'short_code'],
          as: 'department'
        }
      ],
      attributes: ['id', 'user_id', 'department_id', 'speciality', 'qualifications']
    });

    res.json({ 
      success: true, 
      data: doctors
    });
  } catch (err) {
    console.error('Error fetching doctors list:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// GET /api/doctor/list-departments — Get all active departments (for dropdown)
router.get('/list-departments', protect, async (req, res) => {
  try {
    const departments = await Department.findAll({
      where: { is_active: 'Y' },
      attributes: ['id', 'name', 'short_code', 'floor_location'],
      order: [['name', 'ASC']]
    });

    res.json({ 
      success: true, 
      data: departments
    });
  } catch (err) {
    console.error('Error fetching departments list:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// DELETE /api/doctor/prescriptions/:id — Delete a prescription and its items
router.delete('/prescriptions/:id', async (req, res) => {
  try {
    const prescriptionId = parseInt(req.params.id, 10);
    if (isNaN(prescriptionId)) {
      return res.status(400).json({ success: false, message: 'Invalid prescription ID.' });
    }
    
    // Ensure the prescription belongs to this doctor
    const results = await sequelize.query(
      'SELECT ID FROM HMS_PRESCRIPTIONS WHERE ID = :id AND DOCTOR_ID = :doctorId',
      { replacements: { id: prescriptionId, doctorId: req.user.id }, type: QueryTypes.SELECT }
    );
    
    if (!results || results.length === 0) {
      return res.status(404).json({ success: false, message: 'Prescription not found or not yours.' });
    }

    // Delete items first, then prescription
    await sequelize.query('DELETE FROM HMS_PRESCRIPTION_ITEMS WHERE PRESCRIPTION_ID = :id', {
      replacements: { id: prescriptionId }
    });
    await sequelize.query('DELETE FROM HMS_PRESCRIPTIONS WHERE ID = :id', {
      replacements: { id: prescriptionId }
    });

    res.json({ success: true, message: 'Prescription deleted.' });
  } catch (err) {
    console.error('Error deleting prescription:', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

module.exports = router;
