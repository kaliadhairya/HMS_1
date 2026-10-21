// Fixes from the 2026-10-22 code review. A rest form (medical certificate) is changed only by
// its author, for a patient in their care, and only in its own fields; removing a diagnosis needs
// the same care relationship as adding one; patient names are stored exactly as typed.
const crypto = require('crypto');
const { api, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

(async () => {
  const { step, done } = runner('Code review fixes');
  const tag = crypto.randomBytes(3).toString('hex');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [adminUser] = await sql("SELECT id FROM hms_users WHERE username = 'admin'");
  const [mine] = await sql(`SELECT c.patient_id AS id FROM hms_care_team_assignments c
    WHERE c.practitioner_user_id = $1 AND c.valid_to IS NULL ORDER BY c.patient_id LIMIT 1`, [doctorUser.id]);
  const [outside] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',50,'Female','OPD',CURRENT_DATE) RETURNING id",
    [`Synthetic outside patient ${tag}`, `REV-${tag}`]);
  const restForm = async (patientId, authorId) => (await sql(
    "INSERT INTO hms_rest_forms(patient_id,doctor_id,book_no,sr_no,disease,advised_days) VALUES($1,$2,'',$3,'Fever',2) RETURNING id",
    [patientId, authorId, `RF-REV-${tag}-${crypto.randomBytes(2).toString('hex')}`]))[0].id;
  const formRow = async (id) => (await sql('SELECT patient_id, doctor_id, disease FROM hms_rest_forms WHERE id = $1', [id]))[0];

  await step('A doctor cannot change another doctor\'s rest form', async () => {
    assert(mine, 'the doctor has no patient in their care in this database');
    const doctor = await apiLogin('doctor');
    const id = await restForm(mine.id, adminUser.id);
    const r = await api('PUT', `/hms/rest-forms/${id}`, { token: doctor, body: { disease: 'Changed by someone else' } });
    assert(r.status === 403, `not the author: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert((await formRow(id)).disease === 'Fever', 'the refused change was saved');
  });

  await step('A doctor cannot change a rest form of a patient outside their care', async () => {
    const doctor = await apiLogin('doctor');
    const id = await restForm(outside.id, doctorUser.id);
    const r = await api('PUT', `/hms/rest-forms/${id}`, { token: doctor, body: { disease: 'Outside care' } });
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `outside care: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert((await formRow(id)).disease === 'Fever', 'the refused change was saved');
  });

  await step('The author changes the certificate\'s text, but not its patient or author', async () => {
    const doctor = await apiLogin('doctor');
    const id = await restForm(mine.id, doctorUser.id);
    const r = await api('PUT', `/hms/rest-forms/${id}`, { token: doctor, body: { disease: '<img src=x onerror=alert(1)> viral fever', patient_id: outside.id, doctor_id: adminUser.id } });
    assert(r.status === 200, `author edit: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    const row = await formRow(id);
    assert(row.disease === '<img src=x onerror=alert(1)> viral fever', `text not saved: ${row.disease}`);
    assert(row.patient_id === mine.id && row.doctor_id === doctorUser.id, `patient or author changed: ${JSON.stringify(row)}`);
  });

  await step('A doctor cannot remove a diagnosis of a patient outside their care', async () => {
    const doctor = await apiLogin('doctor');
    const [enc] = await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'In Progress') RETURNING id", [outside.id, adminUser.id]);
    const [dx] = await sql("INSERT INTO hms_diagnoses(id,encounter_id,icd10_code,icd10_description) VALUES(nextval('hms_diagnoses_seq'),$1,'R50.9','Fever, unspecified') RETURNING id", [enc.id]);
    const r = await api('DELETE', `/hms/diagnoses/${dx.id}`, { token: doctor });
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `outside care: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert((await sql('SELECT 1 FROM hms_diagnoses WHERE id = $1', [dx.id])).length === 1, 'the diagnosis was removed');
  });

  await step('A name with an apostrophe and an ampersand is stored exactly as typed', async () => {
    const desk = await apiLogin('receptionist');
    const name = `Joseph D'Souza & Sons ${tag}`;
    const r = await api('POST', '/patients/hms', { token: desk, headers: { 'idempotency-key': crypto.randomUUID() },
      body: { patientType: 'other', name, age: 40, gender: 'Male', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `93${String(Date.now()).slice(-8)}` } });
    assert(r.status === 201 && r.data.data?.id, `register: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const [row] = await sql('SELECT name FROM hms_patients WHERE id = $1', [r.data.data.id]);
    assert(row.name === name, `stored as ${row.name}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
