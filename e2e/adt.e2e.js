// Phase 2 part 8, beds and discharge (migration 0017): occupancy is recorded per
// bed as time ranges that cannot overlap; a transfer closes one range and opens
// the next and sends the old bed to cleaning; beds follow their lifecycle; a
// discharge plan keeps clinical readiness separate from financial clearance,
// and pending results always have a named owner.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('Beds and discharge');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');
  const desk = await apiLogin('receptionist');
  const demoDoctor = await apiLogin('doctor');
  const ctx = {};

  await step('Current occupancy is recorded for every active admission in a bed', async () => {
    const [{ missing }] = await sql(`SELECT count(*)::int AS missing FROM hms_admissions a
      WHERE a.status = 'Active' AND a.bed_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM hms_bed_occupancies o WHERE o.admission_id = a.id AND o.bed_id = a.bed_id AND o.ends_at IS NULL)`);
    assert(missing === 0, `${missing} active admissions without an open occupancy`);
  });

  await step('A transfer moves the patient, sends the old bed to cleaning and records the history', async () => {
    const [adm] = await sql("SELECT id, bed_id FROM hms_admissions WHERE id = 2 AND status = 'Active'");
    ctx.oldBed = adm.bed_id;
    const [free] = await sql("SELECT id FROM hms_beds WHERE status = 'Available' AND id <> $1 ORDER BY id LIMIT 1", [ctx.oldBed]);
    assert(free, 'no free bed to move the patient to');
    ctx.newBed = free.id;
    assert((await call('POST', `/adt/admissions/2/transfer`, desk, { toBedId: 6, reason: 'Clinical need' })).status === 403, 'receptionist transferred');
    const r = await call('POST', `/adt/admissions/2/transfer`, admin, { toBedId: ctx.newBed, reason: 'Moved to a quieter room' });
    assert(r.status === 200, `transfer ${r.status} ${JSON.stringify(r.data)}`);
    const [now] = await sql('SELECT bed_id FROM hms_admissions WHERE id = 2');
    assert(Number(now.bed_id) === ctx.newBed, 'admission still in the old bed');
    const beds = await sql('SELECT id, status FROM hms_beds WHERE id IN ($1, $2)', [ctx.oldBed, ctx.newBed]);
    const byId = Object.fromEntries(beds.map((b) => [b.id, b.status]));
    assert(byId[ctx.oldBed] === 'Dirty' && byId[ctx.newBed] === 'Occupied', JSON.stringify(byId));
    const history = await call('GET', '/adt/admissions/2/occupancies', admin);
    const old = history.data.data.find((h) => Number(h.bed_id) === ctx.oldBed);
    const cur = history.data.data.find((h) => Number(h.bed_id) === ctx.newBed && !h.ends_at);
    assert(old && old.ends_at && cur, `history ${JSON.stringify(history.data.data)}`);
  });

  await step('A bed that is not ready cannot take a patient; the patient stays where they are', async () => {
    const r = await call('POST', `/adt/admissions/2/transfer`, admin, { toBedId: ctx.oldBed, reason: 'Back to the first bed' });
    assert(r.status === 409, `transfer into a dirty bed: ${r.status} ${JSON.stringify(r.data)}`);
    const occupied = await call('POST', `/adt/admissions/2/transfer`, admin, { toBedId: 1, reason: 'Into an occupied bed' });
    assert(occupied.status === 409, `transfer into an occupied bed: ${occupied.status}`);
  });

  await step('The database refuses two occupancies of one bed at the same time', async () => {
    let code = null;
    try {
      await sql(`INSERT INTO hms_bed_occupancies (bed_id, admission_id, starts_at, reason) VALUES ($1, 1, now() - interval '1 hour', 'clash')`, [ctx.newBed]);
    } catch (e) { code = e.code; }
    assert(code === '23P01', `overlapping occupancy accepted (${code})`);
  });

  await step('Beds follow the lifecycle: dirty to cleaning to ready; occupied beds cannot be changed here', async () => {
    assert((await call('POST', `/adt/beds/${ctx.oldBed}/status`, nurse, { status: 'Cleaning' })).status === 200, 'dirty to cleaning');
    assert((await call('POST', `/adt/beds/${ctx.oldBed}/status`, nurse, { status: 'Available' })).status === 200, 'cleaning to ready');
    assert((await call('POST', `/adt/beds/${ctx.newBed}/status`, nurse, { status: 'Available' })).status === 409, 'occupied bed made available');
    assert((await call('POST', `/adt/beds/${ctx.oldBed}/status`, nurse, { status: 'Dirty' })).status === 409, 'ready bed made dirty directly');
    const [{ id }] = await sql("SELECT id FROM hms_beds WHERE status = 'Available' AND is_active = 1 AND id NOT IN (1,2,3,4,5,6,7,8) LIMIT 1").catch(() => [{ id: 9 }]);
    assert((await call('POST', `/adt/beds/${id}/status`, nurse, { status: 'OutOfService' })).status === 400, 'out of service without a reason');
    assert((await call('POST', `/adt/beds/${id}/status`, nurse, { status: 'OutOfService', reason: 'Broken bed rail' })).status === 200, 'out of service');
    assert((await call('POST', `/adt/beds/${id}/status`, nurse, { status: 'Available' })).status === 200, 'back in service');
  });

  await step('A discharge plan needs a named owner for pending results; the doctor records it', async () => {
    const noOwner = await call('PUT', '/adt/admissions/1/discharge-plan', demoDoctor, { pendingResults: 'Blood culture pending' });
    assert(noOwner.status === 422, `pending results without owner: ${noOwner.status}`);
    const [demo] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const ok = await call('PUT', '/adt/admissions/1/discharge-plan', demoDoctor, { pendingResults: 'Blood culture pending', resultsOwnerUserId: demo.id, destination: 'Home', instructions: 'Review in 1 week' });
    assert(ok.status === 200 && ok.data.data.financial_clearance === 'pending', `plan ${ok.status} ${JSON.stringify(ok.data)}`);
  });

  await step('Discharge waits for clinical readiness; readiness and financial clearance are recorded separately', async () => {
    const early = await call('PATCH', '/ipd/admissions/1/discharge', demoDoctor, { finalDiagnosis: 'Pneumonia' });
    assert(early.status === 409 && /clinically ready discharge plan/.test(early.data.message), `discharge before ready: ${early.status} ${JSON.stringify(early.data)}`);
    assert((await call('POST', '/adt/admissions/1/discharge-plan/clinically-ready', demoDoctor)).status === 200, 'mark ready');
    assert((await call('POST', '/adt/admissions/1/discharge-plan/cleared', demoDoctor)).status === 403, 'doctor cleared billing');
    assert((await call('POST', '/adt/admissions/1/discharge-plan/cleared', admin)).status === 200, 'billing cleared');
    const [plan] = await sql('SELECT clinical_ready_at, financial_clearance FROM hms_discharge_plans WHERE admission_id = 1');
    assert(plan.clinical_ready_at && plan.financial_clearance === 'cleared', JSON.stringify(plan));
  });

  await step('Discharge frees the bed to cleaning and closes the occupancy', async () => {
    const [before] = await sql('SELECT bed_id FROM hms_admissions WHERE id = 1');
    const r = await call('PATCH', '/ipd/admissions/1/discharge', demoDoctor, {
      finalDiagnosis: 'Pneumonia', courseInHospital: 'Treated and clinically improved.',
      conditionAtDischarge: 'Improved', adviceOnDischarge: 'Continue prescribed treatment and return for worsening symptoms.',
      warningSigns: 'Worsening breathing or persistent fever', followUpAppointments: '[]',
    });
    assert(r.status === 200, `discharge ${r.status} ${JSON.stringify(r.data)}`);
    const [bed] = await sql('SELECT status FROM hms_beds WHERE id = $1', [before.bed_id]);
    assert(bed.status === 'Dirty', `bed after discharge: ${bed.status}`);
    const [{ open }] = await sql('SELECT count(*)::int AS open FROM hms_bed_occupancies WHERE admission_id = 1 AND ends_at IS NULL');
    assert(open === 0, 'occupancy still open after discharge');
  });

  done();
  process.exit();
})();
