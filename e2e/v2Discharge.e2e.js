// Discharge through the v2 API (completion A3): the same command as the legacy route, with the
// admission version (If-Match), the doctor's privilege and the patient-in-care check. A stale
// version or a second discharge changes nothing; the bed goes to cleaning; the discharge
// summary is linked to its signed document.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const key = () => ({ 'idempotency-key': crypto.randomUUID() });

(async () => {
  const { step, done } = runner('V2 discharge');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  // An active admission of a patient in this doctor's care, in a bed.
  const [adm] = await sql(`SELECT a.id, a.public_id, a.bed_id, a.patient_id FROM hms_admissions a
    JOIN hms_care_team_assignments c ON c.patient_id = a.patient_id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL
    WHERE a.status = 'Active' AND a.bed_id IS NOT NULL ORDER BY a.id LIMIT 1`, [doctorUser.id]);
  assert(adm, 'the database needs an active admission in a bed for a patient in the doctor\'s care');
  // The discharge plan is clinically ready with no pending results (test database only).
  await sql(`INSERT INTO hms_discharge_plans (admission_id, facility_id, clinical_ready_at, clinical_ready_by, pending_results)
    SELECT $1, (SELECT facility_id FROM hms_admissions WHERE id = $1), now(), $2, ''
    ON CONFLICT (admission_id) DO UPDATE SET clinical_ready_at = now(), clinical_ready_by = $2, pending_results = ''`, [adm.id, doctorUser.id]);
  const state = async () => (await call('GET', `/v2/admissions/${adm.public_id}`, doctor)).data.data;
  const bedStatus = async () => (await sql('SELECT status FROM hms_beds WHERE id = $1', [adm.bed_id]))[0].status;
  const body = {
    final_diagnosis: 'Fever with sore throat', course_in_hospital: 'Improved on oral treatment',
    condition_at_discharge: 'Stable', advice_on_discharge: 'Rest and fluids', warning_signs: 'Fever above 102F or breathlessness',
    follow_up_appointments: 'Review in one week',
  };
  let before;

  await step('A discharge without the admission version is refused and changes nothing', async () => {
    before = await state();
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, doctor, body, key());
    assert(r.status === 428, `missing If-Match: ${r.status}`);
    assert((await state()).status === 'Active', 'a refused discharge closed the admission');
  });

  await step('A discharge by a nurse is refused: only the responsible doctor signs the discharge', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, nurse, body, { ...key(), 'if-match': `"${before.version}"` });
    assert(r.status === 403, `nurse discharged: ${r.status}`);
  });

  await step('A discharge based on an old version is refused and changes nothing', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, doctor, body, { ...key(), 'if-match': '"999"' });
    assert(r.status === 412 && r.data.code === 'VERSION_CONFLICT', `stale version: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    assert((await state()).status === 'Active', 'a stale discharge closed the admission');
  });

  await step('A field outside the snake_case contract is refused, not dropped', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, doctor, { ...body, finalDiagnosis: 'camelCase' }, { ...key(), 'if-match': `"${before.version}"` });
    assert(r.status === 422 && r.data.code === 'UNSUPPORTED_FIELD', `legacy field name: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    assert((await state()).status === 'Active', 'a refused discharge closed the admission');
  });

  const dischargeKey = crypto.randomUUID();
  await step('A discharge with the current version closes the admission, sends the bed to cleaning and links the signed summary', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, doctor, body, { 'idempotency-key': dischargeKey, 'if-match': `"${before.version}"` });
    assert(r.status === 200, `discharge ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
    const d = r.data.data;
    assert(d.status === 'Discharged' && d.version === before.version + 1 && d.summary_id && d.clinical_document_id, `fields ${JSON.stringify(d).slice(0, 220)}`);
    assert(await bedStatus() === 'Dirty', 'the bed was not sent to cleaning');
    const [summary] = await sql('SELECT s.clinical_document_id, s.final_diagnosis FROM hms_discharge_summaries s WHERE s.admission_id = $1', [adm.id]);
    assert(summary && summary.final_diagnosis === body.final_diagnosis, 'no discharge summary for the admission');
    const [signed] = await sql("SELECT d.state FROM hms_clinical_documents d WHERE d.id = $1", [summary.clinical_document_id]);
    assert(signed && signed.state === 'signed', `summary document is ${signed && signed.state}`);
  });

  await step('A repeated discharge with the same key replays the result and does not discharge again', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/discharge`, doctor, body, { 'idempotency-key': dischargeKey, 'if-match': `"${before.version}"` });
    assert(r.status === 200 && r.data.data.version === before.version + 1, `replay ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    const count = (await sql('SELECT count(*)::int AS n FROM hms_discharge_summaries WHERE admission_id = $1', [adm.id]))[0].n;
    assert(count === 1, `${count} discharge summaries for one admission`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
