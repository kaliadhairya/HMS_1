// Clinical chart writes (completion A2): vitals, diagnoses and rest forms need a
// current, independently verified professional credential and the facility privilege
// for the action; a doctor also needs the patient in their care. Role alone is not enough.
const crypto = require('crypto');
const { api, apiLogin, sql, runner, assert, requireThrowawayDb, syntheticClinician } = require('./helpers');

requireThrowawayDb();

(async () => {
  const { step, done } = runner('Clinical chart guards');
  const tag = crypto.randomBytes(3).toString('hex');
  const [patient] = await sql("SELECT id FROM hms_patients WHERE identity_status = 'registered' ORDER BY id OFFSET 10 LIMIT 1");
  const vitalsBody = (patientId) => ({ patient_id: patientId, temp_unit: 'C', temperature: 37.1, bp_systolic: 120, bp_diastolic: 80, pulse: 72, spo2: 98, encounter_type: 'OPD' });
  const countVitals = async (patientId) => (await sql('SELECT count(*)::int AS n FROM hms_vitals WHERE patient_id = $1', [patientId]))[0].n;

  await step('A nurse with no verified professional credential cannot record vitals, and nothing is saved', async () => {
    const username = `unverified-nurse-${tag}`;
    const bcrypt = require('../backend/node_modules/bcryptjs');
    const password = crypto.randomBytes(18).toString('hex');
    const [u] = await sql("INSERT INTO hms_users(username,password,name,role,is_active) VALUES($1,$2,'Synthetic unverified nurse','nurse',1) RETURNING id", [username, await bcrypt.hash(password, 4)]);
    await syntheticClinician(u.id, 'nurse', { credential: false });
    const login = await api('POST', '/auth/login', { body: { username, password }, headers: { 'X-Auth-Transport': 'bearer' } });
    assert(login.data.token, `synthetic login failed ${login.status}`);
    const before = await countVitals(patient.id);
    const r = await api('POST', '/hms/vitals', { token: login.data.token, body: vitalsBody(patient.id) });
    assert(r.status === 403 && r.data.code === 'CLINICAL_PRIVILEGE_REQUIRED', `unverified nurse: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert(await countVitals(patient.id) === before, 'a refused vitals entry was saved');
  });

  await step('A nurse with a verified credential and the privilege records vitals', async () => {
    const nurse = await apiLogin('nurse');
    const before = await countVitals(patient.id);
    const r = await api('POST', '/hms/vitals', { token: nurse, body: vitalsBody(patient.id) });
    assert(r.status === 201 || r.status === 200, `verified nurse: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert(await countVitals(patient.id) === before + 1, 'the verified entry was not saved');
  });

  await step('A doctor cannot start a diagnosis for a patient outside their care', async () => {
    const doctor = await apiLogin('doctor');
    const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    let [outside] = await sql(`SELECT e.id AS encounter_id FROM hms_encounters e
      WHERE NOT EXISTS (SELECT 1 FROM hms_care_team_assignments c WHERE c.patient_id = e.patient_id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL)
      ORDER BY e.id LIMIT 1`, [doctorUser.id]);
    if (!outside) {
      // A database without one (a seeded one, or after suites put every patient in this doctor's
      // care) gets a synthetic visit of a patient no care team of this doctor holds.
      const [p] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',60,'Male','OPD',CURRENT_DATE) RETURNING id",
        [`Synthetic outside visit ${Date.now()}`, `OUTV-${Date.now()}`]);
      [outside] = await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) SELECT nextval('hms_encounters_seq'), $1, id, 'In Progress' FROM hms_users WHERE username = 'admin' RETURNING id AS encounter_id", [p.id]);
    }
    assert(outside, 'no encounter outside the doctor\'s care');
    const r = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: outside.encounter_id, icd10_code: 'R50.9', icd10_description: 'Fever, unspecified' } });
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `outside care: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('The same doctor passes the privilege check for a patient in their care', async () => {
    const doctor = await apiLogin('doctor');
    const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [mine] = await sql(`SELECT e.id AS encounter_id FROM hms_encounters e
      JOIN hms_care_team_assignments c ON c.patient_id = e.patient_id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL
      ORDER BY e.id LIMIT 1`, [doctorUser.id]);
    assert(mine, 'the doctor has no encounter in their care in this database');
    const r = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: mine.encounter_id, icd10_code: 'R50.9', icd10_description: 'Fever, unspecified' } });
    assert(r.status !== 403, `in-care doctor refused by the chart check: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('An unverified nurse cannot submit a triage assessment', async () => {
    const username = `unverified-triage-${tag}`;
    const bcrypt = require('../backend/node_modules/bcryptjs');
    const password = crypto.randomBytes(18).toString('hex');
    const [u] = await sql("INSERT INTO hms_users(username,password,name,role,is_active) VALUES($1,$2,'Synthetic unverified triage nurse','nurse',1) RETURNING id", [username, await bcrypt.hash(password, 4)]);
    await syntheticClinician(u.id, 'nurse', { credential: false });
    const login = await api('POST', '/auth/login', { body: { username, password }, headers: { 'X-Auth-Transport': 'bearer' } });
    assert(login.data.token, 'synthetic login failed');
    const r = await api('POST', '/triage/arrivals/1/assessments', { token: login.data.token, body: { protocolKey: 'x', protocolVersion: 1, acuityLevel: 3, reassessMinutes: 15 } });
    assert(r.status === 403 && r.data.code === 'CLINICAL_PRIVILEGE_REQUIRED', `unverified triage: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('A doctor cannot refer a patient outside their care', async () => {
    const doctor = await apiLogin('doctor');
    const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [outside] = await sql(`SELECT p.id FROM hms_patients p
      WHERE NOT EXISTS (SELECT 1 FROM hms_care_team_assignments c WHERE c.patient_id = p.id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL)
      ORDER BY p.id LIMIT 1`, [doctorUser.id]);
    const r = await api('POST', '/referrals', { token: doctor, body: { patientId: outside.id, toSpecialty: 'Cardiology', reason: 'Synthetic referral outside care' } });
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `referral outside care: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('An unverified nurse cannot record inpatient vitals', async () => {
    const username = `unverified-ipd-${tag}`;
    const bcrypt = require('../backend/node_modules/bcryptjs');
    const password = crypto.randomBytes(18).toString('hex');
    const [u] = await sql("INSERT INTO hms_users(username,password,name,role,is_active) VALUES($1,$2,'Synthetic unverified ward nurse','nurse',1) RETURNING id", [username, await bcrypt.hash(password, 4)]);
    await syntheticClinician(u.id, 'nurse', { credential: false });
    const login = await api('POST', '/auth/login', { body: { username, password }, headers: { 'X-Auth-Transport': 'bearer' } });
    assert(login.data.token, 'synthetic login failed');
    const [adm] = await sql('SELECT id FROM hms_admissions ORDER BY id LIMIT 1');
    const r = await api('POST', '/ipd/vitals', { token: login.data.token, body: { admissionId: adm.id, temperature: 37 } });
    assert(r.status === 403 && r.data.code === 'CLINICAL_PRIVILEGE_REQUIRED', `unverified ward vitals: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('A doctor cannot write a progress note for an admission outside their care', async () => {
    const doctor = await apiLogin('doctor');
    const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    let [outside] = await sql(`SELECT a.id FROM hms_admissions a
      WHERE NOT EXISTS (SELECT 1 FROM hms_care_team_assignments c WHERE c.patient_id = a.patient_id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL)
      ORDER BY a.id LIMIT 1`, [doctorUser.id]);
    if (!outside) {
      // A database without one (for example built from the demo seed) gets a synthetic admission
      // of a patient no care team of this doctor holds.
      const [p] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',60,'Male','IPD',CURRENT_DATE) RETURNING id",
        [`Synthetic outside care ${Date.now()}`, `OUT-${Date.now()}`]);
      [outside] = await sql("INSERT INTO hms_admissions(patient_id,admitting_doctor_id,status,admission_date) SELECT $1, id, 'Active', now() FROM hms_users WHERE username = 'admin' RETURNING id", [p.id]);
    }
    assert(outside, 'no admission outside the doctor\'s care');
    const r = await api('POST', '/ipd/progress-notes', { token: doctor, body: { admissionId: outside.id, noteText: 'Synthetic note outside care' } });
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `progress note outside care: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
