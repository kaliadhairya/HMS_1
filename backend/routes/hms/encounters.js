const express = require('express');
const router = express.Router();
const { Encounter, Patient, User, Department, Token, Diagnosis, Prescription, PrescriptionItem, InvestigationOrder, InvestigationOrderItem } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');
const { logAction } = require('../../utils/auditLogger');
const { clobToString } = require('../../utils/clobToString');
const { Op } = require('sequelize');

// Today's open OPD token / appointment for this patient with this doctor. Tokens and appointments
// store either the doctor's user ID or their HMS_DOCTORS ID, so both are matched.
async function findOpenVisit(patientId, userId, transaction) {
  const [doctorRows] = await sequelize.query(
    'SELECT ID, DEPARTMENT_ID FROM HMS_DOCTORS WHERE USER_ID = :userId ORDER BY ID LIMIT 1',
    { replacements: { userId }, transaction }
  );
  const doctorRow = doctorRows[0] || null;
  const doctorIds = [Number(userId)];
  if (doctorRow && !doctorIds.includes(Number(doctorRow.ID))) doctorIds.push(Number(doctorRow.ID));

  const [tokenRows] = await sequelize.query(`
    SELECT ID, DEPARTMENT_ID FROM HMS_TOKENS
     WHERE PATIENT_ID = :patientId AND DOCTOR_ID IN (:doctorIds)
       AND TRUNC(TOKEN_DATE) = TRUNC(CURRENT_TIMESTAMP)
       AND STATUS = 'Waiting'
     ORDER BY TOKEN_NUMBER ASC LIMIT 1
  `, { replacements: { patientId, doctorIds }, transaction });

  const [appointmentRows] = await sequelize.query(`
    SELECT ID, DEPARTMENT_ID FROM HMS_APPOINTMENTS
     WHERE PATIENT_ID = :patientId AND DOCTOR_ID IN (:doctorIds)
       AND TRUNC(APPOINTMENT_DATE) = TRUNC(CURRENT_TIMESTAMP)
       AND STATUS IN ('Scheduled', 'Checked-in')
     ORDER BY CASE WHEN STATUS = 'Checked-in' THEN 0 ELSE 1 END, SLOT_START ASC LIMIT 1
  `, { replacements: { patientId, doctorIds }, transaction });

  return {
    token: tokenRows[0] || null,
    appointment: appointmentRows[0] || null,
    doctorDepartmentId: doctorRow ? doctorRow.DEPARTMENT_ID : null,
  };
}

// Create a new encounter (Start Consultation)
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { patient_id, token_id, appointment_id, department_id, chief_complaint, encounter_type } = req.body;
    const patientId = Number(patient_id);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    const patient = await Patient.findByPk(patientId, { attributes: ['id'] });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });

    const encounterId = await sequelize.transaction(async (transaction) => {
      // Link the visit the front desk opened today (token and/or appointment), so the queue
      // status, the department and later the appointment completion follow this consultation.
      const open = await findOpenVisit(patientId, Number(req.user.id), transaction);
      const normalizedTokenId = token_id ? Number(token_id) : (open.token ? Number(open.token.ID) : null);
      const normalizedAppointmentId = appointment_id ? Number(appointment_id) : (open.appointment ? Number(open.appointment.ID) : null);
      const resolvedDepartmentId = department_id
        ? Number(department_id)
        : (open.token?.DEPARTMENT_ID ?? open.appointment?.DEPARTMENT_ID ?? open.doctorDepartmentId ?? null);

      const [[{ NEXTVAL: nextId }]] = await sequelize.query(
        "SELECT nextval('hms_encounters_seq') AS \"NEXTVAL\"",
        { transaction }
      );

      await sequelize.query(`
        INSERT INTO HMS_ENCOUNTERS (
          ID, PATIENT_ID, DOCTOR_ID, DEPARTMENT_ID, TOKEN_ID, APPOINTMENT_ID,
          CHIEF_COMPLAINT, ENCOUNTER_DATE, ENCOUNTER_TYPE, STATUS
        ) VALUES (
          :id, :patientId, :doctorId, :departmentId, :tokenId, :appointmentId,
          :chiefComplaint, CURRENT_TIMESTAMP, :encounterType, 'Draft'
        )
      `, {
        replacements: {
          id: nextId,
          patientId,
          doctorId: Number(req.user.id),
          departmentId: resolvedDepartmentId ? Number(resolvedDepartmentId) : null,
          tokenId: normalizedTokenId,
          appointmentId: normalizedAppointmentId,
          chiefComplaint: chief_complaint || null,
          encounterType: encounter_type || 'OPD',
        },
        transaction,
      });

      if (normalizedTokenId) {
        await Token.update(
          { status: 'In Consultation' },
          { where: { id: normalizedTokenId }, transaction }
        );
      }

      return nextId;
    });

    const encounter = await Encounter.findByPk(encounterId);

    // Log Action
    await logAction(req.user.id, 'CREATE', 'encounter', encounter.id, null, encounter.toJSON(), req.ip);
    
    res.status(201).json(encounter);
  } catch (error) {
    console.error('Error creating encounter:', error);
    res.status(500).json({ error: 'Failed to create encounter' });
  }
});

// Update Encounter (Autosave endpoint)
// Partial update: only the note fields present in the body are written. Callers that save a
// subset (the prescription slip sends chief_complaint and current_medications only) used to
// overwrite every other field with NULL, wiping the consultation history and examination.
const NOTE_FIELDS = {
  chief_complaint: 'CHIEF_COMPLAINT',
  hopi: 'HOPI',
  past_medical_history: 'PAST_MEDICAL_HISTORY',
  surgical_history: 'SURGICAL_HISTORY',
  family_history: 'FAMILY_HISTORY',
  social_history: 'SOCIAL_HISTORY',
  current_medications: 'CURRENT_MEDICATIONS',
  general_examination: 'GENERAL_EXAMINATION',
  cvs_findings: 'CVS_FINDINGS',
  rs_findings: 'RS_FINDINGS',
  abdomen_findings: 'ABDOMEN_FINDINGS',
  cns_findings: 'CNS_FINDINGS',
};

router.put('/:id', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const encounterId = Number(req.params.id);

    // Get current status safely
    const [rows] = await sequelize.query(
      'SELECT STATUS FROM HMS_ENCOUNTERS WHERE ID = :id', 
      { replacements: { id: encounterId } }
    );
    
    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: 'Encounter not found' });
    }
    
    if (rows[0].STATUS === 'Finalized') {
      return res.status(400).json({ error: 'Cannot edit finalized encounter' });
    }

    const sets = [];
    const replacements = { id: encounterId };
    for (const [key, column] of Object.entries(NOTE_FIELDS)) {
      if (!Object.prototype.hasOwnProperty.call(req.body, key)) continue;
      sets.push(`${column} = :${key}`);
      replacements[key] = req.body[key] || null;
    }

    if (sets.length > 0) {
      await sequelize.query(`UPDATE HMS_ENCOUNTERS SET ${sets.join(', ')} WHERE ID = :id`, { replacements });
    }

    res.json({ success: true, id: encounterId });
  } catch (error) {
    console.error('Error updating encounter:', error);
    res.status(500).json({ error: 'Failed to update encounter' });
  }
});

// Finalize Encounter
router.patch('/:id/finalize', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    if (encounter.status === 'Finalized') {
      return res.status(400).json({ error: 'Encounter is already finalized' });
    }

    // Wrap all status transitions in a single atomic transaction
    await sequelize.transaction(async (t) => {
      await encounter.update({ status: 'Finalized' }, { transaction: t });

      // Mark token as Done
      if (encounter.token_id) {
        const token = await Token.findByPk(encounter.token_id, { transaction: t });
        if (token) {
          await token.update({ status: 'Done' }, { transaction: t });
        }
      }

      // The booked appointment for this visit is now complete
      if (encounter.appointment_id) {
        await sequelize.query(
          "UPDATE HMS_APPOINTMENTS SET STATUS = 'Completed' WHERE ID = :id AND STATUS IN ('Scheduled', 'Checked-in')",
          { replacements: { id: encounter.appointment_id }, transaction: t }
        );
      }

      // Mark Prescription as Finalized and Generate QR Code data
      const prescriptionRows = await Prescription.findAll({ where: { encounter_id: encounter.id }, transaction: t });
      const prescription = prescriptionRows.length > 0 ? prescriptionRows[0] : null;
      if (prescription) {
        // Create a secure hash payload for the QR
        const qrPayload = Buffer.from(JSON.stringify({
          p: prescription.id,
          e: encounter.id,
          d: encounter.doctor_id,
          t: new Date().getTime()
        })).toString('base64');
        
        await prescription.update({ 
          status: 'Finalized',
          qr_data: qrPayload 
        }, { transaction: t });
      }
    });

    await logAction(req.user.id, 'FINALIZED', 'encounter', encounter.id, { status: 'Draft' }, { status: 'Finalized' }, req.ip);

    res.json({ message: 'Encounter finalized successfully', encounter });
  } catch (error) {
    console.error('Error finalizing encounter:', error);
    res.status(500).json({ error: 'Failed to finalize encounter' });
  }
});

// Get Encounter with full details (Diagnoses, Prescriptions, Orders)
router.get('/:id', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const encounter = await Encounter.findByPk(req.params.id, {
      include: [
        { model: Patient, as: 'patient' },
        { model: User, as: 'doctor', attributes: ['id', 'name', 'role'] },
        { model: Diagnosis, as: 'diagnoses' },
        { 
          model: Prescription, 
          as: 'prescriptions',
          include: [{ model: PrescriptionItem, as: 'items' }]
        },
        { 
          model: InvestigationOrder, 
          as: 'investigationOrders',
          include: [{ model: InvestigationOrderItem, as: 'items' }]
        }
      ]
    });
    
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    
    const data = encounter.toJSON();
    const clobFields = ['chief_complaint', 'hopi', 'past_medical_history', 'surgical_history', 'family_history', 'social_history', 'current_medications', 'general_examination', 'cvs_findings', 'rs_findings', 'abdomen_findings', 'cns_findings'];
    for (const f of clobFields) {
      if (data[f]) data[f] = await clobToString(data[f]);
    }
    if (data.diagnoses) {
      for (const d of data.diagnoses) {
        if (d.clinical_notes) d.clinical_notes = await clobToString(d.clinical_notes);
      }
    }
    if (data.prescriptions && data.prescriptions.length > 0) {
      for (const p of data.prescriptions) {
        if (p.notes) p.notes = await clobToString(p.notes);
      }
    }
    res.json(data);
  } catch (error) {
    console.error('Error fetching encounter:', error);
    res.status(500).json({ error: 'Failed to fetch encounter' });
  }
});

// Get Patient Encounter History
router.get('/patient/:patient_id', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const encounters = await Encounter.findAll({
      where: { patient_id: req.params.patient_id },
      order: [['encounter_date', 'DESC']],
      include: [
        { model: User, as: 'doctor', attributes: ['id', 'name'] },
        { model: Department, as: 'department', attributes: ['id', 'name'] },
        { model: Diagnosis, as: 'diagnoses', attributes: ['icd10_code', 'icd10_description'] }
      ]
    });
    
    // Process CLOBs for history list
    const parsed = await Promise.all(encounters.map(async enc => {
      const e = enc.toJSON();
      e.chief_complaint = await clobToString(e.chief_complaint);
      return e;
    }));
    
    res.json(parsed);
  } catch (error) {
    console.error('Error fetching patient encounters:', error);
    res.status(500).json({ error: 'Failed to fetch encounters' });
  }
});

module.exports = router;
