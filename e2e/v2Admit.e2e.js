// Admitting a patient into a bed through the v2 API (completion A3): the patient, bed and admitting
// doctor are named by public identifier; a patient who is already admitted, or a bed that is
// occupied, is refused; a replayed request admits once.
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
  const { step, done } = runner('V2 admit');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  const [doctor] = await sql("SELECT public_id FROM hms_users WHERE username = 'doctor'");
  const [patient] = await sql(`SELECT p.id, p.public_id FROM hms_patients p
    WHERE p.identity_status = 'registered' AND NOT EXISTS (SELECT 1 FROM hms_admissions a WHERE a.patient_id = p.id AND a.status = 'Active')
    ORDER BY p.id LIMIT 1`);
  // Two beds of its own, so the suite does not depend on how many beds earlier suites left free.
  const admin = await apiLogin('admin');
  const [ward] = await sql("SELECT id FROM hms_wards WHERE type = 'General' AND is_active = 1 ORDER BY id LIMIT 1");
  const tag = crypto.randomUUID().slice(0, 8);
  const made = await call('POST', '/ipd/beds', admin, { wardId: ward.id, roomNumber: `V2A-${tag}`, bedPrefix: `V2A-${tag}`, count: 2 }, key());
  assert(made.status === 201 || made.status === 200, `bed creation ${made.status} ${JSON.stringify(made.data).slice(0, 160)}`);
  const ids = made.data.data.map((b) => b.ID ?? b.id);
  const [bed, bed2] = await sql('SELECT id, public_id FROM hms_beds WHERE id = ANY($1::int[]) ORDER BY id', [ids]);
  assert(patient && bed, 'the database needs a registered patient who is not admitted, and a free bed');
  const body = { patient_id: patient.public_id, bed_id: bed.public_id, admitting_doctor_id: doctor.public_id, admission_type: 'Routine' };
  let admitted;

  await step('The front desk cannot admit a patient', async () => {
    const r = await call('POST', '/v2/admissions', desk, body, key());
    assert(r.status === 403, `receptionist admitted: ${r.status}`);
  });

  await step('A nurse admits the patient into the free bed; the bed is occupied and the admission is active', async () => {
    admitted = await call('POST', '/v2/admissions', nurse, body, key());
    assert(admitted.status === 201 && admitted.data.data.status === 'Active' && admitted.data.data.bed_id === bed.public_id, `admit ${admitted.status} ${JSON.stringify(admitted.data).slice(0, 220)}`);
    assert(admitted.data.data.patient_id === patient.public_id && Number.isInteger(admitted.data.data.version), 'identifiers or version missing');
    const [b] = await sql('SELECT status FROM hms_beds WHERE id = $1', [bed.id]);
    assert(b.status === 'Occupied', `bed is ${b.status}`);
  });

  await step('A replayed admission with the same key admits once', async () => {
    // A second patient and bed, so the first request really admits and the replay is what is tested.
    const [p2] = await sql(`SELECT p.id, p.public_id FROM hms_patients p
      WHERE p.identity_status = 'registered' AND p.id <> $1 AND NOT EXISTS (SELECT 1 FROM hms_admissions a WHERE a.patient_id = p.id AND a.status = 'Active')
      ORDER BY p.id LIMIT 1`, [patient.id]);
    const b2 = bed2;
    assert(p2 && b2, 'the database needs a second free patient and bed');
    const replayBody = { ...body, patient_id: p2.public_id, bed_id: b2.public_id };
    const sameKey = crypto.randomUUID();
    const first = await call('POST', '/v2/admissions', nurse, replayBody, { 'idempotency-key': sameKey });
    const again = await call('POST', '/v2/admissions', nurse, replayBody, { 'idempotency-key': sameKey });
    assert(first.status === 201 && first.data?.data?.id, `first admission ${first.status} ${JSON.stringify(first.data).slice(0, 160)}`);
    assert(again.status === 201 && again.data?.data?.id === first.data.data.id, `replay ${again.status} ${JSON.stringify(again.data).slice(0, 160)}`);
    const [{ n }] = await sql("SELECT count(*)::int AS n FROM hms_admissions WHERE patient_id = $1", [p2.id]);
    assert(n === 1, `${n} admissions for one patient after a replay`);
  });

  await step('A patient who is already admitted, or an occupied bed, is refused', async () => {
    const again = await call('POST', '/v2/admissions', nurse, body, key());
    assert(again.status === 409, `already admitted: ${again.status} ${JSON.stringify(again.data).slice(0, 120)}`);
    const [other] = await sql(`SELECT public_id FROM hms_patients WHERE identity_status = 'registered' AND id <> $1
      AND NOT EXISTS (SELECT 1 FROM hms_admissions a WHERE a.patient_id = hms_patients.id AND a.status = 'Active') ORDER BY id LIMIT 1`, [patient.id]);
    const occupied = await call('POST', '/v2/admissions', nurse, { ...body, patient_id: other.public_id }, key());
    assert(occupied.status === 409, `occupied bed: ${occupied.status} ${JSON.stringify(occupied.data).slice(0, 120)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
