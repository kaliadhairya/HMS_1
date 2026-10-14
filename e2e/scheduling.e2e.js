// Phase 2 part 4, scheduling (migration 0013): one doctor cannot have two live
// appointments that overlap, however the write arrives. Concurrent bookings,
// overlapping times, reschedules and direct database writes are all refused;
// cancelling frees the time; different doctors are independent.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('Scheduling');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const tag = stamp();
  // A far-future day per run, so earlier data never interferes.
  const day = new Date(Date.now() + (60 + (Number(tag) % 500)) * 86400000).toISOString().slice(0, 10);
  const [doctor] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [patient] = await sql('SELECT id FROM hms_patients WHERE identity_status = $1 ORDER BY id OFFSET 3 LIMIT 1', ['registered']);
  const [dept] = await sql('SELECT id FROM hms_departments ORDER BY id LIMIT 1');
  const book = (token, slot, doctorId = doctor.id, patientId = patient.id) =>
    call('POST', '/hms/appointments', token, { patient_id: patientId, doctor_id: doctorId, department_id: dept.id, appointment_date: day, slot_start: slot, appt_type: 'walk-in' });
  const live = async (slot) => (await sql(
    `SELECT count(*)::int AS n FROM hms_appointments WHERE doctor_id = $1 AND appointment_date = $2 AND slot_start = $3
       AND (status IS NULL OR status NOT IN ('Cancelled', 'No Show'))`, [doctor.id, day, slot]))[0].n;

  await step('Fifty simultaneous bookings of one slot: exactly one succeeds', async () => {
    const results = await Promise.all(Array.from({ length: 50 }, () => book(desk, '10:00')));
    const ok = results.filter((r) => r.status === 201).length;
    assert(ok === 1, `${ok} bookings succeeded: ${results.map((r) => r.status).join(',')}`);
    assert(results.every((r) => r.status === 201 || r.status === 400 || r.status === 409), `unexpected status ${results.map((r) => r.status)}`);
    assert(await live('10:00') === 1, 'more than one live appointment in the slot');
  });

  await step('A booking that overlaps an existing one is refused, even when the start times differ', async () => {
    const r = await book(desk, '10:10');
    assert(r.status === 409 && /overlaps/.test(r.data.message), `overlap: ${r.status} ${JSON.stringify(r.data)}`);
  });

  await step('Another doctor at the same time is not affected', async () => {
    const other = await call('POST', '/users', admin, { username: `e2e.sched.${tag}`, password: 'Doctor#Sched2026', name: `Dr Sched ${tag}`, role: 'doctor', isActive: 1 });
    assert(other.status === 201, `create doctor ${other.status}`);
    const r = await book(desk, '10:00', other.data.data.id);
    assert(r.status === 201, `other doctor booking: ${r.status} ${JSON.stringify(r.data)}`);
  });

  await step('Cancelling frees the time for a new booking', async () => {
    const [{ id }] = await sql('SELECT id FROM hms_appointments WHERE doctor_id = $1 AND appointment_date = $2 AND slot_start = $3 AND status = $4', [doctor.id, day, '10:00', 'Scheduled']);
    const cancel = await call('PUT', `/hms/appointments/${id}`, desk, { status: 'Cancelled', cancellation_reason: 'patient rescheduled' });
    assert(cancel.status === 200, `cancel ${cancel.status} ${JSON.stringify(cancel.data)}`);
    const again = await book(desk, '10:00');
    assert(again.status === 201, `booking after cancel: ${again.status} ${JSON.stringify(again.data)}`);
  });

  await step('Rescheduling into an overlapping time is refused; a free time is accepted', async () => {
    const a = await book(desk, '11:00');
    const b = await book(desk, '12:00');
    assert(a.status === 201 && b.status === 201, `setup ${a.status} ${b.status}`);
    const clash = await call('PUT', `/hms/appointments/${b.data.data.id}`, desk, { appointment_date: day, slot_start: '11:10', slot_end: '11:25' });
    assert(clash.status === 409 && /overlap/.test(clash.data.message), `reschedule clash: ${clash.status} ${JSON.stringify(clash.data)}`);
    const free = await call('PUT', `/hms/appointments/${b.data.data.id}`, desk, { appointment_date: day, slot_start: '13:00', slot_end: '13:15' });
    assert(free.status === 200, `reschedule to free time: ${free.status} ${JSON.stringify(free.data)}`);
  });

  await step('The database itself refuses an overlapping write that bypasses the application', async () => {
    let code = null;
    try {
      await sql(`INSERT INTO hms_appointments (id, patient_id, doctor_id, department_id, appointment_date, slot_start, slot_end, status, booked_by, created_at)
                 VALUES (nextval('hms_appt_seq'), $1, $2, 1, $3, '10:05', '10:20', 'Scheduled', $4, now())`, [patient.id, doctor.id, day, 1]);
    } catch (e) { code = e.code; }
    assert(code === '23P01', `direct overlapping insert was not refused (code ${code})`);
  });

  done();
  process.exit();
})();
