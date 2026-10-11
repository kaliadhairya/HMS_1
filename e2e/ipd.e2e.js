// Inpatient (IPD) workflow, end to end, as the real roles:
// doctor raises an admission request -> nurse admits it into a bed (requests dialog) and a second patient
// from the bed board -> nurse records vitals / fluid balance (trend charts, out-of-range flags) -> MAR give /
// hold / error toast -> doctor progress note + nursing note -> front-desk advance -> doctor discharges with a
// discharge summary (list + print) -> IPD bill with bed days, medicines, discount and advance adjustment ->
// billing history -> role access.
// Run: cd e2e && NODE_PATH=$(npm root -g) node ipd.e2e.js
const fs = require('fs');
const { chromium, BASE, api, apiLogin, sql, browserAs, runner, assert, sleep, stamp } = require('./helpers');

const { step: baseStep, done } = runner('Inpatient workflow');
// IPD_DEBUG=1 prints the whole error (call log included) for a failing step.
// A step that fails while the shared API restarted (another engineer saved a backend file) is run once more.
const sessions = {};
const step = (title, fn) => baseStep(title, async () => {
  for (let attempt = 1; ; attempt++) {
    stepRestarts = restarts();
    try { await fn(); return; } catch (e) {
      if (attempt === 1 && restarts() !== stepRestarts) {
        console.log(`      (API restarted during "${title}"; running the step again)`);
        for (const sess of Object.values(sessions)) sess.errors.splice(0);
        await sleep(3000);
        continue;
      }
      if (process.env.IPD_DEBUG) console.log(String(e.stack || e.message).split('\n').slice(0, 14).join('\n'));
      throw e;
    }
  }
});

// ── helpers ──────────────────────────────────────────────────────────────────
// The shared API restarts (node --watch) whenever anyone saves a backend file; while it is down the Vite
// proxy answers 500. Such errors are ignored only when the backend log shows a restart during the step.
const BACKEND_LOG = process.env.E2E_BACKEND_LOG || '/tmp/claude-0/-home-user-HMS-1/e8b576b8-d255-5894-9950-13831751d9ef/scratchpad/audit/backend.log';
const restarts = () => { try { return (fs.readFileSync(BACKEND_LOG, 'utf8').match(/Restarting 'server\.js'/g) || []).length; } catch { return 0; } };
let stepRestarts = 0;
function noErrors(session, label) {
  let errs = session.errors.splice(0);
  if (restarts() !== stepRestarts) {
    const proxy = errs.filter((e) => /status code 50[0-4]|Network Error|Failed to fetch/.test(e));
    if (proxy.length) console.log(`      (${label}: ignored ${proxy.length} error(s) during a backend restart)`);
    errs = errs.filter((e) => !proxy.includes(e));
  }
  assert(errs.length === 0, `${label}: page errors:\n${errs.join('\n')}`);
}
const toast = (page, text) => page.locator('[role="status"]', { hasText: text }).first().waitFor({ timeout: 10000 });
const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();
const money = (v) => Math.round(Number(v) * 100) / 100;

// Ward preference (admission form option) -> ward, for a ward that has a free bed. Private first: its
// name ("Private Ward") used to be auto-matched to the "Semi-Private" ward in the admit dialog.
const PREFS = [['Private', 'Private'], ['ICU', 'ICU'], ['Semi-Private', 'Semi-Private'], ['General Ward', 'General']];
async function freeBeds() {
  return sql(`SELECT b.id, b.bed_number, b.room_number, w.id AS ward_id, w.name AS ward_name, w.type AS ward_type
    FROM hms_beds b JOIN hms_wards w ON w.id = b.ward_id
    WHERE b.status = 'Available' AND b.is_active = 1 AND w.is_active = 1
      AND NOT EXISTS (SELECT 1 FROM hms_admissions a WHERE a.bed_id = b.id AND a.status = 'Active')
    ORDER BY b.id`);
}

async function newPatient(name, phonePrefix) {
  const rec = await apiLogin('receptionist');
  const p = await api('POST', '/patients/hms', {
    token: rec,
    body: {
      name, first_name: 'E2E', last_name: name.replace(/^E2E /, ''), age: 58, gender: 'Male',
      patientType: 'other', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `${phonePrefix}${String(Date.now()).slice(-9)}`,
    },
  });
  assert(p.status === 201, `patient create ${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);
  return p.data.data?.id || p.data.patient?.id;
}

// ── test ─────────────────────────────────────────────────────────────────────
(async () => {
  const s = stamp();
  const ctx = { s, patientName: `E2E IPD ${s}`, bedBoardName: `E2E IPD Bed ${s}` };
  const browser = await chromium.launch();
  const as = async (role) => { if (!sessions[role]) sessions[role] = await browserAs(browser, role); return sessions[role]; };
  try {
    await step('Setup: patient and OPD encounter by the doctor (API)', async () => {
      const doctor = await apiLogin('doctor');
      if (!ctx.patientId) ctx.patientId = await newPatient(ctx.patientName, '6');
      if (!ctx.encounterId) {
        const e = await api('POST', '/hms/encounters', { token: doctor, body: { patient_id: ctx.patientId, chief_complaint: 'Fever and breathlessness (E2E IPD)' } });
        assert(e.status === 201, `encounter create ${e.status} ${JSON.stringify(e.data)}`);
        ctx.encounterId = e.data.id;
      }
      const users = await sql("SELECT id, username FROM hms_users WHERE username IN ('doctor','nurse','admin','receptionist')");
      ctx.uid = Object.fromEntries(users.map((u) => [u.username, u.id]));
      const beds = await freeBeds();
      const pick = PREFS.find(([, type]) => beds.some((b) => b.ward_type === type));
      assert(pick && beds.length >= 2, `need two free beds, have ${beds.length}`);
      ctx.wardPref = pick[0];
      ctx.bed = beds.find((b) => b.ward_type === pick[1]);
      ctx.otherBed = beds.find((b) => b.id !== ctx.bed.id);
    });

    await step('Doctor raises an admission request from the admission form; it is Pending in /ipd/requests', async () => {
      const doc = await as('doctor');
      const page = doc.page;
      const [already] = await sql('SELECT id FROM hms_ipd_requests WHERE patient_id = $1', [ctx.patientId]);
      if (already) await page.goto(`${BASE}/ipd/requests`, { waitUntil: 'networkidle' }); // retry after an API restart
      else {
      await page.goto(`${BASE}/ipd/admission-form?patientId=${ctx.patientId}`, { waitUntil: 'networkidle' });
      await page.getByText(ctx.patientName).first().waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: 'Send IPD request' }).click();
      await toast(page, 'Fill in all required fields');
      await page.getByLabel(/Reason for admission/).fill('Community-acquired pneumonia needing IV antibiotics and oxygen (E2E)');
      await page.getByLabel(/Primary diagnosis/).fill(`Pneumonia E2E ${s}`);
      await page.getByLabel('ICD-10 code').fill('J18.9');
      await page.getByLabel(/Ward preference/).selectOption(ctx.wardPref);
      await page.getByLabel(/Urgency/).selectOption('Urgent');
      await page.getByLabel('Estimated duration').fill('4');
      await page.getByLabel('Cardiac monitoring').check();
      await page.getByLabel('Initial orders and instructions for nursing').fill('IV ceftriaxone 1 g BD, O2 to keep SpO2 above 94%');
      await page.getByRole('button', { name: 'Send IPD request' }).click();
      await toast(page, 'IPD admission request sent');
      await page.waitForURL(/\/ipd\/requests$/, { timeout: 10000 });
      }

      const [r] = await sql('SELECT * FROM hms_ipd_requests WHERE patient_id = $1', [ctx.patientId]);
      assert(r, 'request row not created');
      ctx.requestId = r.id;
      assert(r.status === 'Pending' && r.doctor_id === ctx.uid.doctor && r.urgency_level === 'Urgent' && r.ward_preference === ctx.wardPref
        && r.primary_diagnosis === `Pneumonia E2E ${s}` && r.icd10_code === 'J18.9' && r.estimated_duration === 4 && JSON.parse(r.special_requirements).includes('Cardiac monitoring'),
      `request saved as ${JSON.stringify(r)}`);
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.waitFor({ timeout: 10000 });
      const text = await row.innerText();
      assert(text.includes('Pending') && text.includes('Urgent') && text.includes(`Pneumonia E2E ${s}`) && text.includes('Awaiting admission'), `requests row: ${text}`);

      // A second request for the same patient, or one without a patient, is refused.
      const doctor = await apiLogin('doctor');
      const dup = await api('POST', '/ipd/requests', { token: doctor, body: { patientId: ctx.patientId, reasonForAdmission: 'x', primaryDiagnosis: 'x', wardPreference: 'ICU', urgencyLevel: 'Routine' } });
      const bad = await api('POST', '/ipd/requests', { token: doctor, body: { reasonForAdmission: 'x' } });
      assert(dup.status === 409 && bad.status === 400, `duplicate request ${dup.status}, request without patient ${bad.status}`);
      noErrors(doc, 'admission request');
    });

    await step('Nurse admits the request into a free bed; admission Active, bed Occupied, request Admitted', async () => {
      const nurse = await as('nurse');
      const page = nurse.page;
      const [admitted] = await sql('SELECT id FROM hms_admissions WHERE patient_id = $1', [ctx.patientId]);
      if (!admitted) {
      await page.goto(`${BASE}/ipd/requests`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: 'Pending' }).click();
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.getByRole('button', { name: 'Admit' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      // Ward preference is matched to the right ward, and only free beds are offered.
      await dialog.getByLabel('Bed').locator(`option[value="${ctx.bed.id}"]`).waitFor({ state: 'attached', timeout: 10000 });
      assert(await dialog.getByLabel('Ward').inputValue() === String(ctx.bed.ward_id), `ward preselected ${await dialog.getByLabel('Ward').inputValue()}, expected ${ctx.bed.ward_name}`);
      await dialog.getByLabel('Bed').selectOption(String(ctx.bed.id));
      await dialog.getByRole('button', { name: 'Confirm admission' }).click();
      await toast(page, 'Patient admitted');
      }

      const [a] = await sql('SELECT * FROM hms_admissions WHERE patient_id = $1', [ctx.patientId]);
      assert(a && a.status === 'Active' && a.bed_id === ctx.bed.id && a.admitting_doctor_id === ctx.uid.doctor && a.created_by === ctx.uid.nurse, `admission ${JSON.stringify(a)}`);
      assert(new RegExp(`^ADM-${new Date().getFullYear()}-\\d{6}$`).test(a.admission_id_formatted), `formatted id ${a.admission_id_formatted}`);
      assert(a.admission_type === 'Urgent' && a.department !== `Pneumonia E2E ${s}`, `type ${a.admission_type}, department ${a.department}`);
      assert(a.expected_discharge_date, 'expected discharge date (4 days) not set');
      ctx.admissionId = a.id;
      ctx.admissionNo = a.admission_id_formatted;
      const [bed] = await sql('SELECT status FROM hms_beds WHERE id = $1', [ctx.bed.id]);
      const [r] = await sql('SELECT status, admission_id FROM hms_ipd_requests WHERE id = $1', [ctx.requestId]);
      assert(bed.status === 'Occupied' && r.status === 'Admitted' && r.admission_id === a.id, `bed ${bed.status}, request ${JSON.stringify(r)}`);

      // No second admission for the patient, no second patient in the bed.
      const nurseTok = await apiLogin('nurse');
      const again = await api('POST', '/ipd/admissions', { token: nurseTok, body: { patientId: ctx.patientId, bedId: ctx.otherBed.id } });
      const busy = await api('POST', '/ipd/admissions', { token: nurseTok, body: { patientId: ctx.patientId, bedId: ctx.bed.id } });
      assert(again.status === 409 && busy.status === 409, `re-admission ${again.status}, occupied bed ${busy.status}`);

      // Inpatients list, bed board and nurse dashboard.
      await page.goto(`${BASE}/ipd/patients`, { waitUntil: 'networkidle' });
      const listRow = page.locator('tbody tr', { hasText: ctx.patientName });
      await listRow.waitFor({ timeout: 10000 });
      const lt = await listRow.innerText();
      assert(lt.includes(ctx.admissionNo) && lt.includes(ctx.bed.bed_number) && lt.includes(`Pneumonia E2E ${s}`) && lt.includes('Admitted'), `inpatients row: ${lt}`);
      await page.goto(`${BASE}/ipd/beds`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: new RegExp(ctx.bed.ward_name) }).click();
      await page.locator(`[title="${ctx.bed.bed_number}: ${ctx.patientName}"]`).waitFor({ timeout: 10000 });
      await page.goto(`${BASE}/nurse/dashboard`, { waitUntil: 'networkidle' });
      await page.locator('tbody tr', { hasText: ctx.patientName }).waitFor({ timeout: 10000 });
      // The vitals round opens the inpatient chart on its Vitals tab (it used to open OPD triage).
      await page.getByRole('button', { name: `Record vitals for ${ctx.patientName}` }).first().click();
      await page.waitForURL(new RegExp(`/ipd/patient/${a.id}$`), { timeout: 10000 });
      await page.getByRole('button', { name: 'Save vitals' }).waitFor({ timeout: 10000 });
      assert(await page.getByRole('tab', { name: 'Vitals', exact: true }).getAttribute('aria-selected') === 'true', 'chart did not open on the Vitals tab');
      noErrors(nurse, 'admission');
    });

    await step('Bed board: nurse admits a second patient into a free bed; their pending request is closed', async () => {
      const doctor = await apiLogin('doctor');
      if (!ctx.bbPatientId) {
        ctx.bbPatientId = await newPatient(ctx.bedBoardName, '5');
        const r = await api('POST', '/ipd/requests', { token: doctor, body: { patientId: ctx.bbPatientId, reasonForAdmission: 'Observation (E2E)', primaryDiagnosis: 'Syncope', wardPreference: 'General Ward', urgencyLevel: 'Routine' } });
        assert(r.status === 201, `bed-board request ${r.status} ${JSON.stringify(r.data)}`);
      }
      const page = (await as('nurse')).page;
      const [prior] = await sql("SELECT b.id, b.bed_number, w.name AS ward_name FROM hms_admissions a JOIN hms_beds b ON b.id = a.bed_id JOIN hms_wards w ON w.id = b.ward_id WHERE a.patient_id = $1 AND a.status = 'Active'", [ctx.bbPatientId]);
      if (prior) ctx.bbBed = prior; // retry after an API restart: already admitted
      else {
      const [bed] = await freeBeds();
      assert(bed, 'no free bed for the bed-board admission');
      ctx.bbBed = bed;
      await page.goto(`${BASE}/ipd/beds`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: new RegExp(bed.ward_name) }).click();
      await page.getByRole('button', { name: `Admit a patient to bed ${bed.bed_number} (Available)` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByLabel('Patient', { exact: true }).fill(ctx.bedBoardName);
      await dialog.getByRole('option', { name: new RegExp(ctx.bedBoardName) }).click();
      await dialog.getByLabel('Admitting doctor').selectOption(String(ctx.uid.doctor));
      await dialog.getByRole('button', { name: 'Confirm admission' }).click();
      await toast(page, /Patient admitted: ADM-\d{4}-\d{6}/);
      }
      const bed = ctx.bbBed;
      const [a] = await sql("SELECT * FROM hms_admissions WHERE patient_id = $1 AND status = 'Active'", [ctx.bbPatientId]);
      assert(a && a.bed_id === bed.id, `bed-board admission ${JSON.stringify(a)}`);
      ctx.bbAdmissionId = a.id;
      const [req] = await sql('SELECT status, admission_id FROM hms_ipd_requests WHERE patient_id = $1', [ctx.bbPatientId]);
      assert(req.status === 'Admitted' && req.admission_id === a.id, `bed-board request left as ${JSON.stringify(req)}`);
      await page.goto(`${BASE}/ipd/beds`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: new RegExp(bed.ward_name) }).click();
      await page.locator(`[title="${bed.bed_number}: ${ctx.bedBoardName}"]`).waitFor({ timeout: 10000 });
      noErrors(await as('nurse'), 'bed board admission');
    });

    await step('Nurse records vitals and fluid balance; trends chart one vital each and flag out-of-range readings', async () => {
      const nurse = await as('nurse');
      const page = nurse.page;
      await page.goto(`${BASE}/ipd/patient/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      await page.getByRole('heading', { name: ctx.patientName }).waitFor({ timeout: 10000 });
      await tab(page, 'Vitals');
      const form = page.locator('form', { has: page.getByRole('button', { name: 'Save vitals' }) });
      await form.waitFor();
      const fill = async (v) => {
        for (const [label, value] of Object.entries(v)) await form.getByLabel(label, { exact: true }).fill(String(value));
        await form.getByRole('button', { name: 'Save vitals' }).click();
      };
      // An impossible value is refused with the reason, nothing is stored.
      await fill({ 'Pulse (bpm)': 400 });
      await toast(page, 'Pulse must be between');
      await form.getByLabel('Pulse (bpm)', { exact: true }).fill('');
      const readings = [
        { 'Systolic BP': 150, 'Diastolic BP': 95, 'Pulse (bpm)': 112, 'Temperature (°F)': 101.2, 'SpO2 (%)': 91, 'Respiratory rate': 24, 'Oral intake (mL)': 200, 'IV intake (mL)': 500, 'Urine output (mL)': 300, 'Drain output (mL)': 50 },
        { 'Systolic BP': 120, 'Diastolic BP': 80, 'Pulse (bpm)': 80, 'Temperature (°F)': 98.4, 'SpO2 (%)': 97, 'Respiratory rate': 16 },
        { 'Systolic BP': 85, 'Diastolic BP': 55, 'Pulse (bpm)': 58, 'SpO2 (%)': 94, 'Oral intake (mL)': 150, 'Urine output (mL)': 400 },
      ];
      const [{ n: stored }] = await sql('SELECT COUNT(*)::int AS n FROM hms_ipd_vitals WHERE admission_id = $1', [ctx.admissionId]);
      for (let i = stored; i < readings.length; i++) {
        await fill(readings[i]);
        await page.locator('tbody tr').nth(i).waitFor({ timeout: 10000 });
        await sleep(1100); // distinct timestamps for the trend
      }
      const rows = await sql('SELECT * FROM hms_ipd_vitals WHERE admission_id = $1 ORDER BY id', [ctx.admissionId]);
      assert(rows.length === 3, `expected 3 vitals rows, got ${rows.length}`);
      assert(rows.every((r) => r.patient_id === ctx.patientId && r.recorded_by === ctx.uid.nurse), 'vitals not linked to patient / nurse');
      assert(rows[0].bp_systolic === 150 && Number(rows[0].temperature) === 101.2 && rows[0].spo2 === 91 && rows[0].intake_iv_ml === 500, `reading 1 ${JSON.stringify(rows[0])}`);
      // The intake / output boxes are cleared after a save, so reading 2 must not repeat reading 1's fluids.
      assert([rows[1].intake_oral_ml, rows[1].intake_iv_ml, rows[1].output_urine_ml, rows[1].output_drain_ml].every((v) => v === 0), `reading 2 fluids ${JSON.stringify(rows[1])}`);
      const inTotal = rows.reduce((t, r) => t + r.intake_oral_ml + r.intake_iv_ml, 0);
      const outTotal = rows.reduce((t, r) => t + r.output_urine_ml + r.output_drain_ml, 0);
      assert(inTotal === 850 && outTotal === 750, `fluid totals in ${inTotal} out ${outTotal}`);

      const balance = page.locator('section', { has: page.getByRole('heading', { name: 'Fluid balance', exact: true }) });
      const bt = (await balance.innerText()).replace(/\s+/g, ' ').toLowerCase(); // labels are upper-cased by CSS
      assert(bt.includes('intake 850 ml') && bt.includes('output 750 ml') && bt.includes('balance +100 ml') && bt.includes('3 entries'), `fluid balance panel: ${bt}`);
      const log = await page.locator('tbody').innerText();
      assert(log.includes('In 700') && log.includes('Out 350') && log.includes('In 0') && log.includes('In 150') && log.includes('Out 400'), `vitals log: ${log}`);

      // Vital trends: one chart per vital, latest value and status, out-of-range readings circled red.
      const charts = page.locator('section.chart-card');
      assert(await charts.count() === 5, `expected 5 trend charts, got ${await charts.count()}`);
      const expect = { Pulse: ['58', 'Low', 2], 'Blood pressure': ['85/55', 'Low', 4], SpO2: ['94', 'Low', 2], Temperature: ['98.4', 'Normal', 1], 'Respiratory rate': ['16', 'Normal', 1] };
      for (const [title, [latest, status, red]] of Object.entries(expect)) {
        const chart = page.locator(`section[aria-label="${title} trend"]`);
        const head = await chart.locator('div').first().innerText();
        assert(head.includes(latest) && head.includes(status), `${title} chart header "${head}"`);
        await chart.locator('.recharts-line').first().waitFor({ timeout: 5000 });
        const n = await chart.locator('circle[stroke="var(--red)"]').count();
        assert(n === red, `${title}: ${n} out-of-range markers, expected ${red}`);
      }
      noErrors(nurse, 'vitals');
    });

    await step('MAR: nurse gives one dose and holds another with a reason; a stale action shows the error', async () => {
      const doctor = await apiLogin('doctor');
      const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
      const doses = [['Inj Ceftriaxone', '1 g', 'IV', 30], ['Tab Paracetamol', '650 mg', 'Oral', 20], ['Inj Pantoprazole', '40 mg', 'IV', 10]];
      ctx.mar = ctx.mar || {};
      for (const [name, dose, route, ago] of doses.filter(([name]) => !ctx.mar[name])) {
        const m = await api('POST', '/ipd/mar', { token: doctor, body: { admissionId: ctx.admissionId, medicineName: name, dose, route, scheduledTime: at(ago) } });
        assert(m.status === 201, `MAR create ${m.status} ${JSON.stringify(m.data)}`);
        ctx.mar[name] = m.data.data.id;
      }
      const bad = await api('POST', '/ipd/mar', { token: doctor, body: { admissionId: ctx.admissionId, dose: '1', status: 'Given' } });
      assert(bad.status === 400, `MAR without medicine/time returned ${bad.status}`);

      const nurse = await as('nurse');
      const page = nurse.page;
      await page.goto(`${BASE}/ipd/patient/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      await tab(page, 'Medications');
      const row = (name) => page.locator('tbody tr', { hasText: name });
      await row('Inj Ceftriaxone').waitFor({ timeout: 10000 });
      const [{ n: pending }] = await sql("SELECT COUNT(*)::int AS n FROM hms_mar_records WHERE admission_id = $1 AND status = 'Pending'", [ctx.admissionId]);
      if (pending === 3) { // not yet acted on (a retry after an API restart only re-checks the outcome)
      await row('Inj Ceftriaxone').getByRole('button', { name: 'Give' }).click();
      await toast(page, 'Medication marked as given');
      await row('Inj Ceftriaxone').getByText('Given', { exact: true }).waitFor();
      await row('Tab Paracetamol').getByRole('button', { name: 'Hold' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Reason for holding').fill('Afebrile, held per protocol (E2E)');
      await dialog.getByRole('button', { name: 'Hold medication' }).click();
      await toast(page, 'Medication held');
      await row('Tab Paracetamol').getByText('Held', { exact: true }).waitFor();

      // Another nurse gives the pantoprazole meanwhile; this page still shows it as pending.
      const admin = await apiLogin('admin');
      const other = await api('PATCH', `/ipd/mar/${ctx.mar['Inj Pantoprazole']}/status`, { token: admin, body: { status: 'Given' } });
      assert(other.status === 200, `admin give ${other.status}`);
      await row('Inj Pantoprazole').getByRole('button', { name: 'Give' }).click();
      await toast(page, 'already recorded');
      await row('Inj Pantoprazole').getByText('Given', { exact: true }).waitFor();
      }

      const recs = await sql('SELECT id, medicine_name, status, administered_by, administered_at, hold_reason FROM hms_mar_records WHERE admission_id = $1 ORDER BY id', [ctx.admissionId]);
      const by = Object.fromEntries(recs.map((r) => [r.medicine_name, r]));
      assert(by['Inj Ceftriaxone'].status === 'Given' && by['Inj Ceftriaxone'].administered_by === ctx.uid.nurse && by['Inj Ceftriaxone'].administered_at, `given ${JSON.stringify(by['Inj Ceftriaxone'])}`);
      assert(by['Tab Paracetamol'].status === 'Held' && by['Tab Paracetamol'].hold_reason === 'Afebrile, held per protocol (E2E)', `held ${JSON.stringify(by['Tab Paracetamol'])}`);
      assert(by['Inj Pantoprazole'].administered_by === ctx.uid.admin, 'stale give overwrote the first administration');
      const noReason = await api('PATCH', `/ipd/mar/${ctx.mar['Inj Ceftriaxone']}/status`, { token: await apiLogin('nurse'), body: { status: 'Held' } });
      const missing = await api('PATCH', '/ipd/mar/99999999/status', { token: await apiLogin('nurse'), body: { status: 'Given' } });
      assert(noReason.status === 400 || noReason.status === 409, `hold without reason ${noReason.status}`);
      assert(missing.status === 404, `unknown MAR record ${missing.status}`);
      noErrors(nurse, 'MAR');
    });

    await step('Doctor adds a progress note and the nurse a nursing note; each shows in its own tab', async () => {
      const doc = await as('doctor');
      let page = doc.page;
      await page.goto(`${BASE}/ipd/patient/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      await tab(page, 'Progress notes');
      const [hasPn] = await sql('SELECT id FROM hms_progress_notes WHERE admission_id = $1', [ctx.admissionId]);
      if (!hasPn) {
      await page.getByLabel('Subjective').fill('Breathing easier, cough persists (E2E)');
      await page.getByLabel('Objective').fill('Crackles right base, SpO2 94% on 2 L');
      await page.getByLabel('Assessment').fill(`Improving pneumonia ${s}`);
      await page.getByLabel('Plan').fill('Continue IV antibiotics, wean oxygen');
      await page.getByRole('button', { name: 'Save progress note' }).click();
      await toast(page, 'Progress note saved');
      }
      await page.getByText(`Improving pneumonia ${s}`).waitFor({ timeout: 10000 });
      await tab(page, 'Nursing');
      assert(await page.getByRole('button', { name: 'Save nursing note' }).count() === 0, 'doctor sees the nursing note form');
      noErrors(doc, 'progress note');

      const nurse = await as('nurse');
      page = nurse.page;
      await page.goto(`${BASE}/ipd/patient/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      await page.getByText(`Improving pneumonia ${s}`).waitFor({ timeout: 10000 });
      assert(await page.getByRole('button', { name: 'Save progress note' }).count() === 0, 'nurse sees the SOAP form');
      await tab(page, 'Nursing');
      const [hasNn] = await sql('SELECT id FROM hms_nursing_notes WHERE admission_id = $1', [ctx.admissionId]);
      if (!hasNn) {
      await page.getByLabel('Condition summary').fill(`Comfortable, on 2 L oxygen ${s}`);
      await page.getByLabel('Complaints (if any)').fill('Mild chest pain on coughing');
      await page.getByLabel('Actions and care provided').fill('Positioned upright, chest physiotherapy');
      await page.getByRole('button', { name: 'Save nursing note' }).click();
      await toast(page, 'Nursing note saved');
      }
      await page.getByText(`Comfortable, on 2 L oxygen ${s}`).waitFor({ timeout: 10000 });
      await tab(page, 'Progress notes');
      assert(!(await page.getByText(`Comfortable, on 2 L oxygen ${s}`).isVisible()), 'nursing note shown under progress notes');
      const [pn] = await sql('SELECT doctor_id, assessment FROM hms_progress_notes WHERE admission_id = $1', [ctx.admissionId]);
      const [nn] = await sql('SELECT nurse_id, condition_notes, complaints FROM hms_nursing_notes WHERE admission_id = $1', [ctx.admissionId]);
      assert(pn.doctor_id === ctx.uid.doctor && nn.nurse_id === ctx.uid.nurse && nn.complaints === 'Mild chest pain on coughing', `notes ${JSON.stringify([pn, nn])}`);
      noErrors(nurse, 'nursing note');
    });

    await step('Front desk takes an advance against the admission (/receptionist/ipd)', async () => {
      const rec = await as('receptionist');
      const page = rec.page;
      await page.goto(`${BASE}/receptionist/ipd`, { waitUntil: 'networkidle' });
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.waitFor({ timeout: 10000 });
      const [hasAdv] = await sql('SELECT id FROM hms_patient_advances WHERE patient_id = $1', [ctx.patientId]);
      if (!hasAdv) {
        await row.getByRole('button', { name: 'Add advance' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.getByLabel('Amount (₹)').fill('500');
        await dialog.getByRole('button', { name: 'Record advance' }).click();
        await toast(page, 'Advance recorded');
      }
      await row.getByText('₹500').waitFor({ timeout: 10000 });
      const [adv] = await sql('SELECT amount, admission_id, received_by, adjusted_bill_id FROM hms_patient_advances WHERE patient_id = $1', [ctx.patientId]);
      assert(adv && Number(adv.amount) === 500 && adv.admission_id === ctx.admissionId && adv.received_by === ctx.uid.receptionist && !adv.adjusted_bill_id, `advance ${JSON.stringify(adv)}`);
      noErrors(rec, 'advance');
    });

    await step('Doctor discharges with a discharge summary; bed released, patient leaves the active list', async () => {
      const doc = await as('doctor');
      const page = doc.page;
      await page.goto(`${BASE}/ipd/patient/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      const [cur] = await sql('SELECT status FROM hms_admissions WHERE id = $1', [ctx.admissionId]);
      if (cur.status === 'Active') {
      await page.getByRole('button', { name: 'Discharge' }).click();
      const dialog = page.getByRole('dialog', { name: 'Prepare discharge summary' });
      await dialog.waitFor();
      assert(await dialog.getByLabel('Final diagnosis').inputValue() === `Pneumonia E2E ${s}`, 'final diagnosis not prefilled from the request');
      await dialog.getByLabel('Course in hospital').fill(`Treated with IV ceftriaxone and oxygen; improved ${s}`);
      await dialog.getByLabel('Condition at discharge').selectOption('Improved');
      await dialog.getByLabel('Drug 1').fill('Tab Amoxicillin-clavulanate');
      await dialog.getByLabel('Dose 1').fill('625 mg');
      await dialog.getByLabel('Frequency 1').fill('Twice daily');
      await dialog.getByLabel('Duration 1').fill('5 days');
      await dialog.getByLabel('Warning signs').fill('Fever above 101°F, breathlessness');
      await dialog.getByRole('button', { name: 'Discharge patient' }).click();
      const confirm = page.getByRole('dialog', { name: 'Discharge this patient?' });
      await confirm.getByRole('button', { name: 'Confirm discharge' }).click();
      await toast(page, 'Patient discharged');
      }
      await page.getByRole('button', { name: 'View discharge summary' }).waitFor({ timeout: 10000 });

      const [a] = await sql('SELECT status, discharge_date FROM hms_admissions WHERE id = $1', [ctx.admissionId]);
      const [bed] = await sql('SELECT status FROM hms_beds WHERE id = $1', [ctx.bed.id]);
      const sums = await sql('SELECT * FROM hms_discharge_summaries WHERE admission_id = $1', [ctx.admissionId]);
      assert(a.status === 'Discharged' && a.discharge_date, `admission ${JSON.stringify(a)}`);
      assert(bed.status === 'Available', `bed after discharge ${bed.status}`);
      assert(sums.length === 1 && sums[0].final_diagnosis === `Pneumonia E2E ${s}` && sums[0].discharge_condition === 'Improved' && sums[0].created_by === ctx.uid.doctor
        && JSON.parse(sums[0].discharge_medications)[0].drug === 'Tab Amoxicillin-clavulanate', `summary ${JSON.stringify(sums)}`);
      const again = await api('PATCH', `/ipd/admissions/${ctx.admissionId}/discharge`, { token: await apiLogin('doctor'), body: { finalDiagnosis: 'x' } });
      assert(again.status === 409, `second discharge ${again.status}`);

      await page.goto(`${BASE}/ipd/patients`, { waitUntil: 'networkidle' });
      await page.locator('tbody tr').first().waitFor({ timeout: 10000 }).catch(() => {});
      assert(!(await page.locator('tbody').innerText()).includes(ctx.patientName), 'discharged patient still in the admitted list');
      await page.getByRole('tab', { name: 'Discharged' }).click();
      await page.locator('tbody tr', { hasText: ctx.patientName }).waitFor({ timeout: 10000 });
      noErrors(doc, 'discharge');
    });

    await step('Discharge summaries list shows the summary; it opens and prints', async () => {
      const doc = await as('doctor');
      const page = doc.page;
      await page.goto(`${BASE}/ipd/discharge-summaries`, { waitUntil: 'networkidle' });
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.waitFor({ timeout: 10000 });
      const rt = await row.innerText();
      assert(rt.includes(ctx.admissionNo) && rt.includes(`Pneumonia E2E ${s}`), `summary row ${rt}`);
      await row.getByRole('button', { name: 'View summary' }).click();
      const dialog = page.getByRole('dialog', { name: 'Discharge summary' });
      await dialog.waitFor();
      await dialog.getByText(`Treated with IV ceftriaxone and oxygen; improved ${s}`).waitFor({ timeout: 10000 });
      for (const needle of [ctx.patientName, ctx.admissionNo, 'Tab Amoxicillin-clavulanate', 'Improved']) {
        assert((await dialog.innerText()).includes(needle), `summary view has no "${needle}"`);
      }
      await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
      await dialog.getByRole('button', { name: 'Print' }).click();
      assert(await page.evaluate(() => window.__printed) === 1, 'print was not triggered');
      // Print stylesheet: the summary is visible, the app around it is not.
      await page.emulateMedia({ media: 'print' });
      assert(await page.locator('.printable-summary-container').isVisible(), 'summary hidden in print');
      const navVisible = await page.evaluate(() => { const n = document.querySelector('nav, header'); return n ? getComputedStyle(n).visibility !== 'hidden' : false; });
      assert(!navVisible, 'app navigation is printed with the summary');
      await page.emulateMedia({ media: 'screen' });
      noErrors(doc, 'discharge summaries');
    });

    await step('IPD billing: bed days and medicines accrue, discount and advance applied, bill generated and printed', async () => {
      const admin = await as('admin');
      const page = admin.page;
      const [billed] = await sql("SELECT id FROM hms_bills WHERE admission_id = $1 AND bill_type = 'IPD'", [ctx.admissionId]);
      const [w] = await sql(`SELECT GREATEST(1, EXTRACT(DAY FROM (COALESCE(a.discharge_date, NOW()::timestamp) - a.admission_date)))::int AS days
        FROM hms_admissions a WHERE a.id = $1`, [ctx.admissionId]);
      const rate = { General: 400, Private: 800, ICU: 400, 'Semi-Private': 400 }[ctx.bed.ward_type] || 400;
      ctx.wardTotal = w.days * rate;
      const [price] = await sql(`SELECT mrp FROM hms_medicine_batches WHERE medicine_id = 1 AND quantity > 0 ORDER BY expiry_date ASC LIMIT 1`);
      const unit = money(price ? price.mrp : 0);
      ctx.medTotal = money(unit * 4);
      ctx.total = money(ctx.wardTotal + ctx.medTotal);
      ctx.discount = 100;
      ctx.net = money(ctx.total - ctx.discount - 500);
      if (!billed) { // a retry after an API restart only re-checks the generated bill
      await page.goto(`${BASE}/ipd/billing`, { waitUntil: 'networkidle' });
      await page.getByPlaceholder('Search patient, UHID, ward, bed or doctor').fill(ctx.patientName);
      await page.getByRole('row', { name: `Manage billing for ${ctx.patientName}` }).click();
      await page.waitForURL(new RegExp(`/ipd/billing/${ctx.admissionId}$`));
      const summary = page.locator('section', { has: page.getByRole('heading', { name: 'Bill summary' }) });
      await summary.waitFor({ timeout: 10000 });

      const st = (await summary.innerText()).replace(/\s+/g, ' ');
      assert(st.includes(`₹${rate}/day`) && st.includes(`${w.days} day`) && st.includes(`₹${ctx.wardTotal.toFixed(2)}`), `ward charges: ${st}`);

      // Medicine at the MRP of the batch the pharmacy would issue first.
      await page.getByPlaceholder('Search medicines by name').fill('Paracetamol');
      const med = page.locator('li.list-row', { has: page.locator('.cell-primary', { hasText: /^Paracetamol$/ }) }).first();
      await med.getByRole('button', { name: 'Select' }).click();
      await med.getByLabel('Quantity').fill('4');
      await med.getByRole('button', { name: 'Add' }).click();
      await toast(page, 'Paracetamol added');
      const item = page.locator('tbody tr', { hasText: 'Paracetamol' });
      await item.waitFor();
      assert((await item.innerText()).includes(`₹${ctx.medTotal.toFixed(2)}`), `medicine line ${await item.innerText()}`);

      // Save progress -> saved drafts -> reopen.
      await page.getByRole('button', { name: 'Save progress' }).click();
      await page.waitForURL(/\/ipd\/saved-bills$/);
      const draft = page.locator('tbody tr', { hasText: ctx.patientName });
      await draft.waitFor({ timeout: 10000 });
      assert((await draft.innerText()).includes(`₹${ctx.medTotal}`), `draft row ${await draft.innerText()}`);
      await draft.getByRole('button', { name: 'Review and finalize' }).click();
      await page.waitForURL(new RegExp(`/ipd/billing/${ctx.admissionId}$`));
      await page.locator('tbody tr', { hasText: 'Paracetamol' }).waitFor({ timeout: 10000 });

      await page.getByLabel('Discount (₹)').fill(String(ctx.discount));
      const st2 = (await summary.innerText()).replace(/\s+/g, ' ');
      assert(st2.includes('Advance adjusted') && st2.includes(`₹${ctx.net.toFixed(2)}`), `summary before generating: ${st2}`);
      await page.getByRole('button', { name: 'Generate IPD bill' }).click();
      await toast(page, /Bill generated: IPD-/);
      } else await page.goto(`${BASE}/ipd/billing/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      const paper = page.locator('.bill-preview-paper');
      await paper.waitFor();
      const pt = (await paper.innerText()).replace(/\s+/g, ' ');

      const bills = await sql("SELECT * FROM hms_bills WHERE admission_id = $1 AND bill_type = 'IPD'", [ctx.admissionId]);
      assert(bills.length === 1, `expected one IPD bill, got ${bills.length}`);
      const b = bills[0];
      ctx.billNumber = b.bill_number;
      assert(money(b.total_amount) === ctx.total && money(b.discount_amount) === ctx.discount && money(b.advance_adjusted) === 500 && money(b.net_payable) === ctx.net
        && b.discount_approved_by === ctx.uid.admin && b.patient_id === ctx.patientId && b.status === 'Pending', `bill ${JSON.stringify(b)}`);
      const items = await sql('SELECT item_type, quantity, rate, amount FROM hms_bill_items WHERE bill_id = $1 ORDER BY id', [b.id]);
      assert(items.length === 2 && items[0].item_type === 'Ward' && money(items[0].amount) === ctx.wardTotal && items[1].item_type === 'Medicine' && items[1].quantity === 4 && money(items[1].amount) === ctx.medTotal,
        `bill items ${JSON.stringify(items)}`);
      const [adv] = await sql('SELECT adjusted_bill_id FROM hms_patient_advances WHERE patient_id = $1', [ctx.patientId]);
      assert(adv.adjusted_bill_id === b.id, 'advance not marked as adjusted against the bill');
      for (const needle of [b.bill_number, ctx.patientName, ctx.total.toFixed(2), ctx.discount.toFixed(2), '500.00', ctx.net.toFixed(2)]) {
        assert(pt.includes(needle), `bill preview has no "${needle}": ${pt.slice(0, 400)}`);
      }
      await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
      await page.getByRole('button', { name: 'Print bill' }).click();
      assert(await page.evaluate(() => window.__printed) === 1, 'bill print not triggered');

      // Reopening the admission shows the bill instead of billing it twice; a second bill is refused.
      await page.goto(`${BASE}/ipd/billing/${ctx.admissionId}`, { waitUntil: 'networkidle' });
      await page.locator('.bill-preview-paper', { hasText: b.bill_number }).waitFor({ timeout: 10000 });
      const twice = await api('POST', `/ipd/admissions/${ctx.admissionId}/generate-bill`, { token: await apiLogin('admin') });
      assert(twice.status === 409, `second bill for the admission returned ${twice.status}`);
      noErrors(admin, 'IPD billing');
    });

    await step('Billing history lists the IPD bill with its totals; the advance is used up', async () => {
      const admin = await as('admin');
      const page = admin.page;
      await page.goto(`${BASE}/billing/patient/${ctx.patientId}`, { waitUntil: 'networkidle' });
      const row = page.locator('tbody tr', { hasText: ctx.billNumber });
      await row.waitFor({ timeout: 10000 });
      const t = await row.innerText();
      assert(t.includes('IPD') && t.includes(`₹${ctx.net.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`) && t.includes('Pending'), `history row ${t}`);
      const kpis = (await page.locator('.kpi-strip').innerText()).replace(/\s+/g, ' ');
      assert(kpis.includes('Advance deposited ₹500') && kpis.includes('Available balance ₹0'), `advance KPIs ${kpis}`);
      noErrors(admin, 'billing history');
    });

    await step('Role access: discounts need an admin, notes by their own role; receptionist and other roles kept out of inpatient records', async () => {
      const nurseTok = await apiLogin('nurse');
      const disc = await api('POST', `/ipd/admissions/${ctx.bbAdmissionId}/generate-bill`, { token: nurseTok, body: { discountAmount: 50 } });
      assert(disc.status === 403, `nurse discount returned ${disc.status}`);
      const checks = [
        ['pharmacist reads admissions', await api('GET', '/ipd/admissions', { token: await apiLogin('pharmacist') })],
        ['lab tech reads vitals', await api('GET', `/ipd/vitals/${ctx.admissionId}`, { token: await apiLogin('lab_technician') })],
        ['receptionist records vitals', await api('POST', '/ipd/vitals', { token: await apiLogin('receptionist'), body: { admissionId: ctx.bbAdmissionId, pulse: 80 } })],
        ['pharmacist discharges', await api('PATCH', `/ipd/admissions/${ctx.bbAdmissionId}/discharge`, { token: await apiLogin('pharmacist'), body: {} })],
        ['nurse writes a progress (SOAP) note', await api('POST', '/ipd/progress-notes', { token: nurseTok, body: { admissionId: ctx.bbAdmissionId, assessment: 'x' } })],
        ['doctor writes a nursing note', await api('POST', '/ipd/nursing-notes', { token: await apiLogin('doctor'), body: { admissionId: ctx.bbAdmissionId, conditionNotes: 'x' } })],
      ];
      const wrong = checks.filter(([, r]) => r.status !== 403).map(([l, r]) => `${l}: ${r.status}`);
      assert(wrong.length === 0, `expected 403 for:\n${wrong.join('\n')}`);

      // Nurse cannot open the doctor's admission form.
      const nurse = await as('nurse');
      await nurse.page.goto(`${BASE}/ipd/admission-form?patientId=${ctx.patientId}`, { waitUntil: 'networkidle' });
      assert(!(await nurse.page.getByRole('button', { name: 'Send IPD request' }).isVisible()), 'nurse can open the admission request form');
      nurse.errors.splice(0);

      // Known policy question: /ipd/patients is routed for receptionists but the API denies them (no ipd permission).
      const rec = await as('receptionist');
      await rec.page.goto(`${BASE}/ipd/patients`, { waitUntil: 'networkidle' });
      const recApi = await api('GET', '/ipd/admissions?status=Active', { token: await apiLogin('receptionist') });
      await rec.page.getByText('You do not have access to inpatient records').waitFor({ timeout: 10000 });
      console.log(`      (receptionist /ipd/patients: API ${recApi.status}; page shows the no-access state)`);
      rec.errors.splice(0);
    });
  } finally {
    // Release the beds this run used, whatever happened above.
    try {
      const doctor = await apiLogin('doctor');
      for (const id of [ctx.admissionId, ctx.bbAdmissionId].filter(Boolean)) {
        const [a] = await sql('SELECT status FROM hms_admissions WHERE id = $1', [id]);
        if (a && a.status === 'Active') await api('PATCH', `/ipd/admissions/${id}/discharge`, { token: doctor, body: { finalDiagnosis: 'E2E cleanup', chiefComplaint: 'E2E cleanup' } });
      }
    } catch (e) { console.log(`      cleanup: ${e.message}`); }
    for (const sess of Object.values(sessions)) await sess.ctx.close();
    await browser.close();
    done();
  }
})();
