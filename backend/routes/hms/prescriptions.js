const express = require('express');
const router = express.Router();
const { Prescription, PrescriptionItem, Medicine, Patient, User, Encounter, Diagnosis } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');

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

  const [medicines] = await sequelize.query(`
    SELECT ID, GENERIC_NAME, STRENGTH, STRENGTH_UNIT
    FROM HMS_MEDICINES
    WHERE IS_ACTIVE = 1
  `);

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

    const baseName = String(rGenName || rMedName || '')
      .split('(')[0]
      .trim()
      .toUpperCase();
    const matchedMedicine = medicines.find((medicine) => {
      const mGenName = medicine.GENERIC_NAME ?? medicine.generic_name;
      const medicineName = String(mGenName || '').trim().toUpperCase();
      return medicineName && medicineName === baseName;
    });

    const mId = matchedMedicine ? (matchedMedicine.ID ?? matchedMedicine.id) : null;

    return {
      id: rId,
      prescription_id: rPresId,
      medicine_id: mId || null,
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
    
    // Check if one exists
    const prescriptions = await Prescription.findAll({ where: { encounter_id } });
    let prescription = prescriptions.length > 0 ? prescriptions[0] : null;
    if (!prescription) {
      const [[{ NEXTVAL: nextId }]] = await sequelize.query(
        "SELECT nextval('hms_prescriptions_seq') AS \"NEXTVAL\""
      );

      prescription = await Prescription.create({
        id: nextId,
        encounter_id,
        patient_id,
        doctor_id: req.user.id,
        status: status || 'Pending',
        type: type || 'OPD'
      });
    } else {
      await prescription.update({
        type: prescription.type || type || 'OPD',
        status: status || prescription.status || 'Pending',
      });
    }
    
    // Emit real-time notification to Pharmacists
    const io = req.app.get('io');
    if (io) {
      io.to('pharmacist').emit('new_prescription', {
        id: prescription.id,
        patient_id: prescription.patient_id,
        doctor_id: prescription.doctor_id
      });
    }

    res.status(200).json(prescription);
  } catch (error) {
    console.error('Error creating prescription:', error);
    res.status(500).json({ error: 'Failed to create prescription shell' });
  }
});

// Save ALL items for a prescription (Full replace for simplicity of autosave)
router.put('/:id/items', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const prescription_id = req.params.id;
    const { items, status } = req.body; // Array of item objects
    
    // Step 1: Auto-save new medicines to the Medicine Master table (non-critical, outside transaction)
    if (items && items.length > 0) {
      for (const item of items) {
        try {
          const generic = (item.generic_name || item.medicine_name || '').trim();
          if (!generic) continue;

          const existingMeds = await Medicine.findAll({
            where: sequelize.where(
              sequelize.fn('UPPER', sequelize.col('GENERIC_NAME')),
              generic.toUpperCase()
            )
          });
          const existing = existingMeds.length > 0 ? existingMeds[0] : null;

          if (!existing) {
            const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_medicines_seq') AS \"NEXTVAL\"");
            await Medicine.create({
              id: nextId,
              genericName: generic,
              formulation: item.dose_unit || 'Tablet',
              strength: item.dose || '',
              category: 'Prescription',
              isActive: 1,
            });
          }
        } catch (err) {
          console.error('Failed to auto-save medicine to master:', err);
          // Non-fatal, continue saving prescription
        }
      }
    }

    // Step 2: Atomic delete-then-insert inside a transaction (prevents data loss if insert fails)
    await sequelize.transaction(async (t) => {
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
          { status: status || 'Consulted' },
          { where: { id: prescription_id }, transaction: t }
        );
      }
    });
    
    // Notify Pharmacist that items were updated
    const io = req.app.get('io');
    if (io) io.to('pharmacist').emit('prescription_items_updated', { prescription_id });

    // Fetch and return the updated lists
    const updatedItems = await resolveItemsForRead(prescription_id);
    res.json(updatedItems);
  } catch (error) {
    console.error('Error updating prescription items:', error);
    res.status(500).json({ error: 'Failed to update prescription items' });
  }
});

// ... (GET logic remains same)

// Update prescription status
router.patch('/:id/status', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { status } = req.body;
    const prescription = await Prescription.findByPk(req.params.id);
    if (!prescription) return res.status(404).json({ error: 'Not found' });
    await prescription.update({ status });

    // Emit socket event
    const io = req.app.get('io');
    if (io) {
      io.to('pharmacist').emit('prescription_status_change', { id: prescription.id, status });
      io.to('doctor').emit('prescription_status_change', { id: prescription.id, status });
    }

    res.json(prescription);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update status' });
  }
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

router.get('/patient/:patient_id', protect, async (req, res) => {
  try {
    if (!canReadPrescription(req)) {
      return res.status(403).json({ error: 'Not authorized to access prescriptions' });
    }

    const patientId = req.params.patient_id;

    // Step 1: Find all related patient IDs (same person, different registrations)
    // For corporate employees: match by EMPNUMBER + NAME
    // For others: match by NAME + PHONENUMBER
    const [currentPatient] = await sequelize.query(
      `SELECT ID, NAME, EMPNUMBER, PHONENUMBER, PATIENTTYPE FROM HMS_PATIENTS WHERE ID = :patientId`,
      { replacements: { patientId } }
    );

    let relatedPatientIds = [Number(patientId)];

    if (currentPatient.length > 0) {
      const pat = currentPatient[0];
      let relatedRows = [];

      if ((pat.PATIENTTYPE === 'corporate_employee' || pat.PATIENTTYPE === 'cisf_employee') && pat.EMPNUMBER && pat.NAME) {
        // Corporate: match by employee number + name (same dependent)
        [relatedRows] = await sequelize.query(
          `SELECT ID FROM HMS_PATIENTS WHERE EMPNUMBER = :empNum AND UPPER(NAME) = UPPER(:name) AND ID != :currentId`,
          { replacements: { empNum: pat.EMPNUMBER, name: pat.NAME, currentId: patientId } }
        );
      } else if (pat.PHONENUMBER && pat.NAME) {
        // Others: match by phone + name
        [relatedRows] = await sequelize.query(
          `SELECT ID FROM HMS_PATIENTS WHERE PHONENUMBER = :phone AND UPPER(NAME) = UPPER(:name) AND ID != :currentId`,
          { replacements: { phone: pat.PHONENUMBER, name: pat.NAME, currentId: patientId } }
        );
      }

      if (relatedRows.length > 0) {
        relatedPatientIds.push(...relatedRows.map(r => r.ID));
      }
    }

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
