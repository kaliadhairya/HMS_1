// Scheduling through the v2 API (completion A3): booking takes an Idempotency-Key and
// names patients, doctors and departments by public identifiers. A retried request is
// replayed, not booked twice; one doctor and slot accepts exactly one booking, however
// many requests race for it, including requests arriving through the legacy route.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}

(async () => {
  const { step, done } = runner('V2 scheduling');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  const tag = stamp();
  // A far-future day per run, so earlier data never interferes.
  const day = new Date(Date.now() + (700 + (Number(tag) % 400)) * 86400000).toISOString().slice(0, 10);
  const [doctor] = await sql("SELECT id, public_id FROM hms_users WHERE username = 'doctor'");
  const [dept] = await sql('SELECT id, public_id FROM hms_departments ORDER BY id LIMIT 1');
  const patients = await sql("SELECT id, public_id FROM hms_patients WHERE identity_status = 'registered' ORDER BY id OFFSET 3 LIMIT 60");
  assert(patients.length >= 52 && patients.every((p) => UUID.test(p.public_id)), 'not enough registered patients with public identifiers');
  const body = (patient, slot) => ({ patient_id: patient.public_id, doctor_id: doctor.public_id, department_id: dept.public_id, appointment_date: day, slot_start: slot, appt_type: 'walk-in' });
  const key = () => ({ 'idempotency-key': crypto.randomUUID() });
  const count = async (slot) => (await sql('SELECT count(*)::int AS n FROM hms_appointments WHERE doctor_id = $1 AND appointment_date = $2 AND slot_start = $3 AND status NOT IN ($4, $5)', [doctor.id, day, slot, 'Cancelled', 'No Show']))[0].n;

  let booked;
  await step('A booking names the patient, doctor and department by public identifier and returns its version', async () => {
    const r = await call('POST', '/v2/appointments', desk, body(patients[0], '09:00'), key());
    assert(r.status === 201, `book ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    const d = r.data.data;
    assert(UUID.test(d.id) && d.patient_id === patients[0].public_id && d.doctor_id === doctor.public_id && d.department_id === dept.public_id, `identifiers ${JSON.stringify(d)}`);
    assert(d.version === 1 && d.slot_start === '09:00' && d.status === 'Scheduled', `fields ${JSON.stringify(d)}`);
    assert(r.data.operation_id && r.headers.get('etag') === '"1"', 'missing operation identifier or version header');
    booked = r;
  });

  await step('A retried request with the same key is replayed; it does not book a second time', async () => {
    const sameKey = crypto.randomUUID();
    const first = await call('POST', '/v2/appointments', desk, body(patients[1], '09:30'), { 'idempotency-key': sameKey });
    const again = await call('POST', '/v2/appointments', desk, body(patients[1], '09:30'), { 'idempotency-key': sameKey });
    assert(first.status === 201 && again.data && again.data.data.id === first.data.data.id, `replay ${again.status} ${JSON.stringify(again.data).slice(0, 160)}`);
    assert(await count('09:30') === 1, 'the retry booked a second appointment');
  });

  await step('The same key with a different request is refused', async () => {
    const sameKey = crypto.randomUUID();
    await call('POST', '/v2/appointments', desk, body(patients[2], '10:00'), { 'idempotency-key': sameKey });
    const other = await call('POST', '/v2/appointments', desk, body(patients[3], '10:15'), { 'idempotency-key': sameKey });
    assert(other.status >= 400 && other.status < 500, `different body with the same key: ${other.status}`);
    assert(await count('10:15') === 0, 'a conflicting request booked');
  });

  await step('A booking without an Idempotency-Key is refused', async () => {
    const r = await call('POST', '/v2/appointments', desk, body(patients[4], '11:00'));
    assert(r.status >= 400 && r.status < 500 && await count('11:00') === 0, `without a key: ${r.status}`);
  });

  await step('An overlapping time for the same doctor is refused as an unavailable slot', async () => {
    const r = await call('POST', '/v2/appointments', desk, body(patients[5], '09:10'), key());
    assert(r.status === 409 && r.data.code === 'SLOT_UNAVAILABLE', `overlap ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  await step('Fifty simultaneous requests for one slot book it exactly once', async () => {
    const slot = '14:00';
    const results = await Promise.all(patients.slice(6, 56).map((p) => call('POST', '/v2/appointments', desk, body(p, slot), key())));
    const ok = results.filter((r) => r.status === 201).length;
    const refused = results.filter((r) => r.status === 409).length;
    assert(ok === 1 && refused === 49, `successes ${ok}, refusals ${refused}, statuses ${[...new Set(results.map((r) => r.status))]}`);
    assert(await count(slot) === 1, 'the slot holds more than one live appointment');
  });

  await step('A legacy booking and a v2 booking racing for one slot share the same lock: exactly one wins', async () => {
    const slot = '15:00';
    const legacy = (p) => call('POST', '/hms/appointments', desk, { patient_id: p.id, doctor_id: doctor.id, department_id: dept.id, appointment_date: day, slot_start: slot, appt_type: 'walk-in' });
    const [v2, leg] = await Promise.all([call('POST', '/v2/appointments', desk, body(patients[57], slot), key()), legacy(patients[58])]);
    const wins = [v2, leg].filter((r) => r.status === 201 || r.status === 200).length;
    assert(wins === 1 && await count(slot) === 1, `legacy ${leg.status} v2 ${v2.status}: wins ${wins}, live ${await count(slot)}`);
  });

  await step('A role outside booking is refused; the read returns the booking; an unknown identifier is not found', async () => {
    const denied = await call('POST', '/v2/appointments', nurse, body(patients[59], '16:00'), key());
    assert(denied.status === 403, `nurse booked: ${denied.status}`);
    const read = await call('GET', `/v2/appointments/${booked.data.data.id}`, desk);
    assert(read.status === 200 && read.data.data.id === booked.data.data.id && read.data.data.slot_start === '09:00', `read ${read.status}`);
    const missing = await call('GET', '/v2/appointments/00000000-0000-4000-8000-000000000000', desk);
    assert(missing.status === 404, `unknown identifier ${missing.status}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
