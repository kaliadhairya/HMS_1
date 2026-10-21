// Retired legacy writers (completion A6): every unsafe legacy write path refuses (410 retired, or
// 409 when history must stay immutable) and changes nothing; registration no longer creates a
// free-text lab report draft. Synthetic data only.
const crypto = require('crypto');
const { api, apiLogin, sql, inCare, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

(async () => {
  const { step, done } = runner('Retired legacy writers');
  const tag = crypto.randomUUID().slice(0, 8);
  const tokens = {
    desk: await apiLogin('receptionist'), lab: await apiLogin('lab_technician'), doctor: await apiLogin('doctor'),
    nurse: await apiLogin('nurse'), pharmacist: await apiLogin('pharmacist'),
  };
  const [doctor] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [p] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",
    ['Synthetic legacy writers ' + tag, 'LW-' + tag]);
  await inCare(p.id);
  const [enc] = await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'In Progress') RETURNING id", [p.id, doctor.id]);
  const call = (method, path, role, body) => api(method, path, { token: tokens[role], body, headers: { 'idempotency-key': crypto.randomUUID() } });

  await step('Registration creates the patient and no free-text lab report draft', async () => {
    const before = (await sql('SELECT count(*)::int AS n FROM hms_test_reports'))[0].n;
    const r = await call('POST', '/patients', 'lab', { patientType: 'other', name: `Synthetic registration ${tag}`, age: 30, gender: 'Female', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `8${String(Date.now()).slice(-9)}` });
    assert(r.status === 201 && r.data.patient?.id, `registration ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert(r.data.reportId === undefined, 'registration still answers a report draft');
    const after = (await sql('SELECT count(*)::int AS n FROM hms_test_reports'))[0].n;
    assert(after === before, `registration created ${after - before} report drafts`);
  });

  await step('Retired clinical writers answer 410 and write nothing', async () => {
    const marBefore = (await sql('SELECT count(*)::int AS n FROM hms_mar_records'))[0].n;
    const reportsBefore = (await sql('SELECT count(*)::int AS n FROM hms_test_reports'))[0].n;
    for (const [method, path, role, body] of [
      ['POST', '/ipd/mar', 'nurse', { admissionId: 1, medicineName: 'Synthetic', dose: '1' }],
      ['PATCH', '/ipd/mar/1/status', 'nurse', { status: 'Given' }],
      ['POST', '/lab/samples', 'lab', { itemId: 1 }],
      ['POST', '/lab/results/1', 'lab', { result: '5' }],
      ['POST', '/reports', 'lab', { patientId: p.id }],
      ['PUT', '/reports/1', 'lab', {}],
    ]) {
      const r = await call(method, path, role, body);
      assert(r.status === 410, `${method} ${path} answered ${r.status}, not retired`);
    }
    assert((await sql('SELECT count(*)::int AS n FROM hms_mar_records'))[0].n === marBefore, 'a retired MAR writer wrote');
    assert((await sql('SELECT count(*)::int AS n FROM hms_test_reports'))[0].n === reportsBefore, 'a retired report writer wrote');
  });

  await step('Uncoded dispensing and deleting prescription history are refused (409) and change nothing', async () => {
    const [rx] = await sql("INSERT INTO hms_prescriptions(patient_id,encounter_id,doctor_id,status) VALUES($1,$2,$3,'Draft') RETURNING id", [p.id, enc.id, doctor.id]);
    const del = await call('DELETE', `/doctor/prescriptions/${rx.id}`, 'doctor');
    assert(del.status === 409 && del.data.code === 'CLINICAL_HISTORY_IMMUTABLE', `prescription delete ${del.status}`);
    assert((await sql('SELECT id FROM hms_prescriptions WHERE id = $1', [rx.id])).length === 1, 'prescription history was erased');
    const ledgerBefore = (await sql('SELECT count(*)::int AS n FROM hms_stock_ledger'))[0].n;
    const disp = await call('POST', '/pharmacy/dispense', 'pharmacist', { prescriptionId: rx.id, items: [] });
    assert(disp.status === 409 && disp.data.code === 'CODED_ORDER_REQUIRED', `legacy dispense ${disp.status} ${JSON.stringify(disp.data).slice(0, 120)}`);
    assert((await sql('SELECT count(*)::int AS n FROM hms_stock_ledger'))[0].n === ledgerBefore, 'a refused dispense moved stock');
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
