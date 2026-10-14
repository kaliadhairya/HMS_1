const express = require('express');
const router = express.Router();
const { Encounter, Patient, User, Department, Token, Diagnosis, Prescription, PrescriptionItem, InvestigationOrder, InvestigationOrderItem } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');
const { requireCurrentPractitioner } = require('../../utils/practitioners');
const { patientInCare, ensureCareTeam, NOT_IN_CARE } = require('../../utils/careTeam');
const { logAction } = require('../../utils/auditLogger');
const { clobToString } = require('../../utils/clobToString');
const { Op } = require('sequelize');

// Today's open OPD token / appointment for this patient with this doctor (both store the doctor's user ID).
async function findOpenVisit(patientId, userId, transaction) {
  const [doctorRows] = await sequelize.query(
    'SELECT ID, DEPARTMENT_ID FROM HMS_DOCTORS WHERE USER_ID = :userId ORDER BY ID LIMIT 1',
    { replacements: { userId }, transaction }
  );
  const doctorRow = doctorRows[0] || null;
  const doctorIds = [Number(userId)];

  const [tokenRows] = await sequelize.query(`
    SELECT ID, DEPARTMENT_ID FROM HMS_TOKENS
     WHERE PATIENT_ID = :patientId AND DOCTOR_ID IN (:doctorIds)
       AND TRUNC(TOKEN_DATE) = hms_service_today()
       AND STATUS = 'Waiting'
     ORDER BY TOKEN_NUMBER ASC LIMIT 1
  `, { replacements: { patientId, doctorIds }, transaction });

  const [appointmentRows] = await sequelize.query(`
    SELECT ID, DEPARTMENT_ID FROM HMS_APPOINTMENTS
     WHERE PATIENT_ID = :patientId AND DOCTOR_ID IN (:doctorIds)
       AND TRUNC(APPOINTMENT_DATE) = hms_service_today()
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
router.post('/', protect, checkPermission('consultation', 'write'), requireCurrentPractitioner, async (req, res) => {
  try {
    const { patient_id, token_id, appointment_id, department_id, chief_complaint, encounter_type } = req.body;
    const patientId = Number(patient_id);
    if (!Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'patient_id is required' });
    }
    const patient = await Patient.findByPk(patientId, { attributes: ['id'] });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, patientId))) {
      return res.status(403).json({ success: false, code: 'PATIENT_NOT_IN_CARE', message: NOT_IN_CARE });
    }

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

// Notes and signatures share the command receipt, row lock, audit and outbox.
const Notes = require('../../services/encounterNotes.cts');
const noteCommand = (action) => async (req,res) => {
  try {
    const result=await sequelize.transaction(t=>Notes[action](Number(req.params.id),req.user,
      ...(action==='save'?[req.body,req.get('if-match'),t]:[req.get('if-match'),t])));
    res.set('ETag',`"${result.revision}"`).json({success:true,...result});
  } catch(error) {
    if(error.status)return res.status(error.status).json({success:false,code:error.code,message:error.message,...(error.current?{current:error.current}:{})});
    console.error('Encounter note command failed:',error.original?.message||error.message);
    res.status(500).json({success:false,message:'Could not save the clinical record. Your draft should be preserved.'});
  }
};
router.put('/:id',protect,checkPermission('consultation','write'),requireCurrentPractitioner,noteCommand('save'));
router.patch('/:id/finalize',protect,checkPermission('consultation','write'),requireCurrentPractitioner,noteCommand('sign'));

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
    if(req.user.role==='doctor'&&!(await patientInCare(req.user.id,encounter.patient_id)))return res.status(403).json({success:false,code:'PATIENT_NOT_IN_CARE',message:NOT_IN_CARE});
    res.set('ETag',`"${encounter.record_revision}"`);
    const data = encounter.toJSON();
    if(data.notes_document_id){
      const [signed]=await sequelize.query('SELECT s.content,s.version FROM hms_document_signatures s WHERE s.document_id=:id ORDER BY s.version DESC LIMIT 1',{replacements:{id:data.notes_document_id},type:'SELECT'});
      if(signed){Object.assign(data,signed.content);data.signed_note_version=Number(signed.version);}
    }
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
