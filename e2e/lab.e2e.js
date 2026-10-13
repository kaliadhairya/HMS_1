// Laboratory workflow, end to end, as the real roles:
// doctor orders (STAT + Routine) -> lab test queue (live) -> sample collection -> result entry with
// reference ranges (abnormal flags) -> lab report + PDFs -> doctor review (labs page, dashboard,
// consultation) -> workload / lab dashboard figures -> cancellation and access control.
// Run: cd e2e && NODE_PATH=$(npm root -g) node lab.e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, sleep, stamp, inCare} = require('./helpers');

const { step, done } = runner('Laboratory workflow');

// ── helpers ──────────────────────────────────────────────────────────────────
async function fetchBinary(url, token) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(API + url, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, type: res.headers.get('content-type') || '', disposition: res.headers.get('content-disposition') || '', buf: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      if (attempt === 19) throw e;
      await sleep(500);
    }
  }
}

// Text drawn by pdfkit: inflate each content stream and decode the hex strings of TJ operators.
function pdfText(buf) {
  const s = buf.toString('latin1');
  let out = '';
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    const end = s.indexOf('endstream', start);
    if (end < 0) break;
    let data;
    try { data = zlib.inflateSync(Buffer.from(s.slice(start, end), 'latin1')); } catch { continue; }
    for (const t of data.toString('latin1').matchAll(/\[(.*?)\]\s*TJ/gs)) {
      out += [...t[1].matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1], 'hex').toString('latin1')).join('') + '\n';
    }
  }
  return out;
}

async function expectPdf(url, token, mustContain, label) {
  const r = await fetchBinary(url, token);
  assert(r.status === 200, `${label}: HTTP ${r.status} ${r.buf.toString().slice(0, 200)}`);
  assert(r.type.includes('application/pdf'), `${label}: content-type ${r.type}`);
  assert(r.buf.length > 1500 && r.buf.subarray(0, 4).toString() === '%PDF', `${label}: not a real PDF (${r.buf.length} bytes)`);
  const text = pdfText(r.buf);
  for (const needle of mustContain) assert(text.includes(needle), `${label}: PDF text has no "${needle}"`);
  return r;
}

async function savedDownload(page, click, label) {
  const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), click()]);
  const file = path.join(os.tmpdir(), `lab-e2e-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(file);
  const buf = fs.readFileSync(file);
  fs.unlinkSync(file);
  assert(buf.length > 1500 && buf.subarray(0, 4).toString() === '%PDF', `${label}: downloaded file is not a PDF (${buf.length} bytes)`);
  return download.suggestedFilename();
}

const kpiValue = (page, label) => page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.kpi-value');
async function readKpi(page, label) {
  const loc = kpiValue(page, label);
  await loc.waitFor({ timeout: 15000 });
  for (let i = 0; i < 40; i++) {
    const t = (await loc.innerText()).trim();
    if (t && t !== '—') return t;
    await sleep(250);
  }
  return (await loc.innerText()).trim();
}

function noErrors(session, label) {
  const errs = session.errors.splice(0);
  assert(errs.length === 0, `${label}: page errors:\n${errs.join('\n')}`);
}

async function searchTable(page, placeholder, text) {
  await page.getByPlaceholder(placeholder).fill(text);
  await sleep(300);
}

// ── test ─────────────────────────────────────────────────────────────────────
(async () => {
  const s = stamp();
  const ctx = { s, patientName: `E2E Lab ${s}` };
  const browser = await chromium.launch();
  let lab; let doc;
  try {
    await step('Setup: patient and OPD encounter by the doctor (API)', async () => {
      const rec = await apiLogin('receptionist');
      const doctor = await apiLogin('doctor');
      ctx.phone = `8${String(Date.now()).slice(-9)}`;
      const p = await api('POST', '/patients/hms', {
        token: rec,
        body: {
          name: ctx.patientName, first_name: 'E2E', last_name: `Lab ${s}`, age: 46, gender: 'Female',
          patientType: 'other', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: ctx.phone,
        },
      });
      assert(p.status === 201, `patient create ${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);
      ctx.patientId = p.data.data?.id || p.data.patient?.id;
      await inCare(ctx.patientId);
      assert(ctx.patientId, 'patient id missing');
      const e = await api('POST', '/hms/encounters', { token: doctor, body: { patient_id: ctx.patientId, chief_complaint: 'Fatigue (E2E lab)' } });
      assert(e.status === 201, `encounter create ${e.status} ${JSON.stringify(e.data)}`);
      ctx.encounterId = e.data.id;
      const [u] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
      ctx.doctorUserId = u.id;
    });

    await step('Doctor orders STAT and Routine investigations; lab test queue updates live, STAT first', async () => {
      lab = await browserAs(browser, 'lab_technician');
      await lab.page.goto(`${BASE}/lab/queue`, { waitUntil: 'networkidle' });
      await lab.page.getByRole('heading', { name: 'Test queue' }).waitFor();
      await sleep(1500); // socket connects after sign-in

      const doctor = await apiLogin('doctor');
      // Same payload shape as the consultation page uses, in both spellings the API accepts.
      const stat = await api('POST', '/hms/investigation-orders', {
        token: doctor,
        body: {
          encounter_id: ctx.encounterId, patient_id: ctx.patientId, priority: 'STAT', clinical_notes: 'Pallor, rule out anaemia (E2E)',
          items: [{ test_name: 'Haemoglobin', department: 'Haematology' }, { name: 'Serum potassium', category: 'Bio-Chemistry' }],
        },
      });
      assert(stat.status === 201, `STAT order ${stat.status} ${JSON.stringify(stat.data)}`);
      const routine = await api('POST', '/hms/investigation-orders', {
        token: doctor,
        body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId, priority: 'Routine', items: [{ test_name: 'Fasting blood sugar', department: 'Bio-Chemistry' }] },
      });
      assert(routine.status === 201, `Routine order ${routine.status}`);
      // The consultation page sends order_type / urgency.
      const urgent = await api('POST', '/hms/investigation-orders', {
        token: doctor,
        body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId, order_type: 'Lab', urgency: 'Urgent', items: [{ name: 'Urine routine', category: 'Urine / Others' }] },
      });
      assert(urgent.status === 201, `Urgent order ${urgent.status}`);
      Object.assign(ctx, { statId: stat.data.id, routineId: routine.data.id, urgentId: urgent.data.id });

      const orders = await sql('SELECT id, urgency, status, doctor_id, encounter_id FROM hms_investigation_orders WHERE patient_id = $1 ORDER BY id', [ctx.patientId]);
      assert(orders.length === 3, `expected 3 orders, got ${orders.length}`);
      assert(orders.map((o) => o.urgency).join() === 'STAT,Routine,Urgent', `priorities stored as ${orders.map((o) => o.urgency)}`);
      assert(orders.every((o) => o.status === 'Pending' && o.doctor_id === ctx.doctorUserId && o.encounter_id === ctx.encounterId), 'orders not Pending / wrong doctor or encounter');
      const items = await sql('SELECT i.item_name, i.test_category, i.status FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.patient_id = $1 ORDER BY i.id', [ctx.patientId]);
      assert(items.map((i) => i.item_name).join() === 'Haemoglobin,Serum potassium,Fasting blood sugar,Urine routine', `items ${items.map((i) => i.item_name)}`);
      assert(items.every((i) => i.status === 'Pending'), 'items not Pending');
      assert(items[1].test_category === 'Bio-Chemistry', 'category alias not stored');

      // Socket notification and live refresh (no reload).
      await lab.page.getByText('New investigation order received').first().waitFor({ timeout: 10000 });
      await searchTable(lab.page, 'Search patient, UHID, order, test or doctor', ctx.patientName);
      const rows = lab.page.locator('tbody tr', { hasText: ctx.patientName });
      await rows.nth(2).waitFor({ timeout: 10000 });
      assert(await rows.count() === 3, `queue shows ${await rows.count()} rows for the patient`);
      const first = await rows.nth(0).innerText();
      const second = await rows.nth(1).innerText();
      const third = await rows.nth(2).innerText();
      assert(/STAT/.test(first) && first.includes('Haemoglobin') && first.includes('Serum potassium'), `first row is not the STAT order: ${first}`);
      assert(/Urgent/.test(second) && second.includes('Urine routine'), `second row: ${second}`);
      assert(/Routine/.test(third) && third.includes('Fasting blood sugar'), `third row: ${third}`);
      const waiting = await rows.nth(0).locator('td').nth(4).innerText();
      assert(/^\d+ min/.test(waiting.trim()) && waiting.includes(`ORD-${ctx.statId}`), `waiting cell: ${waiting}`);
      assert(first.includes('0 of 2 collected') && first.includes('Pending'), `STAT row status: ${first}`);
      noErrors(lab, 'test queue');
    });

    await step('Lab technician collects samples; items and orders move to Collected / In Progress', async () => {
      const page = lab.page;
      await page.goto(`${BASE}/lab/samples`, { waitUntil: 'networkidle' });
      await searchTable(page, 'Search patient, sample, barcode or test', ctx.patientName);
      const rows = page.locator('tbody tr', { hasText: ctx.patientName });
      await rows.nth(3).waitFor({ timeout: 10000 });
      assert(await rows.count() === 4, `samples rows ${await rows.count()}`);
      for (const test of ['Haemoglobin', 'Serum potassium', 'Fasting blood sugar']) {
        const btn = page.getByRole('button', { name: `Log sample for ${test}, ${ctx.patientName}` });
        await btn.click();
        await page.locator('tbody tr', { hasText: test }).filter({ hasText: ctx.patientName }).getByText('Collected').waitFor({ timeout: 10000 });
      }
      assert(await page.getByRole('button', { name: `Log sample for Urine routine, ${ctx.patientName}` }).isVisible(), 'urine sample should still be pending');

      const items = await sql(`SELECT i.id, i.item_name, i.status, i.updated_at > i.created_at AS stamped FROM hms_investigation_order_items i
        JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.patient_id = $1 ORDER BY i.id`, [ctx.patientId]);
      ctx.items = Object.fromEntries(items.map((i) => [i.item_name, i.id]));
      assert(items.slice(0, 3).every((i) => i.status === 'Collected' && i.stamped), `collected items: ${JSON.stringify(items)}`);
      assert(items[3].status === 'Pending', 'urine item should be Pending');
      const orders = await sql('SELECT id, status FROM hms_investigation_orders WHERE patient_id = $1 ORDER BY id', [ctx.patientId]);
      assert(orders.map((o) => o.status).join() === 'In Progress,In Progress,Pending', `order statuses ${orders.map((o) => o.status)}`);

      // Logging the same sample twice is refused (it used to reopen completed tests).
      const again = await api('POST', '/lab/samples', { token: await apiLogin('lab_technician'), body: { itemId: ctx.items.Haemoglobin } });
      assert(again.status === 409, `second sample log returned ${again.status}`);

      // The queue reflects the collection.
      await page.goto(`${BASE}/lab/queue`, { waitUntil: 'networkidle' });
      await searchTable(page, 'Search patient, UHID, order, test or doctor', ctx.patientName);
      const statRow = page.locator('tbody tr', { hasText: `ORD-${ctx.statId}` });
      await statRow.getByText('2 of 2 collected').waitFor({ timeout: 10000 });
      assert((await statRow.innerText()).includes('In Progress'), 'STAT order not In Progress in the queue');
      noErrors(lab, 'sample collection');
    });

    await step('Results entry with reference ranges: abnormal values flagged, orders complete', async () => {
      const page = lab.page;
      await page.goto(`${BASE}/lab/results`, { waitUntil: 'networkidle' });
      await searchTable(page, 'Search patient, UHID, test or barcode', ctx.patientName);
      const rows = page.locator('tbody tr', { hasText: ctx.patientName });
      await rows.nth(2).waitFor({ timeout: 10000 });
      assert(await rows.count() === 3, `results rows ${await rows.count()} (uncollected samples must not be listed)`);
      assert(!(await page.locator('tbody').innerText()).includes('Urine routine'), 'uncollected Urine routine is listed for result entry');

      const enter = async (test, value, range, remarks, expectHint) => {
        await page.getByRole('button', { name: `Enter result for ${test}, ${ctx.patientName}` }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByLabel('Observed value').fill(value);
        await dialog.getByLabel('Reference range').fill(range);
        await dialog.getByText(expectHint).waitFor({ timeout: 5000 });
        if (remarks) await dialog.getByLabel('Technician remarks').fill(remarks);
        await dialog.getByRole('button', { name: 'Submit result' }).click();
        await page.getByText(`Result saved for ${test}`).first().waitFor({ timeout: 10000 });
        await dialog.waitFor({ state: 'detached', timeout: 10000 });
      };

      await enter('Haemoglobin', '9.1 g/dL', '12-16 g/dL', 'Microcytic picture (E2E)', 'Below the reference range');
      let [statOrder] = await sql('SELECT status FROM hms_investigation_orders WHERE id = $1', [ctx.statId]);
      assert(statOrder.status === 'In Progress', `STAT order should stay In Progress with one result outstanding, is ${statOrder.status}`);
      await enter('Serum potassium', '4.2', '3.5-5.1 mmol/L', '', 'Within the reference range');
      await enter('Fasting blood sugar', '182 mg/dL', '70-110 mg/dL', '', 'Above the reference range');

      const items = await sql('SELECT item_name, status, result_value, reference_range, remarks FROM hms_investigation_order_items WHERE id = ANY($1) ORDER BY id',
        [[ctx.items.Haemoglobin, ctx.items['Serum potassium'], ctx.items['Fasting blood sugar']]]);
      assert(items.every((i) => i.status === 'Completed'), `items not Completed: ${JSON.stringify(items)}`);
      assert(items[0].result_value === '9.1 g/dL' && items[0].reference_range === '12-16 g/dL' && items[0].remarks === 'Microcytic picture (E2E)', `Hb saved as ${JSON.stringify(items[0])}`);
      assert(items[2].result_value === '182 mg/dL' && items[2].reference_range === '70-110 mg/dL', `FBS saved as ${JSON.stringify(items[2])}`);
      const orders = await sql('SELECT id, status FROM hms_investigation_orders WHERE patient_id = $1 ORDER BY id', [ctx.patientId]);
      assert(orders.map((o) => o.status).join() === 'Completed,Completed,Pending', `order statuses ${orders.map((o) => o.status)}`);
      [statOrder] = orders;

      // Flags as the backend reports them.
      const reps = await api('GET', '/lab/reports', { token: await apiLogin('lab_technician') });
      const statRep = reps.data.data.find((r) => r.orderId === ctx.statId);
      const routineRep = reps.data.data.find((r) => r.orderId === ctx.routineId);
      assert(statRep && routineRep, 'reports missing for the new orders');
      const flag = (rep, test) => rep.tests.find((t) => t.test === test)?.flag;
      assert(flag(statRep, 'Haemoglobin') === 'Low' && flag(statRep, 'Serum potassium') === 'Normal' && flag(routineRep, 'Fasting blood sugar') === 'High',
        `flags: ${JSON.stringify([statRep.tests, routineRep.tests])}`);
      assert(statRep.status === 'Final' && statRep.abnormalCount === 1, `STAT report ${statRep.status} abnormal=${statRep.abnormalCount}`);

      // Guards: no result for an uncollected sample, no silent overwrite of a final result.
      const labTok = await apiLogin('lab_technician');
      const early = await api('POST', `/lab/results/${ctx.items['Urine routine']}`, { token: labTok, body: { result_value: 'Normal' } });
      assert(early.status === 409, `result for uncollected sample returned ${early.status}`);
      const overwrite = await api('POST', `/lab/results/${ctx.items.Haemoglobin}`, { token: labTok, body: { result_value: '14' } });
      assert(overwrite.status === 409, `overwrite of a final result returned ${overwrite.status}`);
      noErrors(lab, 'results entry');
    });

    await step('Lab reports page: patient, tests, results and flags; PDF download works', async () => {
      const page = lab.page;
      await page.goto(`${BASE}/lab/reports`, { waitUntil: 'networkidle' });
      await searchTable(page, 'Search patient, UHID, report or test', ctx.patientName);
      const statRow = page.locator('tbody tr', { hasText: `REP-${ctx.statId}` });
      await statRow.waitFor({ timeout: 10000 });
      assert(await page.locator('tbody tr', { hasText: ctx.patientName }).count() === 2, 'expected one report per completed order');
      const text = await statRow.innerText();
      for (const needle of [ctx.patientName, 'Haemoglobin', '9.1 g/dL', 'Low', 'Serum potassium', '4.2', 'In range', 'Final', '1 abnormal']) {
        assert(text.includes(needle), `report row has no "${needle}": ${text}`);
      }
      const routineText = await page.locator('tbody tr', { hasText: `REP-${ctx.routineId}` }).innerText();
      assert(routineText.includes('182 mg/dL') && routineText.includes('High'), `routine report row: ${routineText}`);

      const name = await savedDownload(page, () => page.getByRole('button', { name: `Download PDF of REP-${ctx.statId} for ${ctx.patientName}` }).click(), 'reports page PDF');
      assert(name === `lab-report-${ctx.statId}.pdf`, `download name ${name}`);
      await expectPdf(`/pdf/lab-report/${ctx.statId}`, await apiLogin('lab_technician'),
        [ctx.patientName, 'Haemoglobin', '9.1 g/dL', '12-16 g/dL', 'L (low)', 'Serum potassium', `ORD-${ctx.statId}`], 'lab report PDF');
      const pending = await fetchBinary(`/pdf/lab-report/${ctx.urgentId}`, await apiLogin('lab_technician'));
      assert(pending.status === 409, `PDF of an unreported order returned ${pending.status}`);
      noErrors(lab, 'lab reports');
    });

    await step('Report editor: search -> new report for the patient shows ordered tests and results; save and PDF', async () => {
      const page = lab.page;
      await page.goto(`${BASE}/search`, { waitUntil: 'networkidle' });
      await page.getByLabel('Phone number').fill(ctx.phone);
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByRole('button', { name: `View report for ${ctx.patientName}` }).click();
      await page.waitForURL(new RegExp(`/report/new\\?patient_id=${ctx.patientId}$`), { timeout: 10000 });
      await page.getByRole('heading', { name: `Lab report: ${ctx.patientName}` }).waitFor({ timeout: 10000 });
      const inv = page.locator('section', { has: page.getByRole('heading', { name: 'Ordered investigations' }) });
      await inv.waitFor({ timeout: 10000 });
      const invText = await inv.innerText();
      for (const needle of [`ORD-${ctx.statId}`, 'Haemoglobin', '9.1 g/dL', '12-16 g/dL', 'Low', 'Fasting blood sugar', '182 mg/dL', 'High', 'Urine routine', 'Sample not collected']) {
        assert(invText.includes(needle), `investigations panel has no "${needle}"`);
      }
      await savedDownload(page, () => page.getByRole('button', { name: `Download PDF of order ORD-${ctx.routineId}` }).click(), 'editor order PDF');

      // The editor's normal values match the printed report (they were shifted one row in DLC / lipids).
      for (const [label, normal] of [['DLC — Eosinophils', '1-6%'], ['DLC — Lymphocytes', '20-40%']]) {
        const row = await page.locator('tr', { hasText: label }).innerText();
        assert(row.includes(normal), `editor row "${label}" shows ${row.replace(/\s+/g, ' ')}, expected ${normal}`);
      }
      await page.getByLabel('Hb (Haemoglobin) result').fill('9.1');
      await page.getByRole('button', { name: 'Save report' }).click();
      await page.waitForURL(/\/report\/\d+$/, { timeout: 10000 });
      ctx.reportId = Number(page.url().split('/').pop());
      const [rep] = await sql('SELECT patient_id, haematology, reported_by FROM hms_test_reports WHERE id = $1', [ctx.reportId]);
      assert(rep && rep.patient_id === ctx.patientId, 'test report not created for the patient');
      assert(JSON.parse(rep.haematology).hb.result === '9.1', `haematology saved as ${rep.haematology}`);
      await page.getByRole('heading', { name: `Lab report: ${ctx.patientName}` }).waitFor();
      assert(await page.getByLabel('Hb (Haemoglobin) result').inputValue() === '9.1', 'saved value not shown after reload');

      await savedDownload(page, () => page.getByRole('button', { name: 'Download PDF', exact: true }).click(), 'report editor PDF');
      await expectPdf(`/reports/${ctx.reportId}/pdf`, await apiLogin('lab_technician'), [ctx.patientName, 'Hb', '9.1'], 'report editor PDF (API)');
      noErrors(lab, 'report editor');
    });

    await step('Doctor: labs page shows results with flags; dashboard count; consultation lists the orders', async () => {
      doc = await browserAs(browser, 'doctor');
      const page = doc.page;
      await page.goto(`${BASE}/doctor/labs?patientId=${ctx.patientId}`, { waitUntil: 'networkidle' });
      await page.getByText(`Patient: ${ctx.patientName}`).waitFor({ timeout: 10000 });
      assert(await readKpi(page, 'Awaiting results') === '1', 'awaiting results should be 1 (urine routine)');
      assert(await readKpi(page, 'Results ready') === '3', 'results ready should be 3');
      assert(await readKpi(page, 'Outside reference range') === '2', 'abnormal should be 2');
      await page.getByRole('tab', { name: /Results ready/ }).click();
      const hbRow = page.locator('tbody tr', { hasText: 'Haemoglobin' });
      await hbRow.waitFor();
      const hbText = await hbRow.innerText();
      assert(hbText.includes('9.1 g/dL') && hbText.includes('Low') && hbText.includes('Completed'), `doctor Hb row: ${hbText}`);
      const fbsText = await page.locator('tbody tr', { hasText: 'Fasting blood sugar' }).innerText();
      assert(fbsText.includes('182 mg/dL') && fbsText.includes('High'), `doctor FBS row: ${fbsText}`);
      await page.getByRole('button', { name: `Review report for Haemoglobin, ${ctx.patientName}` }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const dText = await dialog.innerText();
      for (const needle of [`ORD-${ctx.statId}`, 'Haemoglobin', '9.1 g/dL', '12-16 g/dL', 'Low', 'Microcytic picture (E2E)', 'Serum potassium', 'In range']) {
        assert(dText.includes(needle), `review dialog has no "${needle}"`);
      }
      await savedDownload(page, () => dialog.getByRole('button', { name: 'Download PDF' }).click(), 'doctor review PDF');
      await dialog.getByRole('button', { name: 'Close' }).first().click();

      // Dashboard "Lab results, last 7 days" = the doctor's completed lab items ordered in the last 7 days
      // (GET /doctor/labs leaves cancelled tests out).
      const doctorLabs = await api('GET', '/doctor/labs', { token: await apiLogin('doctor') });
      const mine = doctorLabs.data.data.filter((l) => l.patient === ctx.patientName);
      assert(mine.length === 4 && mine.filter((l) => l.status === 'Completed').length === 3, `/doctor/labs for the patient: ${JSON.stringify(mine)}`);
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const expected = doctorLabs.data.data.filter((l) => String(l.status).toLowerCase() === 'completed'
        && new Date(l.orderedAt || l.date || 0).getTime() >= weekAgo).length;
      await page.goto(`${BASE}/doctor/dashboard`, { waitUntil: 'networkidle' });
      const shown = await readKpi(page, 'Lab results, last 7 days');
      assert(Number(shown) === expected, `dashboard shows ${shown}, expected ${expected} recent completed results`);

      // Consultation page lists the orders as already ordered, with their status.
      await page.goto(`${BASE}/hms/consultation/${ctx.encounterId}`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: 'Investigations' }).click();
      const ordered = page.locator('table', { has: page.locator('th', { hasText: 'Test name' }) }).first();
      await ordered.waitFor({ timeout: 10000 });
      await page.getByText('Already ordered').waitFor();
      for (const [test, status] of [['Haemoglobin', 'Completed'], ['Serum potassium', 'Completed'], ['Fasting blood sugar', 'Completed'], ['Urine routine', 'Pending']]) {
        const row = await ordered.locator('tr', { hasText: test }).innerText();
        assert(row.includes(status), `consultation "${test}" row: ${row}`);
      }
      noErrors(doc, 'doctor views');
    });

    await step('Lab workload and lab dashboard figures match the database', async () => {
      const page = lab.page;
      const labTok = await apiLogin('lab_technician');
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.goto(`${BASE}/lab/workload`, { waitUntil: 'networkidle' });
          const ui = {
            inProgress: Number(await readKpi(page, 'Tests in progress')),
            completed: Number(await readKpi(page, 'Completed today')),
            tat: await readKpi(page, 'Average turnaround'),
            abnormal: Number(await readKpi(page, 'Abnormal results today')),
          };
          const [db] = await sql(`SELECT
              (SELECT COUNT(*)::int FROM hms_investigation_order_items WHERE status IN ('Collected','Received in Lab','In Progress')) AS in_progress,
              (SELECT COUNT(*)::int FROM hms_investigation_order_items WHERE status = 'Completed' AND updated_at >= CURRENT_DATE) AS completed`);
          assert(ui.inProgress === db.in_progress, `workload in progress ${ui.inProgress} vs DB ${db.in_progress}`);
          assert(ui.completed === db.completed && ui.completed >= 3, `workload completed today ${ui.completed} vs DB ${db.completed}`);
          assert(/^\d+ min$/.test(ui.tat), `average turnaround "${ui.tat}"`);
          assert(ui.abnormal >= 2 && ui.abnormal <= ui.completed, `abnormal today ${ui.abnormal}`);
          const rate = await page.locator('.bar-row', { hasText: 'Completion rate' }).innerText();
          const pct = Math.round((ui.completed / Math.max(1, ui.inProgress + ui.completed)) * 100);
          assert(rate.includes(`${pct}%`), `completion rate "${rate}" expected ${pct}%`);

          await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
          const dash = {
            awaiting: Number(await readKpi(page, 'Orders awaiting results')),
            completedToday: Number(await readKpi(page, 'Orders completed today')),
            abnormal: Number(await readKpi(page, 'Abnormal results today')),
            overdue: Number(await readKpi(page, 'Samples overdue')),
          };
          const [d] = await sql(`SELECT
              (SELECT COUNT(*)::int FROM hms_investigation_orders WHERE status IN ('Pending','Ordered','In Progress')) AS awaiting,
              (SELECT COUNT(*)::int FROM hms_investigation_orders WHERE status = 'Completed' AND updated_at >= CURRENT_DATE) AS completed_today,
              (SELECT COUNT(*)::int FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id = i.order_id
                WHERE i.status = 'Pending' AND o.status IN ('Pending','Ordered','In Progress')
                  AND o.created_at < NOW()::timestamp - (CASE WHEN o.urgency = 'STAT' THEN INTERVAL '60 minutes' ELSE INTERVAL '240 minutes' END)) AS overdue`);
          assert(dash.awaiting === d.awaiting, `dashboard awaiting ${dash.awaiting} vs DB ${d.awaiting}`);
          assert(dash.completedToday === d.completed_today && dash.completedToday >= 2, `dashboard completed today ${dash.completedToday} vs DB ${d.completed_today}`);
          assert(dash.abnormal === ui.abnormal, `dashboard abnormal ${dash.abnormal} vs workload ${ui.abnormal}`);
          assert(dash.overdue === d.overdue, `dashboard overdue ${dash.overdue} vs DB ${d.overdue}`);
          const api1 = await api('GET', '/lab/dashboard', { token: labTok });
          assert(api1.data.data.testTypes.haematology >= 1 && api1.data.data.testTypes['bio-chemistry'] >= 2, `tests by department ${JSON.stringify(api1.data.data.testTypes)}`);
          await page.locator('.bar-row', { hasText: /bio-chemistry/i }).first().waitFor();
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e; // another workflow may have changed the lab between reads; retry
          await sleep(1000);
        }
      }
      if (lastErr) throw lastErr;
      noErrors(lab, 'workload and dashboard');
    });

    await step('Cancel an unreported order; completed orders cannot be cancelled', async () => {
      const labTok = await apiLogin('lab_technician');
      const bad = await api('PATCH', `/lab/queue/ORD-${ctx.urgentId}`, { token: labTok, body: { status: 'Done' } });
      assert(bad.status === 400, `invalid status returned ${bad.status}`);
      const done1 = await api('PATCH', `/lab/queue/ORD-${ctx.statId}`, { token: labTok, body: { status: 'Cancelled' } });
      assert(done1.status === 409, `cancelling a completed order returned ${done1.status}`);
      const c = await api('PATCH', `/lab/queue/ORD-${ctx.urgentId}`, { token: labTok, body: { status: 'Cancelled' } });
      assert(c.status === 200, `cancel returned ${c.status} ${JSON.stringify(c.data)}`);
      const [o] = await sql('SELECT status FROM hms_investigation_orders WHERE id = $1', [ctx.urgentId]);
      const [i] = await sql('SELECT status FROM hms_investigation_order_items WHERE id = $1', [ctx.items['Urine routine']]);
      assert(o.status === 'Cancelled' && i.status === 'Cancelled', `after cancel: order ${o.status}, item ${i.status}`);
      const q = await api('GET', '/lab/queue', { token: labTok });
      assert(!q.data.data.some((r) => r.orderId === ctx.urgentId), 'cancelled order still in the queue');
      const smp = await api('GET', '/lab/samples', { token: labTok });
      assert(!smp.data.data.some((r) => r.itemId === ctx.items['Urine routine']), 'cancelled sample still in the sample log');
      const again = await api('PATCH', `/lab/queue/ORD-${ctx.urgentId}`, { token: labTok, body: { status: 'Cancelled' } });
      assert(again.status === 409, `second cancel returned ${again.status}`);

      // The doctor's labs page no longer lists the cancelled test as awaiting a result.
      const page = doc.page;
      await page.goto(`${BASE}/doctor/labs?patientId=${ctx.patientId}`, { waitUntil: 'networkidle' });
      await page.getByText(`Patient: ${ctx.patientName}`).waitFor({ timeout: 10000 });
      assert(await readKpi(page, 'Awaiting results') === '0', 'cancelled test still awaiting results on the doctor labs page');
      noErrors(doc, 'doctor labs after cancel');
    });

    await step('Access control: roles cannot reach each other\'s lab and consultation APIs (403)', async () => {
      const labTok = await apiLogin('lab_technician');
      const docTok = await apiLogin('doctor');
      const pharmTok = await apiLogin('pharmacist');
      const recTok = await apiLogin('receptionist');
      const checks = [
        ['lab tech orders investigations', await api('POST', '/hms/investigation-orders', { token: labTok, body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId, items: [{ test_name: 'X' }] } })],
        ['lab tech lists doctor orders', await api('GET', '/hms/investigation-orders', { token: labTok })],
        ['lab tech starts an encounter', await api('POST', '/hms/encounters', { token: labTok, body: { patient_id: ctx.patientId } })],
        ['lab tech reads an encounter', await api('GET', `/hms/encounters/${ctx.encounterId}`, { token: labTok })],
        ['lab tech finalizes an encounter', await api('PATCH', `/hms/encounters/${ctx.encounterId}/finalize`, { token: labTok, body: {} })],
        ['doctor enters a lab result', await api('POST', `/lab/results/${ctx.items['Serum potassium']}`, { token: docTok, body: { result_value: '1' } })],
        ['doctor logs a sample', await api('POST', '/lab/samples', { token: docTok, body: { itemId: ctx.items['Urine routine'] } })],
        ['doctor cancels via the lab queue', await api('PATCH', `/lab/queue/ORD-${ctx.routineId}`, { token: docTok, body: { status: 'Cancelled' } })],
        ['pharmacist reads the lab queue', await api('GET', '/lab/queue', { token: pharmTok })],
        ['pharmacist reads lab results', await api('GET', '/lab/results', { token: pharmTok })],
        ['receptionist creates a lab report', await api('POST', '/reports', { token: recTok, body: { patientId: ctx.patientId } })],
        ['receptionist edits a lab report', await api('PUT', `/reports/${ctx.reportId}`, { token: recTok, body: { remarks: 'x' } })],
        ['pharmacist downloads a lab report PDF', await fetchBinary(`/pdf/lab-report/${ctx.statId}`, pharmTok)],
      ];
      const wrong = checks.filter(([, r]) => r.status !== 403).map(([label, r]) => `${label}: ${r.status}`);
      assert(wrong.length === 0, `expected 403 for:\n${wrong.join('\n')}`);
      const okDoc = await api('GET', '/lab/queue', { token: docTok });
      assert(okDoc.status === 200, `doctor (lab read) should see the queue, got ${okDoc.status}`);

      // Order validation.
      const noItems = await api('POST', '/hms/investigation-orders', { token: docTok, body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId, items: [] } });
      const badPriority = await api('POST', '/hms/investigation-orders', { token: docTok, body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId, priority: 'ASAP', items: [{ test_name: 'X' }] } });
      const [other] = await sql('SELECT id FROM hms_patients WHERE id <> $1 ORDER BY id LIMIT 1', [ctx.patientId]);
      const wrongPatient = await api('POST', '/hms/investigation-orders', { token: docTok, body: { encounter_id: ctx.encounterId, patient_id: other.id, items: [{ test_name: 'X' }] } });
      assert(noItems.status === 400 && badPriority.status === 400 && wrongPatient.status === 400,
        `validation: no items ${noItems.status}, bad priority ${badPriority.status}, wrong patient ${wrongPatient.status}`);
      const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM hms_investigation_orders WHERE patient_id = ANY($1)', [[ctx.patientId, other.id]]);
      const [{ m }] = await sql('SELECT COUNT(*)::int AS m FROM hms_investigation_orders WHERE patient_id = $1', [ctx.patientId]);
      assert(m === 3 && n >= 3, 'a rejected order was written');

      // UI: the lab technician is kept out of the doctor's pages.
      await lab.page.goto(`${BASE}/doctor/labs`, { waitUntil: 'networkidle' });
      assert(!(await lab.page.getByRole('heading', { name: 'Lab and diagnostics' }).isVisible()), 'lab technician can open /doctor/labs');
      lab.errors.splice(0);
    });
  } finally {
    if (lab) await lab.ctx.close();
    if (doc) await doc.ctx.close();
    await browser.close();
    done();
  }
})();
