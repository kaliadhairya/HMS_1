const express = require('express');
const router = express.Router();
const { Prescription, PrescriptionItem, Medicine, Patient, User, Encounter, Diagnosis } = require('../../models');
const { sequelize } = require('../../models/db');
const C = require('../../services/medicationCommon');
const { publish } = require('../../utils/outbox');
const { protect, checkPermission, restrictTo } = require('../../middleware/auth');

function canReadPrescription(req) {
  return ['super_admin', 'admin', 'doctor', 'receptionist', 'nurse', 'pharmacist'].includes(req.user?.role);
}

function normalizeDurationDays(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return value;
  const match = String(value).match(/\d+/);
  return match ? Number(match[0]) : null;
}

function normalizePrescriptionItem(item) {
  const displayName = String(item.medicine_name || item.name || '').trim();
  const genericName = String(
    item.generic_name ||
    item.genericName ||
    (displayName.includes('(') ? displayName.split('(')[0].trim() : displayName)
  ).trim();

  return {
    medicine_name: displayName || genericName,
    generic_name: genericName || null,
    dose: item.dose || item.dosage || null,
    dose_unit: item.dose_unit || item.doseUnit || null,
    route: item.route || null,
    frequency: item.frequency || null,
    duration_days: normalizeDurationDays(item.duration_days ?? item.duration),
    instructions: item.instructions || null,
    is_iv_fluid: Number(item.is_iv_fluid ? 1 : 0),
    iv_rate: item.iv_rate || item.ivRate || null,
    iv_duration: item.iv_duration || item.ivDuration || null,
  };
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
    WHERE pi.PRESCRIPTION_ID = :prescriptionId
    ORDER BY pi.ID ASC
  `, { replacements: { prescriptionId } });

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

// Initialize a prescription for an encounter
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const {
      encounter_id,
      patient_id,
      employee_name,
      employee_no,
      department_name,
      diagnosis,
      status,
      type,
    } = req.body;
    
    // Check if one exists; the change and the pharmacists' notification commit together.
    const prescription = await sequelize.transaction(async (transaction) => {
      const encounter = await C.one('SELECT id,patient_id,status FROM hms_encounters WHERE id=:id FOR UPDATE', {id:C.integer(encounter_id, 'Encounter')}, transaction);
      C.check(encounter && encounter.patient_id===Number(patient_id), 'PATIENT_ENCOUNTER_MISMATCH', 'Legacy note must belong to the encounter patient.');
      const prescriptions = await Prescription.findAll({ where: { encounter_id }, transaction });
      let current = prescriptions.length > 0 ? prescriptions[0] : null;
      if (!current) {
        C.check(encounter.status!=='Finalized','ENCOUNTER_FINALIZED','Finalized encounters cannot acquire a new legacy prescription.',400);
        const [[{ NEXTVAL: nextId }]] = await sequelize.query(
          "SELECT nextval('hms_prescriptions_seq') AS \"NEXTVAL\"", { transaction }
        );

        current = await Prescription.create({
          id: nextId,
          encounter_id,
          patient_id,
          doctor_id: req.user.id,
          status: 'Pending',
          type: type || 'OPD'
        }, { transaction });
      } else if (encounter.status!=='Finalized') {
        await current.update({ type: current.type || type || 'OPD' }, { transaction });
      } else return current;
      await publish('new_prescription', 'pharmacist', {
        id: current.id,
        patient_id: current.patient_id,
        doctor_id: current.doctor_id
      }, { transaction });
      return current;
    });

    res.status(200).json(prescription);
  } catch (error) {
    if (error.status) return res.status(error.status).json({code:error.code,error:error.message});
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription shell' });
  }
});

// Save ALL items for a prescription (Full replace for simplicity of autosave)
router.put('/:id/items', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const prescription_id = req.params.id;
    const { items, status } = req.body; // Array of item objects

    // A finalized consultation's prescription is what the pharmacy dispenses from; it must not change.
    const [owner] = await sequelize.query(`
      SELECT p.ID, e.STATUS AS ENCOUNTER_STATUS
        FROM HMS_PRESCRIPTIONS p
        LEFT JOIN HMS_ENCOUNTERS e ON e.ID = p.ENCOUNTER_ID
       WHERE p.ID = :id
    `, { replacements: { id: Number(prescription_id) } });
    if (!owner || owner.length === 0) return res.status(404).json({ error: 'Prescription not found' });
    if (owner[0].ENCOUNTER_STATUS === 'Finalized') {
      return res.status(400).json({ error: 'The consultation is finalized; its prescription can no longer be changed' });
    }
    
    // Free-text medicines are NOT added to the medicine catalogue any more: that created 0-stock
    // catalogue entries (category 'Prescription') for every typed name, cluttering the catalogue and
    // low-stock lists and making the pharmacy show "Out of stock" instead of "Not in catalogue".
    // Historical free text stays unlinked; it never authorizes coded medication supply.

    // Step 2: Atomic delete-then-insert inside a transaction (prevents data loss if insert fails)
    await sequelize.transaction(async (t) => {
      const current = await C.one('SELECT e.id,e.status FROM hms_encounters e JOIN hms_prescriptions p ON p.encounter_id=e.id WHERE p.id=:id FOR UPDATE OF e', {id:Number(prescription_id)}, t);
      C.check(current && current.status!=='Finalized','ENCOUNTER_FINALIZED','The consultation is finalized; its prescription can no longer be changed',400);
      await C.q('SELECT id FROM hms_prescriptions WHERE id=:id FOR UPDATE', {id:Number(prescription_id)}, t);
      // Clear existing items
      await PrescriptionItem.destroy({ where: { prescription_id }, transaction: t });

      // Insert new items
      if (items && items.length > 0) {
        const nextRows = await Promise.all(
          items.map(() =>
            sequelize.query("SELECT nextval('hms_presc_items_seq') AS \"NEXTVAL\"", { transaction: t })
          )
        );

        const itemsToInsert = items.map((item, index) => ({
          id: Number(nextRows[index][0][0].NEXTVAL),
          ...normalizePrescriptionItem(item),
          prescription_id: Number(prescription_id)
        }));
        await PrescriptionItem.bulkCreate(itemsToInsert, { transaction: t });

        await Prescription.update(
          { status: 'Consulted' },
          { where: { id: prescription_id }, transaction: t }
        );
      }
      await publish('prescription_items_updated', 'pharmacist', { prescription_id }, { transaction: t });
    });

    // Fetch and return the updated lists
    const updatedItems = await resolveItemsForRead(prescription_id);
    res.json(updatedItems);
  } catch (error) {
    if (error.status) return res.status(error.status).json({code:error.code,error:error.message});
    if (error.name === 'SequelizeForeignKeyConstraintError') {
      return res.status(409).json({ error: 'Some of these medicines have already been given to the patient, so the prescription lines cannot be replaced.' });
    }
    console.error('Error updating prescription items:', error);
    res.status(500).json({ error: 'Failed to update prescription items' });
  }
});

// ... (GET logic remains same)

// Update prescription status
router.patch('/:id/status', protect, checkPermission('consultation', 'write'), async (req, res) => {
  return res.status(409).json({ error: 'Legacy prescription status does not authorize supply. Use the coded medication order sign, hold, resume and discontinue commands.', code: 'CODED_ORDER_REQUIRED' });
});

// Get Prescription by Encounter ID
router.get('/encounter/:encounter_id', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const [prescriptions] = await sequelize.query(`
      SELECT p.*, e.CHIEF_COMPLAINT as "diagnosis"
      FROM HMS_PRESCRIPTIONS p
      LEFT JOIN HMS_ENCOUNTERS e ON e.ID = p.ENCOUNTER_ID
      WHERE p.ENCOUNTER_ID = :encounter_id
    `, {
      replacements: { encounter_id: req.params.encounter_id }
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
    const idReplacements = {};
    relatedPatientIds.forEach((id, i) => { idReplacements[`pid${i}`] = id; });

    const [prescriptionRows] = await sequelize.query(`
      SELECT p.ID, p.ENCOUNTER_ID, p.PATIENT_ID, p.DOCTOR_ID, p.STATUS, p.TYPE,
             p.CREATED_AT, p.UPDATED_AT,
             u.NAME AS DOCTOR_NAME
      FROM HMS_PRESCRIPTIONS p
      LEFT JOIN HMS_USERS u ON u.ID = p.DOCTOR_ID
      WHERE p.PATIENT_ID IN (${idPlaceholders})
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
