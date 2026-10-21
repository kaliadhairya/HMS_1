// Signed discharge and handover continuity (completion A5): an admission is discharged only with
// its signed discharge document, enforced by the database for every writer; the shared
// observations current at signing are linked to that document, and the latest one to a nursing
// handover; the links are immutable and name the same patient and facility. Synthetic data only.
const crypto = require('crypto');
const { API, api, apiLogin, sql, inCare, runner, assert, requireThrowawayDb } = require('./helpers');
const { clinicalFixture } = require('./clinicalFixtures');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const short = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`;
async function refused(statement, params, code) {
  try { await sql(statement, params); } catch (e) { return !code || e.code === code; }
  return false;
}

(async () => {
  const { step, done } = runner('Discharge and handover continuity');
  const tag = crypto.randomUUID().slice(0, 8);
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const admin = await apiLogin('admin');
  await clinicalFixture('doctor', ['CHART_READ', 'CLINICAL_SIGN']);
  await clinicalFixture('nurse', ['CHART_READ', 'NURSING_DOCUMENT']);
  const [doctorUser] = await sql("SELECT id, public_id FROM hms_users WHERE username = 'doctor'");
  const ctx = {};

  await step('Prepare an admitted patient in care with observations, one of them corrected', async () => {
    const [p] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',50,'Female','IPD',CURRENT_DATE) RETURNING id, public_id",
      ['Synthetic continuity ' + tag, 'CON-' + tag]);
    ctx.patient = p;
    await inCare(p.id);
    const [ward] = await sql("SELECT id FROM hms_wards WHERE type = 'General' AND is_active = 1 ORDER BY id LIMIT 1");
    const made = await call('POST', '/ipd/beds', admin, { wardId: ward.id, roomNumber: `CON-${tag}`, bedPrefix: `CON-${tag}`, count: 1 });
    assert(made.status === 201 || made.status === 200, `bed ${short(made)}`);
    const [bed] = await sql('SELECT public_id FROM hms_beds WHERE id = $1', [made.data.data[0].ID ?? made.data.data[0].id]);
    const adm = await call('POST', '/v2/admissions', doctor, { patient_id: p.public_id, bed_id: bed.public_id, admitting_doctor_id: doctorUser.public_id, admission_type: 'Routine' });
    assert(adm.status === 201, `admit ${short(adm)}`);
    ctx.admission = adm.data.data;
    [{ id: ctx.admissionId }] = await sql('SELECT id FROM hms_admissions WHERE public_id = $1', [ctx.admission.id]);
    const record = async (minutesAgo, value, extra = {}) => {
      const r = await call('POST', '/v2/observations', doctor, {
        patient_id: p.public_id, admission_id: ctx.admission.id, observed_at: new Date(Date.now() - minutesAgo * 60000).toISOString(),
        observations: [{ code: 'body-temperature', value, unit_code: 'Cel' }], ...extra,
      });
      assert(r.status === 201, `observation ${short(r)}`);
      return r.data.data.id;
    };
    ctx.first = await record(120, 39.4);
    ctx.second = await record(60, 37.9);
    ctx.correction = await record(120, 38.4, { correction_of: ctx.first, correction_reason: 'Synthetic transcription correction' });
    await sql(`INSERT INTO hms_discharge_plans (admission_id, facility_id, clinical_ready_at, clinical_ready_by, pending_results)
      SELECT $1, (SELECT facility_id FROM hms_admissions WHERE id = $1), now(), $2, ''
      ON CONFLICT (admission_id) DO UPDATE SET clinical_ready_at = now(), clinical_ready_by = $2, pending_results = ''`, [ctx.admissionId, doctorUser.id]);
  });

  await step('The database refuses to discharge an admission that has no signed discharge document', async () => {
    assert(await refused("UPDATE hms_admissions SET status = 'Discharged', discharge_date = now() WHERE id = $1", [ctx.admissionId], '23514'),
      'an admission was discharged directly, without its signed document');
    const [a] = await sql('SELECT status FROM hms_admissions WHERE id = $1', [ctx.admissionId]);
    assert(a.status === 'Active', `admission is ${a.status}`);
  });

  await step('The signed discharge links the observations current at signing, not the corrected one', async () => {
    const r = await call('POST', `/v2/admissions/${ctx.admission.id}/discharge`, doctor, {
      final_diagnosis: 'Synthetic viral fever', course_in_hospital: 'Settled', condition_at_discharge: 'Stable', advice_on_discharge: 'Fluids',
      warning_signs: 'Fever above 102F', follow_up_appointments: 'Review in one week',
    }, { 'if-match': `"${ctx.admission.version}"` });
    assert(r.status === 200, `discharge ${short(r)}`);
    ctx.document = r.data.data.clinical_document_id;
    // Links hold the sets' internal identifiers; the API answered with their public ones.
    const links = await sql(`SELECT s.public_id FROM hms_observation_links l JOIN hms_clinical_documents d ON d.id = l.clinical_document_id
      JOIN hms_observation_sets s ON s.id = l.observation_set_id WHERE d.public_id = $1`, [ctx.document]);
    const got = links.map((l) => l.public_id).sort();
    const want = [ctx.second, ctx.correction].sort();
    assert(JSON.stringify(got) === JSON.stringify(want), `linked ${JSON.stringify(got)}, expected ${JSON.stringify(want)} (corrected ${ctx.first})`);
  });

  await step('Observation links cannot be changed or removed, nor name another patient\'s observations', async () => {
    const [link] = await sql('SELECT l.id FROM hms_observation_links l JOIN hms_clinical_documents d ON d.id = l.clinical_document_id WHERE d.public_id = $1 LIMIT 1', [ctx.document]);
    assert(await refused('UPDATE hms_observation_links SET linked_at = now() WHERE id = $1', [link.id], '42501'), 'a link was changed');
    assert(await refused('DELETE FROM hms_observation_links WHERE id = $1', [link.id], '42501'), 'a link was removed');
    const [other] = await sql('SELECT id FROM hms_observation_sets WHERE patient_id <> $1 ORDER BY created_at DESC LIMIT 1', [ctx.patient.id]);
    if (other) {
      assert(await refused(`INSERT INTO hms_observation_links (observation_set_id, clinical_document_id, facility_id, linked_by)
        SELECT $1, d.id, d.facility_id, $3 FROM hms_clinical_documents d WHERE d.public_id = $2`, [other.id, ctx.document, doctorUser.id], '23514'),
      'another patient\'s observations were linked to this discharge');
    }
  });

  await step('A nursing handover links the patient\'s latest current observations', async () => {
    const password = await require('../backend/node_modules/bcryptjs').hash('SyntheticNurse@123', 10);
    const [receiver] = await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic receiving nurse','nurse',1,0) RETURNING id",
      ['con-nurse-' + tag, password]);
    await clinicalFixture('nurse', ['CHART_READ', 'NURSING_DOCUMENT'], { username: 'con-nurse-' + tag });
    const h = await api('POST', '/medication/handovers', { token: nurse, body: {
      patient_id: ctx.patient.id, receiver_user_id: receiver.id, outstanding_task_ids: [],
      sbar: { situation: 'Synthetic situation', background: 'Synthetic background', assessment: 'Synthetic assessment', recommendation: 'Synthetic recommendation' },
    }, headers: { 'idempotency-key': crypto.randomUUID() } });
    assert(h.status === 201, `handover ${h.status} ${JSON.stringify(h.data).slice(0, 200)}`);
    const handover = h.data.data;
    const links = await sql('SELECT s.id, s.public_id FROM hms_observation_links l JOIN hms_observation_sets s ON s.id = l.observation_set_id WHERE l.handover_id = $1', [handover.id]);
    assert(links.length === 1 && links[0].public_id === ctx.second, `handover linked ${JSON.stringify(links)}`);
    assert(JSON.stringify(handover.observation_set_ids) === JSON.stringify([links[0].id]), `handover response ${JSON.stringify(handover.observation_set_ids)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
