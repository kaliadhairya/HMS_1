// OPD workflow, end to end, as the real roles:
// registration (general + corporate) -> OPD token + appointment + check-in -> nurse vitals ->
// allergy on record -> doctor consultation (history, examination, diagnosis, medicines with the
// allergy safety check, lab order, save draft, reload, finalize) -> front-desk OPD bill, cash
// payment and receipt -> patient profile and journey.
// Run: cd e2e && NODE_PATH=$(npm root -g) node opd.e2e.js
const {
  chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, stamp, sleep,
  inCare, requireThrowawayDb,
} = require('./helpers');

const S = stamp();
const GENERAL_FIRST = 'E2E OPD';
const GENERAL_NAME = `${GENERAL_FIRST} ${S}`;
const CORP_NAME = `E2E Corp ${S}`;
const QC_NAME = `E2E Allergy QC ${S}`;
const PHONE = `9${S.padStart(9, '0')}`;
const EMP_NO = `EMP-${S}`;
const ALLERGEN = 'Amoxicillin';
const SAFE_MEDICINE = 'Paracetamol';
const LAB_TEST = 'CBC';

const state = {};
const { step, done } = runner(`OPD workflow (${S})`);

// Page errors are checked per step: each step clears the session's list first (see fresh()).
const noPageErrors = (errors, where) => assert(errors.length === 0, `${where}: page errors: ${errors.join(' | ')}`);
const fresh = (session) => { session.errors.length = 0; return session; };

async function waitFor(fn, what, timeout = 10000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

// Pick a patient from one of the search-as-you-type lists (token, appointment, vitals pages).
async function pickPatient(page, query, name) {
  await page.getByPlaceholder(/Search (patient )?name or UHID/).fill(query);
  const option = page.getByRole('list', { name: 'Matching patients' }).getByRole('button', { name: new RegExp(name) });
  await option.first().waitFor({ timeout: 10000 });
  await option.first().click();
}

(async () => {
  const browser = await chromium.launch();
  const sessions = [];
  let aborted = null;
  // The shared backend restarts whenever anyone saves a file; retry a sign-in that lands mid-restart.
  const open = async (role) => {
    for (let attempt = 1; ; attempt++) {
      try {
        const s = await browserAs(browser, role);
        sessions.push(s);
        return s;
      } catch (e) {
        if (attempt >= 4) throw e;
        await waitFor(async () => (await fetch(`${API}/health`).then((r) => r.ok).catch(() => false)), 'backend health', 30000);
      }
    }
  };
  try {
    const [doctorUser] = await sql("SELECT id, name FROM hms_users WHERE username = 'doctor'");
    const [doctorRow] = await sql('SELECT id, department_id FROM hms_doctors WHERE user_id = $1 ORDER BY id LIMIT 1', [doctorUser.id]);
    state.doctorUserId = doctorUser.id;
    state.doctorDept = doctorRow ? doctorRow.department_id : null;

    // ── 1. Registration ─────────────────────────────────────────────
    const rec = await open('receptionist');

    await step('Receptionist registers a general patient (UI) and gets a UHID', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/hms/patients/new`);
      await page.getByRole('button', { name: 'Begin general registration' }).click();
      await page.getByLabel('First name').fill(GENERAL_FIRST);
      await page.getByLabel('Last name').fill(S);
      await page.getByLabel('Age').fill('34');
      await page.getByLabel('Gender').selectOption('Female');
      await page.getByLabel('Primary mobile').fill(PHONE);
      await page.getByRole('button', { name: 'Complete registration' }).click();
      await page.getByRole('heading', { name: 'Registration complete' }).waitFor();
      const [p] = await sql('SELECT id, uhid, patienttype, phonenumber, name FROM hms_patients WHERE name = $1', [GENERAL_NAME]);
      assert(p, 'patient row not created');
      assert(/^HOSP-\d{4}-\d{6}$/.test(p.uhid), `bad UHID ${p.uhid}`);
      assert(p.patienttype === 'other' && p.phonenumber === PHONE, `wrong type/phone ${p.patienttype}/${p.phonenumber}`);
      await page.getByText(p.uhid).first().waitFor();
      state.patient = p;
      noPageErrors(errors, 'registration');
    });

    await step('Receptionist registers a corporate employee (UI, /register/corporate)', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/register/corporate`);
      await page.getByLabel('Full name').fill(CORP_NAME);
      await page.getByLabel('Age (years)').fill('41');
      await page.getByLabel('Gender').selectOption('Male');
      await page.getByLabel('Employee number').fill(EMP_NO);
      await page.getByRole('button', { name: /Register and enter test results/ }).click();
      await page.waitForURL(/\/report\/\d+/, { timeout: 15000 });
      const [p] = await sql('SELECT id, uhid, patienttype, empnumber, relationship FROM hms_patients WHERE name = $1', [CORP_NAME]);
      assert(p, 'corporate patient row not created');
      assert(/^HOSP-\d{4}-\d{6}$/.test(p.uhid), `bad UHID ${p.uhid}`);
      assert(p.patienttype === 'corporate_employee' && p.empnumber === EMP_NO && p.relationship === 'Self', `wrong corporate fields ${JSON.stringify(p)}`);
      state.corp = p;
      noPageErrors(errors, 'corporate registration');
    });

    // ── 2. Token, appointment, check-in ─────────────────────────────
    await step('Receptionist issues an OPD token (/hms/opd/token) in the doctor\'s department', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/hms/opd/token`);
      await pickPatient(page, state.patient.uhid, GENERAL_NAME);
      await page.getByLabel('Doctor').selectOption(String(state.doctorUserId));
      await page.getByRole('button', { name: 'Generate token' }).click();
      await page.getByRole('status').filter({ hasText: 'Token generated' }).waitFor();
      const [t] = await sql("SELECT id, token_number, status, doctor_id, department_id FROM hms_tokens WHERE patient_id = $1 AND token_date = CURRENT_DATE", [state.patient.id]);
      assert(t, 'token row not created');
      assert(t.status === 'Waiting', `token status ${t.status}`);
      if (state.doctorDept) assert(Number(t.department_id) === Number(state.doctorDept), `token department ${t.department_id}, doctor's department is ${state.doctorDept}`);
      state.token = t;
      noPageErrors(errors, 'token');
    });

    await step('Receptionist books an appointment; it is listed with the doctor; check-in works', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/hms/appointments/book`);
      await pickPatient(page, state.patient.uhid, GENERAL_NAME);
      await page.getByLabel('Doctor').selectOption(String(state.doctorUserId));
      const slot = page.locator('fieldset button:not([disabled])').first();
      await slot.waitFor();
      const slotText = (await slot.textContent()).trim();
      await slot.click();
      await page.getByRole('button', { name: 'Confirm appointment' }).click();
      await page.waitForURL(/\/hms\/appointments$/);
      const row = page.locator('tbody tr', { hasText: GENERAL_NAME });
      await row.first().waitFor();
      const rowText = await row.first().textContent();
      assert(rowText.includes(slotText), `appointment row lacks slot ${slotText}: ${rowText}`);
      assert(rowText.includes(doctorUser.name.replace(/^Dr\.?\s*/, '')), `appointment row lacks the doctor name: ${rowText}`);
      await row.first().getByRole('button', { name: 'Check in' }).click();
      const a = await waitFor(async () => {
        // The page books for the browser's local day, which is not the database's UTC day after midnight IST.
        const [r] = await sql("SELECT id, status, slot_start, department_id FROM hms_appointments WHERE patient_id = $1 AND appointment_date::date = $2::date", [state.patient.id, new Date().toLocaleDateString('en-CA')]);
        return r && r.status === 'Checked-in' ? r : null;
      }, 'appointment check-in');
      assert(a.slot_start === slotText, `slot ${a.slot_start} != ${slotText}`);
      state.appointment = a;
      noPageErrors(errors, 'appointment');
    });

    // ── 3. Nurse vitals ─────────────────────────────────────────────
    const nurse = await open('nurse');
    await step('Nurse records vitals: unit mistakes are rejected, abnormal values are flagged', async () => {
      const { page, errors } = fresh(nurse);
      await page.goto(`${BASE}/hms/vitals/entry`);
      await pickPatient(page, state.patient.uhid, GENERAL_NAME);
      await page.getByLabel('Systolic, mmHg').fill('150');
      await page.getByLabel('Diastolic, mmHg').fill('95');
      await page.getByLabel('Temperature', { exact: true }).fill('98.6');
      await page.getByLabel('Temperature unit').selectOption('C');
      await page.getByLabel('Heart rate (bpm)').fill('110');
      await page.getByLabel('SpO2 (%)').fill('93');
      await page.getByLabel('Respiratory rate (breaths/min)').fill('20');
      await page.getByLabel('Weight (kg)').fill('70');
      await page.getByLabel('Height (cm)').fill('170');
      await page.getByRole('button', { name: 'Record vitals' }).click();
      await page.getByRole('alert').filter({ hasText: /between 30 and 45/ }).waitFor();
      const before = await sql('SELECT count(*)::int AS n FROM hms_vitals WHERE patient_id = $1', [state.patient.id]);
      assert(before[0].n === 0, '98.6 °C was stored');
      await page.getByLabel('Temperature', { exact: true }).fill('38.2');
      const chips = page.getByRole('status', { name: 'Vital sign alerts' });
      for (const a of ['High BP', 'Fever', 'Tachycardia', 'Low SpO2']) await chips.getByText(a, { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Record vitals' }).click();
      await page.getByText('Vitals recorded.').waitFor();
      const [v] = await sql('SELECT * FROM hms_vitals WHERE patient_id = $1 ORDER BY id DESC LIMIT 1', [state.patient.id]);
      assert(v, 'vitals row missing');
      assert(v.temp_unit === 'C' && Number(v.temperature) === 38.2, `temperature ${v.temperature} ${v.temp_unit}`);
      assert(Number(v.bp_systolic) === 150 && Number(v.bp_diastolic) === 95 && Number(v.pulse) === 110 && Number(v.spo2) === 93, 'vital values wrong');
      assert(Number(v.bmi) === 24.22, `BMI ${v.bmi}`);
      const alerts = JSON.parse(v.alerts || '[]');
      for (const a of ['High BP', 'Fever', 'Tachycardia', 'Low SpO2']) assert(alerts.includes(a), `alert ${a} missing: ${v.alerts}`);
      assert(!alerts.includes('Low BP') && !alerts.includes('Bradycardia'), `false alerts: ${v.alerts}`);
      state.vital = v;
      noPageErrors(errors.filter((e) => !/status of 400/.test(e)), 'vitals');
    });

    // ── 4. Allergy on record ────────────────────────────────────────
    await step('Nurse records an allergy from the patient profile (UI)', async () => {
      const { page, errors } = fresh(nurse);
      await page.goto(`${BASE}/hms/patients/${state.patient.id}`);
      await page.getByRole('tab', { name: 'Allergies and conditions' }).click();
      await page.getByRole('button', { name: 'Add allergy' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Allergen').fill(ALLERGEN);
      await dialog.getByLabel('Reaction').fill('Urticarial rash');
      await dialog.getByLabel('Severity').selectOption('Severe');
      await dialog.getByRole('button', { name: 'Save allergy' }).click();
      await dialog.waitFor({ state: 'detached' });
      await page.locator('main').getByText(ALLERGEN).first().waitFor();
      const rows = await sql('SELECT allergen, reaction, severity, noted_by FROM hms_allergies WHERE patient_id = $1', [state.patient.id]);
      assert(rows.length === 1 && rows[0].allergen === ALLERGEN && rows[0].severity === 'Severe', `allergy rows ${JSON.stringify(rows)}`);
      noPageErrors(errors, 'allergy');
    });

    // ── 5. Doctor consultation ──────────────────────────────────────
    const doc = await open('doctor');
    await step('Doctor sees the patient waiting in the dashboard queue and starts the consultation', async () => {
      const { page, errors } = fresh(doc);
      await page.goto(`${BASE}/doctor/dashboard`);
      await page.getByPlaceholder('Search patient, UHID or phone').fill(state.patient.uhid);
      const row = page.locator('tbody tr', { hasText: GENERAL_NAME }).first();
      await row.waitFor();
      assert((await row.textContent()).includes('Waiting'), 'patient not shown as waiting');
      await row.getByRole('button', { name: 'Start consultation' }).click();
      // Starting opens the row's action menu with the next steps; open the consultation from it.
      await page.getByRole('menuitem', { name: 'Open consultation' }).click();
      await page.waitForURL(/\/hms\/consultation\/\d+/);
      state.encounterId = Number(page.url().match(/consultation\/(\d+)/)[1]);
      const [e] = await sql('SELECT * FROM hms_encounters WHERE id = $1', [state.encounterId]);
      assert(e && Number(e.patient_id) === Number(state.patient.id) && e.status === 'Draft', 'encounter not created as Draft');
      assert(Number(e.token_id) === Number(state.token.id), `encounter token ${e.token_id} != ${state.token.id}`);
      assert(Number(e.appointment_id) === Number(state.appointment.id), `encounter appointment ${e.appointment_id} != ${state.appointment.id}`);
      const [t] = await sql('SELECT status FROM hms_tokens WHERE id = $1', [state.token.id]);
      assert(t.status === 'In Consultation', `token status ${t.status}`);
      noPageErrors(errors, 'doctor dashboard');
    });

    await step('Consultation shows the allergy and the nurse\'s vitals with their unit', async () => {
      const { page, errors } = fresh(doc);
      const allergyBox = page.getByRole('region', { name: 'Patient allergies' });
      await allergyBox.getByText(ALLERGEN).waitFor();
      assert(!(await allergyBox.textContent()).includes('No known allergies'), 'claims no known allergies');
      const vitalsBox = page.getByRole('region', { name: 'Latest vitals' });
      await vitalsBox.getByText('150/95').waitFor();
      await vitalsBox.getByText(/38\.2\s*°C/).waitFor();
      noPageErrors(errors, 'consultation load');
    });

    await step('Doctor documents history, examination and diagnosis', async () => {
      const { page, errors } = fresh(doc);
      await page.getByLabel('Chief complaint').fill('Fever and sore throat for 3 days');
      await page.getByLabel('History of present illness (HOPI)').fill('High grade fever, no rigors');
      await page.getByRole('tab', { name: 'Examination' }).click();
      await page.getByLabel('General examination').fill('Febrile, throat congested');
      await page.getByRole('tab', { name: 'Diagnosis' }).click();
      await page.getByLabel('Search ICD-10').fill('fever');
      await page.getByRole('button', { name: /R50\.9/ }).click();
      await page.locator('table').getByText('R50.9').waitFor();
      noPageErrors(errors, 'history/diagnosis');
    });

    await step('Prescribing a medicine the patient is allergic to needs explicit confirmation', async () => {
      const { page, errors } = fresh(doc);
      await page.getByRole('tab', { name: 'Prescription' }).click();
      const rxTable = page.locator('table', { hasText: 'Frequency' });
      // A medicine with no recorded allergy is added straight away.
      await page.getByLabel('Search medicine').fill(SAFE_MEDICINE);
      await page.getByRole('button', { name: new RegExp(`^${SAFE_MEDICINE}`) }).first().click();
      await rxTable.getByText(SAFE_MEDICINE).waitFor();
      assert(await page.getByRole('dialog').count() === 0, 'warning shown for a safe medicine');
      // Allergy match: warning names the allergy; Cancel keeps it off the prescription.
      await page.getByLabel('Search medicine').fill(ALLERGEN);
      await page.getByRole('button', { name: new RegExp(`^${ALLERGEN}`) }).first().click();
      let dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const text = await dialog.textContent();
      assert(/allerg/i.test(text) && text.includes(ALLERGEN), `warning does not name the allergy: ${text}`);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      assert(await rxTable.getByText(ALLERGEN).count() === 0, 'cancelled medicine was added');
      // Prescribe anyway adds it, and the row stays flagged.
      await page.getByLabel('Search medicine').fill(ALLERGEN);
      await page.getByRole('button', { name: new RegExp(`^${ALLERGEN}`) }).first().click();
      dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Prescribe anyway' }).click();
      await dialog.waitFor({ state: 'detached' });
      await rxTable.getByText(ALLERGEN).first().waitFor();
      noPageErrors(errors, 'prescription');
    });

    await step('Doctor orders a lab test, saves the draft, and everything reloads', async () => {
      const { page, errors } = fresh(doc);
      await page.getByRole('tab', { name: 'Investigations' }).click();
      await page.getByLabel('Category').selectOption('Haematology');
      await page.getByLabel('Test name').fill(LAB_TEST);
      await page.getByRole('button', { name: 'Add test' }).click();
      await page.getByLabel('Priority').selectOption('Urgent');
      await page.getByRole('button', { name: /Send 1 test to lab/ }).click();
      await page.getByText('Already ordered').waitFor();
      await page.getByRole('button', { name: 'Save draft' }).click();
      await page.getByText('Consultation draft saved').waitFor();
      await page.reload();
      await page.getByRole('region', { name: 'Patient allergies' }).getByText(ALLERGEN).waitFor();
      assert(await page.getByLabel('Chief complaint').inputValue() === 'Fever and sore throat for 3 days', 'chief complaint not reloaded');
      await page.getByRole('tab', { name: 'Examination' }).click();
      assert(await page.getByLabel('General examination').inputValue() === 'Febrile, throat congested', 'examination not reloaded');
      await page.getByRole('tab', { name: 'Diagnosis' }).click();
      await page.locator('table').getByText('R50.9').waitFor();
      await page.getByRole('tab', { name: 'Prescription' }).click();
      const rxTable = page.locator('table', { hasText: 'Frequency' });
      await rxTable.getByText(SAFE_MEDICINE).waitFor();
      await rxTable.getByText(ALLERGEN).first().waitFor();
      await page.getByRole('tab', { name: 'Investigations' }).click();
      await page.locator('table', { hasText: 'Status' }).getByText(LAB_TEST).waitFor();
      const items = await sql(`SELECT pi.medicine_name FROM hms_prescription_items pi JOIN hms_prescriptions p ON p.id = pi.prescription_id
                               WHERE p.encounter_id = $1 ORDER BY pi.id`, [state.encounterId]);
      assert(items.length === 2 && items.some((i) => i.medicine_name.startsWith(SAFE_MEDICINE)) && items.some((i) => i.medicine_name.startsWith(ALLERGEN)),
        `prescription items ${JSON.stringify(items)}`);
      const labs = await sql(`SELECT i.item_name, i.test_category, o.status, o.urgency FROM hms_investigation_order_items i
                              JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.encounter_id = $1`, [state.encounterId]);
      assert(labs.length === 1 && labs[0].item_name === LAB_TEST && labs[0].test_category === 'Haematology', `lab orders ${JSON.stringify(labs)}`);
      assert(labs[0].urgency === 'Urgent', `lab priority ${labs[0].urgency}`);
      const [e] = await sql('SELECT hopi, general_examination FROM hms_encounters WHERE id = $1', [state.encounterId]);
      assert(e.hopi === 'High grade fever, no rigors' && e.general_examination === 'Febrile, throat congested', 'notes not saved');
      noPageErrors(errors, 'draft reload');
    });

    await step('Doctor finalizes; token, appointment and prescription follow; no second finalize', async () => {
      const { page, errors } = fresh(doc);
      await page.getByRole('button', { name: 'Finalize encounter' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('button', { name: 'Finalize encounter' }).click();
      await page.waitForURL((u) => !/\/hms\/consultation\//.test(u.pathname), { timeout: 15000 });
      const [e] = await sql('SELECT status FROM hms_encounters WHERE id = $1', [state.encounterId]);
      assert(e.status === 'Finalized', `encounter ${e.status}`);
      const [t] = await sql('SELECT status FROM hms_tokens WHERE id = $1', [state.token.id]);
      assert(t.status === 'Done', `token ${t.status}`);
      const [a] = await sql('SELECT status FROM hms_appointments WHERE id = $1', [state.appointment.id]);
      assert(a.status === 'Completed', `appointment ${a.status}`);
      const [rx] = await sql('SELECT id, status, qr_data FROM hms_prescriptions WHERE encounter_id = $1', [state.encounterId]);
      assert(rx && rx.status === 'Finalized' && rx.qr_data, `prescription ${JSON.stringify(rx)}`);
      state.prescriptionId = rx.id;
      const token = await apiLogin('doctor');
      const again = await api('PATCH', `/hms/encounters/${state.encounterId}/finalize`, { token, body: {} });
      assert(again.status === 400, `second finalize returned ${again.status}`);
      const edit = await api('PUT', `/hms/encounters/${state.encounterId}`, { token, body: { hopi: 'changed' } });
      assert(edit.status === 400, `edit after finalize returned ${edit.status}`);
      const rxEdit = await api('PUT', `/hms/prescriptions/${rx.id}/items`, { token, body: { items: [{ medicine_name: 'Ibuprofen' }] } });
      assert(rxEdit.status === 400, `prescription edit after finalize returned ${rxEdit.status}`);
      const dx = await api('POST', '/hms/diagnoses', { token, body: { encounter_id: state.encounterId, icd10_code: 'J02.9', icd10_description: 'Pharyngitis' } });
      assert(dx.status === 400, `diagnosis added after finalize: ${dx.status}`);
      noPageErrors(errors, 'finalize');
    });

    // ── 6. Patient safety on the other prescribing screens ──────────
    await step('Finalized consultation is read-only; failed allergy load shows "Allergies not checked"', async () => {
      const { page, errors } = fresh(doc);
      await page.goto(`${BASE}/hms/consultation/${state.encounterId}`);
      await page.getByRole('region', { name: 'Patient allergies' }).getByText(ALLERGEN).waitFor();
      assert(await page.getByRole('button', { name: 'Finalize encounter' }).count() === 0, 'finalize offered on a finalized encounter');
      await page.route('**/api/medication/allergies/*', (route) => route.abort());
      await page.reload();
      const box = page.getByRole('region', { name: 'Patient allergies' });
      await box.getByText('Allergies not checked').waitFor();
      const text = await box.textContent();
      assert(!text.includes('No known allergies'), 'claims no known allergies when the check failed');
      await page.unroute('**/api/medication/allergies/*');
      noPageErrors(errors.filter((e) => !/ERR_FAILED|Failed to load allerg/i.test(e)), 'read-only consultation');
    });

    await step('Prescription slip shows the allergy and warns before adding the allergen', async () => {
      const { page, errors } = fresh(doc);
      await page.goto(`${BASE}/hms/prescription-slip?patientId=${state.patient.id}`);
      const box = page.getByRole('region', { name: 'Patient allergies' });
      await box.getByText(ALLERGEN).waitFor();
      await page.getByPlaceholder('Search medicine by generic or brand name').fill(ALLERGEN.slice(0, 6));
      await page.locator('.search-dropdown').getByRole('button', { name: new RegExp(ALLERGEN) }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert((await dialog.textContent()).includes(ALLERGEN), 'slip warning does not name the allergy');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
      const names = await page.locator('.medicine-name-input').evaluateAll((els) => els.map((e) => e.value));
      assert(!names.some((n) => n.toLowerCase().includes(ALLERGEN.toLowerCase())), `slip kept the cancelled medicine: ${names}`);
      noPageErrors(errors, 'prescription slip');
    });

    await step('Quick consult shows allergies truthfully and warns on an allergen', async () => {
      const { page, errors } = fresh(doc);
      const recToken = await apiLogin('receptionist');
      const qc = await api('POST', '/patients/hms', { token: recToken, body: { patientType: 'other', name: QC_NAME, age: 52, gender: 'Male', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `8${S.padStart(9, '0')}` } });
      assert(qc.status === 201, `quick consult patient ${qc.status}`);
      await inCare(qc.data.data.id);
      assert(qc.status === 201, `QC patient: ${qc.status}`);
      state.qcPatient = qc.data.data;
      const al = await api('POST', `/patients/hms/${state.qcPatient.id}/allergies`, { token: await apiLogin('doctor'), body: { allergen: 'paracetamol', severity: 'Moderate' } });
      assert(al.status === 201, `QC allergy: ${al.status}`);

      // Patient with an allergy
      await page.goto(`${BASE}/doctor/quick-consult`);
      await page.getByPlaceholder('Search patient name, ID or UHID').fill(state.qcPatient.uhid);
      await page.getByRole('button', { name: new RegExp(QC_NAME) }).click();
      await page.getByRole('region', { name: 'Patient allergies' }).getByText('paracetamol').waitFor();
      await page.getByRole('tab', { name: 'Prescription' }).click();
      await page.getByLabel('Search medicine to prescribe').fill('Paracet');
      await page.getByRole('button', { name: /^Paracetamol/ }).first().click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      assert(/paracetamol/i.test(await dialog.textContent()), 'quick consult warning does not name the allergy');
      await dialog.getByRole('button', { name: 'Cancel' }).click();

      // Patient with none on record (the doctor must be in the patient's care to read allergies)
      await inCare(state.corp.id);
      await page.getByRole('button', { name: 'Back to search' }).click();
      await page.getByPlaceholder('Search patient name, ID or UHID').fill(state.corp.uhid);
      await page.getByRole('button', { name: new RegExp(CORP_NAME) }).click();
      await page.getByRole('region', { name: 'Patient allergies' }).getByText('No known allergies').waitFor();
      noPageErrors(errors, 'quick consult');
    });

    // ── 7. Billing ──────────────────────────────────────────────────
    await step('Front desk opens the OPD bill from billing, takes cash and gets a receipt', async () => {
      const { page, errors } = fresh(rec);
      const [consult] = await sql(`SELECT rate, gst_rate FROM hms_tariffs WHERE category = 'Consultation' AND is_active = 1
                                   AND (doctor_id = $1 OR doctor_id IS NULL) ORDER BY doctor_id DESC NULLS LAST LIMIT 1`, [state.doctorUserId]);
      const [lab] = await sql(`SELECT rate, gst_rate FROM hms_tariffs WHERE category = 'Lab' AND is_active = 1 AND UPPER(name) LIKE '%' || UPPER($1) || '%' LIMIT 1`, [LAB_TEST]);
      const fee = consult ? Number(consult.rate) : 200;
      const labRate = lab ? Number(lab.rate) : 100;
      const gst = (consult ? fee * Number(consult.gst_rate) / 100 : 0) + (lab ? labRate * Number(lab.gst_rate) / 100 : 0);
      state.expectedNet = Math.round((fee + labRate + gst) * 100) / 100;

      await page.goto(`${BASE}/receptionist/billing`);
      const row = page.locator('tbody tr', { hasText: GENERAL_NAME }).first();
      await row.waitFor();
      await row.getByRole('button', { name: /Open billing/ }).click();
      await page.waitForURL(new RegExp(`/billing/opd/${state.encounterId}$`));
      await page.getByRole('heading', { name: 'OPD billing' }).waitFor();
      const [bill] = await sql('SELECT * FROM hms_bills WHERE encounter_id = $1', [state.encounterId]);
      assert(bill && bill.bill_type === 'OPD' && bill.status === 'Pending', `bill ${JSON.stringify(bill)}`);
      assert(Number(bill.net_payable) === state.expectedNet, `net payable ${bill.net_payable}, expected ${state.expectedNet}`);
      const items = await sql('SELECT item_type, quantity, rate, amount FROM hms_bill_items WHERE bill_id = $1 ORDER BY id', [bill.id]);
      assert(items.length === 2 && items[0].item_type === 'Consultation' && Number(items[0].amount) === fee && items[1].item_type === 'Lab' && Number(items[1].amount) === labRate,
        `bill items ${JSON.stringify(items)}`);
      await page.getByText(bill.bill_number).first().waitFor();
      // More than the balance due is refused (it used to be accepted and overstate the collection).
      const recToken = await apiLogin('receptionist');
      const over = await api('POST', `/billing/${bill.id}/payment`, { token: recToken, body: { amount: state.expectedNet + 50, paymentMode: 'Cash' } });
      assert(over.status === 400, `overpayment returned ${over.status}`);
      assert(Number(await page.getByLabel('Amount received (₹)').inputValue()) === state.expectedNet, 'amount not prefilled with the balance');
      await page.getByLabel('Payment mode').selectOption('Cash');
      await page.getByRole('button', { name: 'Complete payment' }).click();
      await page.getByText('Payment receipt').waitFor();
      const receiptText = await page.locator('main').textContent();
      assert(!/Invalid Date/.test(receiptText), 'receipt shows Invalid Date');
      const [paid] = await sql('SELECT status FROM hms_bills WHERE id = $1', [bill.id]);
      assert(paid.status === 'Paid', `bill status ${paid.status}`);
      const pays = await sql('SELECT amount, payment_mode, receipt_number FROM hms_payments WHERE bill_id = $1', [bill.id]);
      assert(pays.length === 1 && Number(pays[0].amount) === state.expectedNet && pays[0].payment_mode === 'Cash', `payments ${JSON.stringify(pays)}`);
      assert(receiptText.includes(pays[0].receipt_number), 'receipt number not shown');
      state.bill = bill;
      noPageErrors(errors, 'billing');
    });

    await step('Generating the bill again (UI and concurrent API calls) never duplicates it', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/billing/opd/${state.encounterId}`);
      await page.getByText('Bill fully paid').waitFor();
      const token = await apiLogin('receptionist');
      const results = await Promise.all([1, 2, 3].map(() => api('POST', '/billing/opd', { token, body: { encounterId: state.encounterId } })));
      results.forEach((r) => assert(r.status === 200 && r.data.existing === true, `regenerate returned ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`));
      const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_bills WHERE encounter_id = $1', [state.encounterId]);
      assert(n === 1, `${n} bills for one encounter`);
      const paidAgain = await api('POST', `/billing/${state.bill.id}/payment`, { token, body: { amount: 10, paymentMode: 'Cash' } });
      assert(paidAgain.status === 400, `payment on a paid bill returned ${paidAgain.status}`);
      // A consultation still in draft (the quick-consult visit) cannot be billed yet.
      const [draft] = await sql("SELECT id FROM hms_encounters WHERE patient_id = $1 AND status = 'Draft' ORDER BY id DESC LIMIT 1", [state.qcPatient.id]);
      assert(draft, 'quick consult did not open an encounter');
      const early = await api('POST', '/billing/opd', { token, body: { encounterId: draft.id } });
      assert(early.status === 409, `billing a draft consultation returned ${early.status}`);
      const [{ n: draftBills }] = await sql('SELECT count(*)::int AS n FROM hms_bills WHERE encounter_id = $1', [draft.id]);
      assert(draftBills === 0, 'a bill was created for a draft consultation');
      noPageErrors(errors, 'billing again');
    });

    await step('Legacy dispensing is blocked; a historical pharmacy invoice stays as it was and the consultation is billed once on its own invoice (API)', async () => {
      const [rec, doc, ph] = [await apiLogin('receptionist'), await apiLogin('doctor'), await apiLogin('pharmacist')];
      const pt = await api('POST', '/patients/hms', { token: rec, body: { patientType: 'other', name: `E2E OPD Rx ${S}`, age: 29, gender: 'Female', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `6${S.padStart(9, '0')}` } });
      await inCare(pt.data.data.id);
      assert(pt.status === 201, `patient ${pt.status}`);
      const med = await api('POST', '/hms/medicines', { token: ph, body: { genericName: `E2E OPD Med ${S}`, formulation: 'Tablet', strength: '5', strengthUnit: 'mg', category: 'Tablet', gstRate: 0 } });
      assert(med.status === 201 || med.status === 200, `medicine ${med.status} ${JSON.stringify(med.data).slice(0, 160)}`);
      const [m] = await sql('SELECT id FROM hms_medicines WHERE generic_name = $1', [`E2E OPD Med ${S}`]);
      const expiry = `${new Date().getFullYear() + 1}-12-31`;
      const grn = await api('POST', '/pharmacy/grn', { token: ph, body: { invoiceNumber: `E2E-OPD-${S}`, items: [{ medicineId: m.id, quantity: 10, batchNumber: `OPD${S}`, expiryDate: expiry, purchaseRate: 5, mrp: 10 }] } });
      assert(grn.status === 200 || grn.status === 201, `GRN ${grn.status} ${JSON.stringify(grn.data).slice(0, 160)}`);
      const [batch] = await sql('SELECT id FROM hms_medicine_batches WHERE medicine_id = $1', [m.id]);
      const enc = (await api('POST', '/hms/encounters', { token: doc, body: { patient_id: pt.data.data.id } })).data;
      const rx = (await api('POST', '/hms/prescriptions', { token: doc, body: { encounter_id: enc.id, patient_id: pt.data.data.id } })).data;
      const lines = await api('PUT', `/hms/prescriptions/${rx.id}/items`, { token: doc, body: { items: [{ medicine_name: `E2E OPD Med ${S}`, generic_name: `E2E OPD Med ${S}`, dose: '1', dose_unit: 'Tablet', frequency: 'BD', duration_days: 1 }] } });
      assert(lines.status === 200, `items ${lines.status}`);
      assert((await api('PATCH', `/hms/encounters/${enc.id}/finalize`, { token: doc, body: {} })).status === 200, 'finalize failed');
      const disp = await api('POST', '/pharmacy/dispense', { token: ph, body: { prescriptionId: rx.id, items: [{ prescriptionItemId: lines.data[0].id, medicineId: m.id, batchId: batch.id, quantity: 2 }] } });
      assert(disp.status === 409 && disp.data.code === 'CODED_ORDER_REQUIRED', `unsafe legacy dispense ${disp.status}`);
      // Historical invoice compatibility fixture. This is not a new medication
      // supply and never authorizes a dose or alters inventory.
      requireThrowawayDb();
      const [pharmBill] = await sql(`INSERT INTO hms_bills(patient_id,encounter_id,bill_number,bill_type,status,total_amount,net_payable)
        VALUES($1,$2,$3,'OPD','Pending',20,20) RETURNING id,net_payable`, [pt.data.data.id,enc.id,'HIST-P3-'+S]);
      await sql(`INSERT INTO hms_bill_items(bill_id,item_type,item_name,quantity,rate,amount)
        VALUES($1,'Medicine','Synthetic historical invoice item',2,10,20)`,[pharmBill.id]);
      const fee = Number((await sql("SELECT rate FROM hms_bill_items WHERE bill_id = $1 AND item_type = 'Consultation'", [state.bill.id]))[0].rate);
      // Phase 5: the consultation was charged when the visit was finalized. It is
      // billed on its own invoice; the earlier pharmacy bill is not rewritten.
      const ids = [];
      for (let i = 0; i < 2; i++) {
        const r = await api('POST', '/billing/opd', { token: rec, body: { encounterId: enc.id } });
        assert(r.status === 200 && Number(r.data.data.id) !== Number(pharmBill.id), `generate #${i + 1}: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
        ids.push(Number(r.data.data.id));
      }
      assert(ids[0] === ids[1], `regenerating returned another bill (${ids})`);
      const bills = await sql('SELECT id, net_payable, total_amount FROM hms_bills WHERE encounter_id = $1 ORDER BY id', [enc.id]);
      const consult = await sql("SELECT bi.amount FROM hms_bill_items bi JOIN hms_bills b ON b.id = bi.bill_id WHERE b.encounter_id = $1 AND bi.item_type = 'Consultation'", [enc.id]);
      assert(bills.length === 2 && consult.length === 1 && Number(consult[0].amount) === fee, `bills ${JSON.stringify(bills)}, consultation lines ${JSON.stringify(consult)}`);
      const old = bills.find((b) => Number(b.id) === Number(pharmBill.id));
      assert(Number(old.net_payable) === 20 && Number(old.total_amount) === 20, `historical bill changed: ${JSON.stringify(old)}`);
      await api('POST', '/pharmacy/return', { token: ph, body: { batchId: batch.id, quantity: 10, type: 'discard', reason: 'E2E test cleanup' } });
    });

    // ── 8. Profile and journey ──────────────────────────────────────
    await step('Patient profile shows the visit, prescription and bill', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/hms/patients/${state.patient.id}`);
      await page.getByText(ALLERGEN).first().waitFor();
      await page.getByRole('tab', { name: 'Visits' }).click();
      await page.locator('tbody tr', { hasText: 'Finalized' }).first().waitFor();
      await page.getByRole('tab', { name: 'Prescriptions' }).click();
      await page.locator('tbody tr', { hasText: '2 medicines' }).first().waitFor();
      await page.getByRole('tab', { name: 'Billing' }).click();
      const billRow = page.locator('tbody tr', { hasText: state.bill.bill_number }).first();
      await billRow.waitFor();
      assert((await billRow.textContent()).includes('Paid'), 'bill not shown as paid');
      noPageErrors(errors, 'profile');
    });

    await step('Patient journey shows the visit, prescription and bill', async () => {
      const { page, errors } = fresh(rec);
      await page.goto(`${BASE}/patient/${state.patient.id}/journey`);
      const list = page.locator('ol.timeline');
      await list.getByText(/OPD visit with Dr\./).first().waitFor();
      await list.getByText(/Prescription, 2 medicines/).first().waitFor();
      await list.getByText(new RegExp(`Bill ${state.bill.bill_number}.*Paid`)).first().waitFor();
      noPageErrors(errors, 'journey');
    });
  } catch (e) {
    aborted = e;
    console.log(`  ✗ aborted: ${e.message}`);
  } finally {
    for (const s of sessions) await s.ctx.close().catch(() => {});
    await browser.close();
    done();
    if (aborted) process.exitCode = 1;
  }
})();
