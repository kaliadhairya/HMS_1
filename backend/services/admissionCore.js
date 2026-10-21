// Admission of a patient into a bed (completion A3): the one command behind the legacy route and
// the v2 API. The bed, the patient and the admission request are locked; the request is marked
// Admitted and the occupancy starts in the caller's transaction. Refusals are thrown with a status.
const { sequelize } = require('../models');
const { openOccupancy } = require('../utils/adt');
const { posInt, text, refusal, nextId, DURATION_DAYS } = require('./admissionRows');

async function admitPatient({ body, user, t }) {
  const { admittingDoctorId, department, admissionType, expectedDischargeDate } = body;
  const patientId = posInt(body.patientId);
  const bedId = posInt(body.bedId);
  if (!patientId) throw refusal(400, 'Select a patient.');
  if (!bedId) throw refusal(400, 'Select a bed.');

  const [[patient]] = await sequelize.query(
    'SELECT ID, NAME, UHID, GENDER, AGE FROM HMS_PATIENTS WHERE ID = :patientId FOR UPDATE',
    { replacements: { patientId }, transaction: t },
  );
  if (!patient) throw refusal(404, 'Patient not found.');

  const [[current]] = await sequelize.query(
    "SELECT ADMISSION_ID_FORMATTED FROM HMS_ADMISSIONS WHERE PATIENT_ID = :patientId AND STATUS = 'Active' LIMIT 1",
    { replacements: { patientId }, transaction: t },
  );
  if (current) throw refusal(409, `${patient.NAME} is already admitted (${current.ADMISSION_ID_FORMATTED}).`);

  const [[bed]] = await sequelize.query(
    'SELECT ID, BED_NUMBER, STATUS, IS_ACTIVE FROM HMS_BEDS WHERE ID = :bedId FOR UPDATE',
    { replacements: { bedId }, transaction: t },
  );
  if (!bed) throw refusal(404, 'Bed not found.');
  const [[inBed]] = await sequelize.query(
    "SELECT ID FROM HMS_ADMISSIONS WHERE BED_ID = :bedId AND STATUS = 'Active' LIMIT 1",
    { replacements: { bedId }, transaction: t },
  );
  const bedStatus = bed.STATUS || 'Available';
  if (Number(bed.IS_ACTIVE) !== 1 || bedStatus !== 'Available' || inBed) {
    throw refusal(409, `Bed ${bed.BED_NUMBER} is not available (${inBed ? 'Occupied' : Number(bed.IS_ACTIVE) !== 1 ? 'inactive' : bedStatus}).`);
  }

  // The admission request being fulfilled: the one given, else the patient's pending request.
  let request = null;
  if (body.requestId !== undefined && body.requestId !== null && body.requestId !== '') {
    const [[r]] = await sequelize.query(
      'SELECT * FROM HMS_IPD_REQUESTS WHERE ID = :id FOR UPDATE',
      { replacements: { id: posInt(body.requestId) || 0 }, transaction: t },
    );
    if (!r) throw refusal(404, 'Admission request not found.');
    if (Number(r.PATIENT_ID) !== patientId) throw refusal(400, 'The admission request is for another patient.');
    if (r.STATUS !== 'Pending') throw refusal(409, `This admission request is already ${String(r.STATUS).toLowerCase()}.`);
    request = r;
  } else {
    const [[r]] = await sequelize.query(
      "SELECT * FROM HMS_IPD_REQUESTS WHERE PATIENT_ID = :patientId AND STATUS = 'Pending' ORDER BY REQUEST_DATE DESC LIMIT 1 FOR UPDATE",
      { replacements: { patientId }, transaction: t },
    );
    request = r || null;
  }

  // Admitting doctor: as chosen, else the requesting doctor, else the user admitting.
  const doctorId = posInt(admittingDoctorId) || (request && posInt(request.DOCTOR_ID)) || user.id;
  const [[doctor]] = await sequelize.query(
    `SELECT u.ID, u.NAME, dp.NAME AS DEPARTMENT_NAME, d.SPECIALITY
     FROM HMS_USERS u
     LEFT JOIN HMS_DOCTORS d ON d.USER_ID = u.ID
     LEFT JOIN HMS_DEPARTMENTS dp ON dp.ID = d.DEPARTMENT_ID
     WHERE u.ID = :doctorId`,
    { replacements: { doctorId }, transaction: t },
  );
  if (!doctor) throw refusal(400, 'Admitting doctor not found.');
  // The department is the admitting doctor's (the requests page used to send the diagnosis here).
  const dept = text(department) || doctor.DEPARTMENT_NAME || doctor.SPECIALITY || 'General';
  const admType = text(admissionType) || (request && request.URGENCY_LEVEL) || 'Routine';

  let expected = null;
  if (expectedDischargeDate) {
    const d = new Date(expectedDischargeDate);
    if (Number.isNaN(d.getTime())) throw refusal(400, 'Expected discharge date is not a valid date.');
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
      expected, formatted: formattedId, createdBy: user.id,
    },
    transaction: t,
  });
  await sequelize.query("UPDATE HMS_BEDS SET STATUS = 'Occupied' WHERE ID = :bedId", { replacements: { bedId }, transaction: t });
  // The bed's occupancy history starts with the admission (migration 0017).
  await openOccupancy(sequelize, { bedId, admissionId, userId: user.id, reason: 'admission', transaction: t });
  if (request) {
    await sequelize.query(
      "UPDATE HMS_IPD_REQUESTS SET STATUS = 'Admitted', ADMISSION_ID = :admissionId, UPDATED_AT = CURRENT_TIMESTAMP WHERE ID = :id",
      { replacements: { admissionId, id: request.ID }, transaction: t },
    );
  }

  return { admissionId, formattedId, patientId, bedId, bed, doctorId, patient, doctor, request, expected, dept, admType };
}

module.exports = { admitPatient };
