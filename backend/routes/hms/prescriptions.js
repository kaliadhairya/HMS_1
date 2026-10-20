const express = require('express');
const router = express.Router();
const { Prescription, Patient, User, Encounter, Diagnosis } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission, restrictTo } = require('../../middleware/auth');

router.use(protect);
router.use(async(req,res,next)=>{
 if(req.method!=='GET')return next();
 try{
  const parts=req.path.split('/').filter(Boolean),kind=parts[0]==='patient'?'patient':parts[0]==='encounter'?'encounter':'prescription';
  res.locals.auditPatientId=await require('../../services/clinicalReadAccess.cts').historicalPrescription(req.user,kind,Number(parts[kind==='prescription'?0:1]));
  res.set('Cache-Control','no-store');return next();
 }catch(error){const failure=require('../../services/clinicalApiErrors.cts').response(error);return res.status(failure.status).json(failure.body);}
});

function canReadPrescription(req) {
  return ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse', 'pharmacist'].includes(req.user?.role);
}

async function resolveItemsForRead(prescriptionId) {
  const [rows] = await sequelize.query(`
    SELECT
      pi.ID,
      pi.PRESCRIPTION_ID,
      pi.MEDICINE_NAME,
      pi.GENERIC_NAME,
      pi.DOSE,
      pi.DOSE_UNIT,
      pi.ROUTE,
      pi.FREQUENCY,
      pi.DURATION_DAYS,
      pi.INSTRUCTIONS,
      pi.IS_IV_FLUID,
      pi.IV_RATE,
      pi.IV_DURATION,
      pi.CREATED_AT,
      pi.UPDATED_AT
    FROM HMS_PRESCRIPTION_ITEMS pi
    WHERE pi.PRESCRIPTION_ID = :prescriptionId AND pi.facility_id = :facility
    ORDER BY pi.ID ASC
  `, { replacements: { prescriptionId,facility:require('../../services/facilities.cts').currentFacilityId() } });

  return rows.map((row) => {
    const rId = row.ID ?? row.id;
    const rPresId = row.PRESCRIPTION_ID ?? row.prescription_id;
    const rMedName = row.MEDICINE_NAME ?? row.medicine_name;
    const rGenName = row.GENERIC_NAME ?? row.generic_name;
    const rDose = row.DOSE ?? row.dose;
    const rDoseUnit = row.DOSE_UNIT ?? row.dose_unit;
    const rRoute = row.ROUTE ?? row.route;
    const rFreq = row.FREQUENCY ?? row.frequency;
    const rDurDays = row.DURATION_DAYS ?? row.duration_days;
    const rInstr = row.INSTRUCTIONS ?? row.instructions;
    const rIsIv = row.IS_IV_FLUID ?? row.is_iv_fluid;
    const rIvRate = row.IV_RATE ?? row.iv_rate;
    const rIvDur = row.IV_DURATION ?? row.iv_duration;
    const rCreatedAt = row.CREATED_AT ?? row.created_at;
    const rUpdatedAt = row.UPDATED_AT ?? row.updated_at;

    return {
      id: rId,
      prescription_id: rPresId,
      medicine_id: null,
      legacy: true,
      reconciliation_required: true,
      medicine_name: rMedName,
      generic_name: rGenName,
      dose: rDose,
      dose_unit: rDoseUnit,
      dosage: rDose,
      route: rRoute,
      frequency: rFreq,
      duration_days: rDurDays,
      duration: rDurDays ? `${rDurDays} days` : null,
      instructions: rInstr,
      is_iv_fluid: rIsIv,
      iv_rate: rIvRate,
      iv_duration: rIvDur,
      created_at: rCreatedAt,
      updated_at: rUpdatedAt,
    };
  });
}

// Historical text is retained for review/printing, never authored or replaced.
const retired=(req,res)=>res.status(410).json({success:false,code:'LEGACY_PRESCRIPTION_RETIRED',message:'Create, sign or change medicines through coded medication orders. Historical prescription text is read-only.'});
router.post('/',protect,retired);
router.put('/:id/items',protect,retired);
router.patch('/:id/status',protect,retired);

// Get Prescription by Encounter ID
router.get('/encounter/:encounter_id', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const [prescriptions] = await sequelize.query(`
      SELECT p.*, e.CHIEF_COMPLAINT as "diagnosis"
      FROM HMS_PRESCRIPTIONS p
      LEFT JOIN HMS_ENCOUNTERS e ON e.ID = p.ENCOUNTER_ID
      WHERE p.ENCOUNTER_ID = :encounter_id AND p.facility_id = :facility
    `, {
      replacements: { encounter_id: req.params.encounter_id,facility:req.user.facilityId }
    });

    if (!prescriptions || prescriptions.length === 0) {
      return res.status(404).json({ error: 'Not found' });
    }
    
    const prescription = prescriptions[0];
    const items = await resolveItemsForRead(prescription.id ?? prescription.ID);
    
    // Normalize keys to lowercase for the frontend
    const responsePayload = {
      id: prescription.ID,
      encounter_id: prescription.ENCOUNTER_ID,
      patient_id: prescription.PATIENT_ID,
      doctor_id: prescription.DOCTOR_ID,
      status: prescription.STATUS,
      type: prescription.TYPE,
      diagnosis: prescription.diagnosis,
      items
    };
    
    res.json(responsePayload);
  } catch (error) {
    console.error('Error fetching prescription:', error);
    res.status(500).json({ error: 'Failed to fetch prescription' });
  }
});

router.get('/patient/:patient_id', protect, restrictTo('super_admin','admin','doctor','receptionist','nurse','pharmacist'), async (req, res) => {
  try {
    if (!canReadPrescription(req)) {
      return res.status(403).json({ error: 'Not authorized to access prescriptions' });
    }

    const patientId = req.params.patient_id;

    // Identity links belong to Phase 2. Never union charts by names or phone numbers.
    const relatedPatientIds = [Number(patientId)];

    // Step 2: Fetch prescriptions for ALL related patient IDs
    const idPlaceholders = relatedPatientIds.map((_, i) => `:pid${i}`).join(', ');
    const idReplacements = {facility:req.user.facilityId};
    relatedPatientIds.forEach((id, i) => { idReplacements[`pid${i}`] = id; });

    const [prescriptionRows] = await sequelize.query(`
      SELECT p.ID, p.ENCOUNTER_ID, p.PATIENT_ID, p.DOCTOR_ID, p.STATUS, p.TYPE,
             p.CREATED_AT, p.UPDATED_AT,
             u.NAME AS DOCTOR_NAME
      FROM HMS_PRESCRIPTIONS p
      LEFT JOIN HMS_USERS u ON u.ID = p.DOCTOR_ID
      WHERE p.PATIENT_ID IN (${idPlaceholders}) AND p.facility_id = :facility
      ORDER BY p.ID DESC
    `, { replacements: idReplacements });

    const enriched = await Promise.all(
      prescriptionRows.map(async (row) => {
        const rowId = row.ID ?? row.id;
        const rowEncId = row.ENCOUNTER_ID ?? row.encounter_id;
        const rowPatId = row.PATIENT_ID ?? row.patient_id;
        const rowDocId = row.DOCTOR_ID ?? row.doctor_id;
        const rowDocName = row.DOCTOR_NAME ?? row.doctor_name;
        const rowStatus = row.STATUS ?? row.status;
        const rowType = row.TYPE ?? row.type;
        const rowCreatedAt = row.CREATED_AT ?? row.created_at;

        const items = await resolveItemsForRead(rowId);
        return {
          id: rowId,
          encounter_id: rowEncId,
          patient_id: rowPatId,
          doctor_id: rowDocId,
          doctor_name: rowDocName || 'Doctor',
          status: rowStatus,
          type: rowType,
          created_at: rowCreatedAt,
          items,
        };
      })
    );

    res.json(enriched);
  } catch (error) {
    console.error('Error fetching patient prescriptions:', error);
    res.status(500).json({ error: 'Failed to fetch patient prescriptions' });
  }
});

router.get('/:id', protect, async (req, res) => {
  try {
    if (!canReadPrescription(req)) {
      return res.status(403).json({ success: false, message: 'Not authorized to access prescription details' });
    }

    const prescription = await Prescription.findByPk(req.params.id, {
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'name', 'uhid', 'age', 'gender'] },
        { model: User, as: 'doctor', attributes: ['id', 'name', 'role'] },
        {
          model: Encounter,
          as: 'encounter',
          attributes: ['id', 'chief_complaint', 'encounter_date'],
          include: [{ model: Diagnosis, as: 'diagnoses', attributes: ['id', 'icd10_description'] }],
        },
      ],
    });
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }

    const items = await resolveItemsForRead(prescription.id);
    const payload = prescription.toJSON();

    res.json({
      success: true,
      data: {
        ...payload,
        created_at: payload.createdAt || payload.CREATED_AT || null,
        items,
      },
    });
  } catch (error) {
    console.error('Error fetching prescription by id:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch prescription' });
  }
});

module.exports = router;
