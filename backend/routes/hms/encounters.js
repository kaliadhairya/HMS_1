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

// Both public API versions call the same typed encounter command.
const EncounterCommands = require('../../services/clinicalEncounters.cts');
router.post('/', protect, checkPermission('consultation','write'), requireCurrentPractitioner, async (req,res) => {
  try {
    const created=await sequelize.transaction(t=>EncounterCommands.create(req.body,req.user,t));
    const encounter=await Encounter.findByPk(created.id);
    await logAction(req.user.id,'CREATE','encounter',created.id,null,{patient_id:created.patient_id,encounter_id:created.id},req.ip);
    res.status(201).json({...encounter.toJSON(),public_id:created.public_id,api_version:created.api_version});
  } catch(error) {
    if(error.status)return res.status(error.status).json({success:false,code:error.code,message:error.message});
    console.error('Encounter creation failed:',error.original?.code||error.code||error.name);
    res.status(500).json({success:false,code:'ENCOUNTER_CREATE_FAILED',message:'The consultation could not be confirmed.'});
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
    const I=require('../../services/identities.cts');
    const identity=await I.locate('encounter',req.params.id,req.user,undefined,true);
    const approved=await require('../../services/clinicalV2.cts').readEncounter(identity.public_id,req.user);
    const encounter = await Encounter.findByPk(identity.id, {
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
    res.locals.auditPatientId=Number(encounter.patient_id);
    res.set('ETag',`"${encounter.record_revision}"`);
    const data = {...encounter.toJSON(),public_id:approved.id,api_version:approved.version};
    if(data.notes_document_id){
      const [signed]=await sequelize.query('SELECT s.content,s.version,s.digest FROM hms_document_signatures s WHERE s.document_id=:id ORDER BY s.version DESC LIMIT 1',{replacements:{id:data.notes_document_id},type:'SELECT'});
      if(signed){if(require('../../services/clinicalDocuments.cts').digestOf(signed.content)!==signed.digest)throw Object.assign(new Error('Signed record integrity failed.'),{status:503,code:'SIGNED_RECORD_INTEGRITY_FAILED'});for(const field of Notes.fields)if(field in signed.content)data[field]=signed.content[field];data.signed_note_version=Number(signed.version);}
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
    if(error.status)return res.status(error.status).json({success:false,code:error.code,message:error.message});
    console.error('Error fetching encounter:', error.original?.code||error.name);
    res.status(500).json({ error: 'Failed to fetch encounter' });
  }
});

// Get Patient Encounter History
router.get('/patient/:patient_id', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const I=require('../../services/identities.cts');
    const identity=await I.locate('patient',req.params.patient_id,req.user,undefined,true);
    await require('../../services/clinicalV2.cts').patient(identity.public_id,req.user);
    await require('../../services/facilities.cts').requirePrivilege(req.user,'CHART_READ');
    res.locals.auditPatientId=Number(identity.id);
    const ids=await sequelize.query('SELECT id FROM hms_encounters WHERE patient_id=:patient AND facility_id=:facility',{replacements:{patient:identity.id,facility:req.user.facilityId},type:'SELECT'});
    const encounters = await Encounter.findAll({
      where: { id:ids.map(r=>r.id) },
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
    if(error.status)return res.status(error.status).json({success:false,code:error.code,message:error.message});
    console.error('Error fetching patient encounters:', error.original?.code||error.name);
    res.status(500).json({ error: 'Failed to fetch encounters' });
  }
});

module.exports = router;
