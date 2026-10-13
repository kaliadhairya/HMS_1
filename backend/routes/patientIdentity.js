const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');

// Patient identity (migration 0010, blueprint 3.3): temporary identities for
// unknown arrivals, newborns linked to their mother, identifiers with issuer
// and verification, and related persons. Mounted at /api/patients.
const router = express.Router();

const DESK = ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'];
const REGISTRATION = ['super_admin', 'admin', 'receptionist'];
const GENDERS = new Set(['Male', 'Female', 'Other', 'Unknown']);
const IDENTIFIER_SYSTEMS = new Set(['UHID', 'ABHA_NUMBER', 'ABHA_ADDRESS', 'TEMPORARY', 'EXTERNAL_MRN', 'EMPLOYEE', 'PASSPORT']);
// Identifiers staff may add by hand. UHID and TEMPORARY are issued by the system.
const MANUAL_SYSTEMS = new Set(['ABHA_NUMBER', 'ABHA_ADDRESS', 'EXTERNAL_MRN', 'EMPLOYEE', 'PASSPORT']);

const text = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });

function ageFrom(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 130 ? n : NaN;
}

// A new patient row with a system-issued UHID.
async function createPatient(fields, userId, transaction) {
  const [{ id }] = await select("SELECT nextval('hms_patients_seq') AS id", {}, transaction);
  const uhid = `HOSP-${new Date().getFullYear()}-${String(id).padStart(6, '0')}`;
  await sequelize.query(
    `INSERT INTO hms_patients (id, uhid, patienttype, name, first_name, last_name, age, gender, dob, birth_date_estimated,
                               opdindoor, testdate, phonenumber, identity_status, registeredby, is_active, created_at, updated_at)
     VALUES (:id, :uhid, 'other', :name, :firstName, :lastName, :age, :gender, :dob, :estimated,
             'OPD', CURRENT_DATE, :phone, :status, :userId, 1, now(), now())`,
    {
      replacements: {
        id, uhid, name: fields.name, firstName: fields.firstName ?? null, lastName: fields.lastName ?? null,
        age: fields.age, gender: fields.gender, dob: fields.dob ?? null, estimated: Boolean(fields.estimated),
        phone: fields.phone ?? null, status: fields.status, userId,
      },
      transaction,
    }
  );
  // The UHID identifier is recorded by trigger trg_patient_uhid_identifier (migration 0010).
  return { id: Number(id), uhid };
}

async function patientOr404(id, transaction, lock = false) {
  if (!posInt(id)) return null;
  const [row] = await select(`SELECT id, uhid, name, gender, age, dob, identity_status FROM hms_patients WHERE id = :id${lock ? ' FOR UPDATE' : ''}`, { id }, transaction);
  return row || null;
}

// POST /api/patients/hms/temporary — an unknown or unconscious arrival.
// Needs no name, phone or payment: emergency care must never wait for them.
router.post('/hms/temporary', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const gender = text(req.body.gender) || 'Unknown';
    if (!GENDERS.has(gender)) return fail(res, 400, 'Gender must be Male, Female, Other or Unknown.');
    const age = ageFrom(req.body.estimatedAge);
    if (age === null || Number.isNaN(age)) return fail(res, 400, 'Give an estimated age from 0 to 130.');
    const note = text(req.body.arrivalNote, 300);

    const result = await sequelize.transaction(async (transaction) => {
      const [{ stamp }] = await select("SELECT to_char(now() AT TIME ZONE 'Asia/Kolkata', 'DD Mon YYYY HH24:MI') AS stamp", {}, transaction);
      const name = `Unknown ${gender === 'Unknown' ? 'patient' : gender.toLowerCase()} (arrived ${stamp})`;
      const patient = await createPatient({ name, age, gender, estimated: true, status: 'temporary' }, req.user.id, transaction);
      const tempValue = `TEMP-${patient.uhid}`;
      await sequelize.query(
        `INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_at, verified_by, created_by)
         VALUES (:id, 'TEMPORARY', :value, 'this-hospital', 'verified', now(), :userId, :userId)`,
        { replacements: { id: patient.id, value: tempValue, userId: req.user.id }, transaction }
      );
      await logAction(req.user.id, 'CREATE', 'patient', patient.id, null, { identity: 'temporary', note }, req.ip);
      return { ...patient, name, temporaryIdentifier: tempValue };
    });
    res.status(201).json({ success: true, message: 'Temporary patient registered.', data: { ...result, identity_status: 'temporary', gender, age } });
  } catch (err) {
    console.error('Temporary registration failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not register the temporary patient.' });
  }
});

// POST /api/patients/hms/newborn — a baby born here, linked to the mother as guardian.
router.post('/hms/newborn', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const motherId = posInt(req.body.motherPatientId);
    if (!motherId) return fail(res, 400, "The mother's patient record is required.");
    const gender = text(req.body.gender) || 'Unknown';
    if (!GENDERS.has(gender)) return fail(res, 400, 'Gender must be Male, Female, Other or Unknown.');
    const birthDate = text(req.body.birthDate, 10);
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return fail(res, 400, 'Birth date must be YYYY-MM-DD.');

    const result = await sequelize.transaction(async (transaction) => {
      const mother = await patientOr404(motherId, transaction);
      if (!mother) return { status: 404, message: 'Mother not found.' };
      if (mother.gender && !['Female', 'Unknown', 'Other'].includes(mother.gender)) return { status: 400, message: 'The selected mother is recorded as male.' };
      const [{ today, valid }] = await select(
        "SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date::text AS today, (CAST(:birthDate AS date) <= (now() AT TIME ZONE 'Asia/Kolkata')::date) AS valid",
        { birthDate: birthDate || '1900-01-01' }, transaction
      );
      if (birthDate && !valid) return { status: 400, message: 'Birth date cannot be in the future.' };
      const name = text(req.body.name, 100) || `Baby of ${mother.name}`;
      const patient = await createPatient({ name, age: 0, gender, dob: birthDate || today, estimated: false, status: 'registered' }, req.user.id, transaction);
      await sequelize.query(
        `INSERT INTO hms_related_persons (patient_id, related_patient_id, name, relationship, is_guardian, is_emergency_contact, created_by)
         VALUES (:id, :motherId, :motherName, 'Mother', true, true, :userId)`,
        { replacements: { id: patient.id, motherId, motherName: mother.name, userId: req.user.id }, transaction }
      );
      await logAction(req.user.id, 'CREATE', 'patient', patient.id, null, { identity: 'newborn', motherId }, req.ip);
      return { patient: { ...patient, name, age: 0, gender, dob: birthDate || today } };
    });
    if (result.status) return fail(res, result.status, result.message);
    res.status(201).json({ success: true, message: 'Newborn registered.', data: result.patient });
  } catch (err) {
    console.error('Newborn registration failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not register the newborn.' });
  }
});

// POST /api/patients/hms/:id/confirm-identity — a temporary patient's real
// identity is known. The record keeps its UHID and history; the temporary
// identifier is retired, not deleted.
router.post('/hms/:id/confirm-identity', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const name = text(req.body.name, 100);
    const gender = text(req.body.gender);
    const age = ageFrom(req.body.age);
    const dob = text(req.body.dob, 10);
    const phone = text(req.body.phoneNumber, 15)?.replace(/\s/g, '') || null;
    if (!name) return fail(res, 400, 'Name is required.');
    if (!GENDERS.has(gender) || gender === 'Unknown') return fail(res, 400, 'Gender must be Male, Female or Other.');
    if (age === null || Number.isNaN(age)) return fail(res, 400, 'Age must be from 0 to 130.');
    if (dob && !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return fail(res, 400, 'Date of birth must be YYYY-MM-DD.');
    if (phone && !/^\d{10}$/.test(phone)) return fail(res, 400, 'Phone number must be 10 digits.');

    const result = await sequelize.transaction(async (transaction) => {
      const patient = await patientOr404(req.params.id, transaction, true);
      if (!patient) return { status: 404, message: 'Patient not found.' };
      if (patient.identity_status !== 'temporary') return { status: 409, message: 'Only a temporary identity can be confirmed.' };
      await sequelize.query(
        `UPDATE hms_patients SET name = :name, gender = :gender, age = :age, dob = :dob, birth_date_estimated = :estimated,
                phonenumber = COALESCE(:phone, phonenumber), identity_status = 'registered', updated_at = now()
          WHERE id = :id`,
        { replacements: { id: patient.id, name, gender, age, dob: dob || null, estimated: !dob, phone }, transaction }
      );
      await sequelize.query(
        "UPDATE hms_patient_identifiers SET valid_to = now() WHERE patient_id = :id AND system = 'TEMPORARY' AND valid_to IS NULL",
        { replacements: { id: patient.id }, transaction }
      );
      await logAction(req.user.id, 'UPDATE', 'patient', patient.id, { name: patient.name }, { name, action: 'identity_confirmed' }, req.ip);
      return { id: patient.id, uhid: patient.uhid };
    });
    if (result.status) return fail(res, result.status, result.message);
    res.json({ success: true, message: 'Identity confirmed.', data: { ...result, name, gender, age, identity_status: 'registered' } });
  } catch (err) {
    console.error('Identity confirmation failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not confirm the identity.' });
  }
});

// GET /api/patients/hms/:id/identifiers — current and retired identifiers.
router.get('/hms/:id/identifiers', protect, restrictTo(...DESK), async (req, res) => {
  try {
    if (!(await patientOr404(req.params.id))) return fail(res, 404, 'Patient not found.');
    const rows = await select(
      `SELECT id, system, value, issuer, verification_status, verified_at, valid_from, valid_to, created_at
         FROM hms_patient_identifiers WHERE patient_id = :id ORDER BY valid_to NULLS FIRST, system, id`,
      { id: req.params.id }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Identifier list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load identifiers.' });
  }
});

// POST /api/patients/hms/:id/identifiers — record an identifier (unverified).
router.post('/hms/:id/identifiers', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const system = text(req.body.system, 30);
    const value = text(req.body.value, 120);
    const issuer = text(req.body.issuer, 120) || (system?.startsWith('ABHA') ? 'ABDM' : null);
    if (!MANUAL_SYSTEMS.has(system)) return fail(res, 400, 'Identifier type must be ABHA number, ABHA address, external record number, employee number or passport.');
    if (!value) return fail(res, 400, 'Identifier value is required.');
    if (!issuer) return fail(res, 400, 'Say who issued this identifier.');
    if (system === 'ABHA_NUMBER' && !/^\d{2}-?\d{4}-?\d{4}-?\d{4}$/.test(value)) return fail(res, 400, 'An ABHA number has 14 digits.');

    const result = await sequelize.transaction(async (transaction) => {
      if (!(await patientOr404(req.params.id, transaction, true))) return { status: 404, message: 'Patient not found.' };
      const [row] = await select(
        `INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, created_by)
         VALUES (:id, :system, :value, :issuer, :userId)
         ON CONFLICT DO NOTHING
         RETURNING id, system, value, issuer, verification_status, valid_from`,
        { id: req.params.id, system, value: system === 'ABHA_NUMBER' ? value.replace(/-/g, '') : value, issuer, userId: req.user.id },
        transaction
      );
      if (!row) return { status: 409, message: 'This identifier is already recorded for the patient.' };
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message);
    res.status(201).json({ success: true, data: result.row });
  } catch (err) {
    console.error('Identifier add failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not add the identifier.' });
  }
});

// POST /api/patients/hms/:id/identifiers/:identifierId/verify — documents were
// checked. A verified identifier already verified for another patient is
// refused: that is a possible duplicate for review, not a silent merge.
router.post('/hms/:id/identifiers/:identifierId/verify', protect, restrictTo(...REGISTRATION), async (req, res) => {
  try {
    const result = await sequelize.transaction(async (transaction) => {
      const [identifier] = await select(
        `SELECT id, system, value, issuer, verification_status FROM hms_patient_identifiers
          WHERE id = :identifierId AND patient_id = :id AND valid_to IS NULL FOR UPDATE`,
        { identifierId: posInt(req.params.identifierId) || 0, id: posInt(req.params.id) || 0 }, transaction
      );
      if (!identifier) return { status: 404, message: 'Identifier not found.' };
      if (identifier.verification_status === 'verified') return { status: 409, message: 'This identifier is already verified.' };
      const [other] = await select(
        `SELECT p.id, p.uhid, p.name FROM hms_patient_identifiers i JOIN hms_patients p ON p.id = i.patient_id
          WHERE i.system = :system AND i.issuer = :issuer AND i.value = :value AND i.verification_status = 'verified'
            AND i.valid_to IS NULL AND i.patient_id <> :id`,
        { ...identifier, id: req.params.id }, transaction
      );
      if (other) return { status: 409, message: `This identifier is already verified for ${other.name} (${other.uhid}). Review the two records as possible duplicates.` };
      await sequelize.query(
        "UPDATE hms_patient_identifiers SET verification_status = 'verified', verified_at = now(), verified_by = :userId WHERE id = :identifierId",
        { replacements: { identifierId: identifier.id, userId: req.user.id }, transaction }
      );
      return {};
    });
    if (result.status) return fail(res, result.status, result.message);
    res.json({ success: true, message: 'Identifier verified.' });
  } catch (err) {
    if (err.name === 'SequelizeUniqueConstraintError') return fail(res, 409, 'This identifier was just verified for another patient. Review the records as possible duplicates.');
    console.error('Identifier verify failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not verify the identifier.' });
  }
});

// POST /api/patients/hms/:id/identifiers/:identifierId/retire — no longer
// valid (entered in error, replaced). Kept for history; the system-issued
// UHID cannot be retired here.
router.post('/hms/:id/identifiers/:identifierId/retire', protect, restrictTo(...REGISTRATION), async (req, res) => {
  try {
    const reason = text(req.body.reason, 300);
    if (!reason) return fail(res, 400, 'Give a reason.');
    const [row] = await select(
      `UPDATE hms_patient_identifiers SET valid_to = now()
        WHERE id = :identifierId AND patient_id = :id AND valid_to IS NULL AND system <> 'UHID'
        RETURNING id`,
      { identifierId: posInt(req.params.identifierId) || 0, id: posInt(req.params.id) || 0 }
    );
    if (!row) return fail(res, 404, 'No current identifier like that (the UHID cannot be retired).');
    await logAction(req.user.id, 'UPDATE', 'patient_identifier', row.id, null, { action: 'retired', reason }, req.ip);
    res.json({ success: true, message: 'Identifier retired.' });
  } catch (err) {
    console.error('Identifier retire failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not retire the identifier.' });
  }
});

// GET /api/patients/hms/:id/related-persons
router.get('/hms/:id/related-persons', protect, restrictTo(...DESK), async (req, res) => {
  try {
    if (!(await patientOr404(req.params.id))) return fail(res, 404, 'Patient not found.');
    const rows = await select(
      `SELECT r.id, r.name, r.relationship, r.phone, r.is_guardian, r.is_emergency_contact, r.related_patient_id,
              rp.uhid AS related_patient_uhid, r.valid_from, r.valid_to
         FROM hms_related_persons r LEFT JOIN hms_patients rp ON rp.id = r.related_patient_id
        WHERE r.patient_id = :id ORDER BY r.valid_to NULLS FIRST, r.is_guardian DESC, r.id`,
      { id: req.params.id }
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Related persons list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load related persons.' });
  }
});

// POST /api/patients/hms/:id/related-persons
router.post('/hms/:id/related-persons', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const name = text(req.body.name, 100);
    const relationship = text(req.body.relationship, 50);
    const phone = text(req.body.phone, 15)?.replace(/\s/g, '') || null;
    if (!name || !relationship) return fail(res, 400, 'Name and relationship are required.');
    if (phone && !/^\d{10}$/.test(phone)) return fail(res, 400, 'Phone number must be 10 digits.');
    const relatedPatientId = req.body.relatedPatientId ? posInt(req.body.relatedPatientId) : null;
    if (req.body.relatedPatientId && !relatedPatientId) return fail(res, 400, 'Invalid related patient.');

    const result = await sequelize.transaction(async (transaction) => {
      if (!(await patientOr404(req.params.id, transaction))) return { status: 404, message: 'Patient not found.' };
      if (relatedPatientId && !(await patientOr404(relatedPatientId, transaction))) return { status: 404, message: 'Related patient not found.' };
      if (relatedPatientId === Number(req.params.id)) return { status: 400, message: 'A patient cannot be related to themselves.' };
      const [row] = await select(
        `INSERT INTO hms_related_persons (patient_id, related_patient_id, name, relationship, phone, is_guardian, is_emergency_contact, created_by)
         VALUES (:id, :relatedPatientId, :name, :relationship, :phone, :guardian, :emergency, :userId)
         RETURNING id, name, relationship, phone, is_guardian, is_emergency_contact, related_patient_id, valid_from`,
        {
          id: req.params.id, relatedPatientId, name, relationship, phone,
          guardian: req.body.isGuardian === true, emergency: req.body.isEmergencyContact === true, userId: req.user.id,
        },
        transaction
      );
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message);
    res.status(201).json({ success: true, data: result.row });
  } catch (err) {
    console.error('Related person add failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not add the related person.' });
  }
});

// POST /api/patients/hms/:id/related-persons/:personId/end — the relationship
// no longer applies (for example a guardian for a patient now of age). Kept for history.
router.post('/hms/:id/related-persons/:personId/end', protect, restrictTo(...DESK), async (req, res) => {
  try {
    const [row] = await select(
      `UPDATE hms_related_persons SET valid_to = now()
        WHERE id = :personId AND patient_id = :id AND valid_to IS NULL RETURNING id`,
      { personId: posInt(req.params.personId) || 0, id: posInt(req.params.id) || 0 }
    );
    if (!row) return fail(res, 404, 'No current related person like that.');
    res.json({ success: true, message: 'Relationship ended.' });
  } catch (err) {
    console.error('Related person end failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not end the relationship.' });
  }
});

module.exports = { router, IDENTIFIER_SYSTEMS };
