// Clinical screens under failure (completion C2): shared live lists that
// never turn a failed load into an empty queue, consultation drafts and lost
// saves that survive a reload, keyboard tabs and Ctrl+S, the critical-result
// alert, and patient printouts in a second language (browser print and
// server PDF). Saves screenshots and a printed PDF to E2E_ARTIFACT_DIR.
// Run after the laboratory suites (they leave an open critical result).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, BASE, API, api, apiLogin, sql, browserAs, inCare, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 8);
const ART = process.env.E2E_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hms-c2-'));
fs.mkdirSync(ART, { recursive: true });
const HINDI_NAME = `रमेश कुमार ${tag}`;

(async () => {
  const { step, done } = runner('Clinical screens under failure');
  const browser = await chromium.launch();
  const [doctor] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  let ui, patient, encounter;
  const newEncounter = async () => {
    const [e] = await sql("INSERT INTO hms_encounters (patient_id, doctor_id, status) VALUES ($1, $2, 'Draft') RETURNING id", [patient.id, doctor.id]);
    return e.id;
  };
  try {
    await step('Setup: a synthetic patient with a Hindi name in the doctor\'s care', async () => {
      [patient] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 41, 'Male', 'OPD', hms_service_today()) RETURNING id, name, uhid", [HINDI_NAME, `C2-${tag}`]);
      await inCare(patient.id);
      ui = await browserAs(browser, 'doctor');
    });

    await step('A queue that fails to load says so instead of looking empty; a failed refresh keeps the last list and says when it was from', async () => {
      const { page } = ui;
      await page.route('**/api/patients/hms/today-patients', (route) => route.abort());
      await page.goto(`${BASE}/doctor/dashboard`, { waitUntil: 'domcontentloaded' });
      await page.getByText('Your patient queue could not be loaded').waitFor();
      await page.getByRole('alert').filter({ hasText: 'Could not load the patient queue' }).waitFor();
      assert(await page.getByText('No patients registered for you today').count() === 0, 'a failed load was shown as an empty queue');
      await page.unroute('**/api/patients/hms/today-patients');
      await page.getByRole('alert').filter({ hasText: 'Could not load the patient queue' }).getByRole('button', { name: 'Try again' }).click();
      await page.getByText(/^Updated /).first().waitFor();
      await page.route('**/api/patients/hms/today-patients', (route) => route.abort());
      await page.getByRole('button', { name: 'Refresh the patient queue' }).click();
      await page.getByRole('alert').filter({ hasText: 'Could not refresh the patient queue. Showing what it was at' }).waitFor();
      await page.screenshot({ path: path.join(ART, 'c2-queue-refresh-failed.png') });
      await page.unroute('**/api/patients/hms/today-patients');
    });

    await step('Unsaved consultation notes survive a reload and are offered back; Ctrl+S saves them', async () => {
      const { page } = ui;
      encounter = await newEncounter();
      await page.goto(`${BASE}/hms/consultation/${encounter}`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel('Chief complaint').fill(`Kept across reload ${tag}`);
      await page.waitForTimeout(800); // the draft is written after a short pause in typing
      await page.reload({ waitUntil: 'domcontentloaded' });
      const banner = page.getByRole('alert', { name: 'Unsaved notes recovered' });
      await banner.waitFor();
      await page.screenshot({ path: path.join(ART, 'c2-draft-recovered.png') });
      await banner.getByRole('button', { name: 'Restore them' }).click();
      assert(await page.getByLabel('Chief complaint').inputValue() === `Kept across reload ${tag}`, 'the draft was not restored');
      await page.getByLabel('Chief complaint').press('Control+s');
      await page.getByText('Notes saved and confirmed.').waitFor();
      const [e] = await sql('SELECT chief_complaint FROM hms_encounters WHERE id = $1', [encounter]);
      assert(e.chief_complaint === `Kept across reload ${tag}`, `saved ${e.chief_complaint}`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByLabel('Chief complaint').waitFor();
      await page.waitForTimeout(500);
      assert(await page.getByRole('alert', { name: 'Unsaved notes recovered' }).count() === 0, 'a saved draft was offered again');
    });

    await step('A save whose answer was lost is still known after a reload and is reconciled once, with its original key', async () => {
      const { page } = ui;
      encounter = await newEncounter();
      await page.goto(`${BASE}/hms/consultation/${encounter}`, { waitUntil: 'domcontentloaded' });
      const [{ record_revision: before, public_id: publicId }] = await sql('SELECT record_revision, public_id FROM hms_encounters WHERE id = $1', [encounter]);
      await page.route(`**/api/v2/encounters/${publicId}/draft`, async (route) => {
        if (route.request().method() !== 'PUT') return route.continue();
        const response = await route.fetch();
        assert(response.status() === 200, `the save did not commit: ${response.status()}`);
        await route.abort('failed'); // committed, but the answer never arrives
      });
      await page.getByLabel('Chief complaint').fill(`Lost answer ${tag}`);
      await page.getByRole('button', { name: 'Save draft' }).click({ timeout: 10000 }).catch(async (e) => { await page.screenshot({ path: path.join(ART, 'fail-lost-save.png'), fullPage: true }); throw e; });
      await page.getByText('Save outcome uncertain.', { exact: false }).waitFor();
      await page.unroute(`**/api/v2/encounters/${publicId}/draft`);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.getByText('A save was still in progress when this page closed').waitFor();
      await page.getByRole('button', { name: 'Reconcile original note request' }).click({ timeout: 10000 }).catch(async (e) => {
        await page.screenshot({ path: path.join(ART, 'fail-reconcile.png'), fullPage: true });
        const b = page.getByRole('button', { name: 'Reconcile original note request' });
        throw new Error(`reconcile: ${await b.count()} button(s), disabled=${await b.first().isDisabled().catch(() => '?')}: ${e.message.split('\n')[0]}`);
      });
      await page.getByText('Notes saved and confirmed.').waitFor();
      const [{ record_revision: after, chief_complaint: text }] = await sql('SELECT record_revision, chief_complaint FROM hms_encounters WHERE id = $1', [encounter]);
      assert(Number(after) === Number(before) + 1 && text === `Lost answer ${tag}`, `revision ${before} -> ${after}, text ${text}`);
    });

    await step('Keyboard: consultation tabs move with the arrow keys, Home and End, and each panel is labelled by its tab', async () => {
      const { page } = ui;
      const tab = (name) => page.getByRole('tab', { name, exact: true });
      await tab('History').focus();
      await page.keyboard.press('ArrowRight');
      assert(await tab('Examination').getAttribute('aria-selected') === 'true', 'ArrowRight did not select Examination');
      assert(await tab('Examination').evaluate((el) => el === document.activeElement), 'focus did not follow');
      await page.keyboard.press('End');
      assert(await tab('Investigations').getAttribute('aria-selected') === 'true', 'End did not select the last tab');
      await page.keyboard.press('ArrowRight');
      assert(await tab('History').getAttribute('aria-selected') === 'true', 'ArrowRight did not wrap to the first tab');
      const panel = page.getByRole('tabpanel', { name: 'History' });
      await panel.getByLabel('Chief complaint').waitFor();
      assert(await tab('Examination').getAttribute('tabindex') === '-1', 'unselected tabs are in the Tab order');
    });

    await step('A critical result reaches the doctor as a persistent alert, live, and opens Critical follow-up', async () => {
      const task=await require('./criticalFixture').criticalFixture(patient.id);
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      // Signed in with no critical results yet...
      let empty = true;
      await page.route('**/api/laboratory/critical-tasks', (route) => (empty ? route.fulfill({ json: { success: true, data: [] } }) : route.continue()));
      const [username, password] = require('./helpers').creds('doctor');
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      await page.fill('#login-username', username); await page.fill('#login-password', password);
      await page.click('button[type=submit]');
      await page.waitForURL((u) => !u.pathname.startsWith('/login'));
      await page.waitForTimeout(1500);
      assert(await page.getByRole('alert', { name: 'Critical laboratory results' }).count() === 0, 'alert shown with no results');
      // ...then the laboratory's live event arrives.
      empty = false;
      await sql("INSERT INTO hms_outbox (event_type, audience, payload, patient_id) VALUES ('lab_critical_result', $1, CAST($2 AS jsonb), $3)",
        [`user:${doctor.id}`, JSON.stringify({ taskId: task.id, patientId: task.patient_id }), task.patient_id]);
      const alert = page.getByRole('alert', { name: 'Critical laboratory results' });
      await alert.getByText('CRITICAL RESULT').first().waitFor({ timeout: 15000 });
      await page.screenshot({ path: path.join(ART, 'c2-critical-alert.png') });
      await alert.getByRole('link', { name: 'Open critical follow-up' }).first().click();
      await page.waitForURL(/\/lab\/governed\?tab=critical/);
      await page.getByRole('button', { name: 'Critical follow-up' }).waitFor();
      await ctx.close();
    });

    let rxId;
    await step('The prescription print shows a second language beside English, with the dose times in words', async () => {
      const doc = await apiLogin('doctor');
      const enc = (await api('POST', '/hms/encounters', { token: doc, body: { patient_id: patient.id } })).data;
      const encounterId = enc?.id ?? enc?.data?.id;
      const rx = (await api('POST', '/hms/prescriptions', { token: doc, body: { encounter_id: encounterId, patient_id: patient.id } })).data;
      assert(rx?.id, `prescription ${JSON.stringify(rx).slice(0, 160)}`);
      rxId = rx.id;
      const items = await api('PUT', `/hms/prescriptions/${rx.id}/items`, { token: doc, body: { items: [{ medicine_name: `Synthetic tablet ${tag}`, generic_name: `Synthetic tablet ${tag}`, dose: '1', dose_unit: 'Tablet', frequency: '1-0-1', duration_days: 5 }] } });
      assert(items.status === 200, `items ${items.status}`);
      const { page } = ui;
      await page.goto(`${BASE}/prescription/${rx.id}/print`, { waitUntil: 'networkidle' });
      await page.getByLabel('Second language').selectOption('hi');
      const sheet = page.locator('.prescription-preview-sheet');
      await sheet.getByText(HINDI_NAME).waitFor();
      await sheet.locator('[lang="hi"]').filter({ hasText: 'दवा' }).first().waitFor();
      await sheet.locator('[lang="hi"]').filter({ hasText: 'सुबह 1, रात 1' }).first().waitFor();
      await sheet.locator('[lang="hi"]').filter({ hasText: '5 दिन' }).first().waitFor();
      await page.getByRole('status').filter({ hasText: 'has not yet had the hospital\'s language review' }).waitFor();
      await page.emulateMedia({ media: 'print' });
      await page.pdf({ path: path.join(ART, 'c2-prescription-hindi.pdf'), format: 'A4', printBackground: true });
      await page.emulateMedia({ media: 'screen' });
      assert(fs.statSync(path.join(ART, 'c2-prescription-hindi.pdf')).size > 5000, 'printed PDF is empty');
      await page.getByLabel('Second language').selectOption('');
    });

    await step('Server PDFs print an Indian-script patient name in its own font', async () => {
      const doc = await apiLogin('doctor');
      const res = await fetch(`${API}/pdf/prescription/${rxId}`, { headers: { authorization: `Bearer ${doc}` } });
      assert(res.ok, `pdf ${res.status}`);
      const pdf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(path.join(ART, 'c2-server-prescription.pdf'), pdf);
      assert(pdf.toString('latin1').includes('NotoSansDevanagari'), 'the Devanagari font is not embedded; the name would print blank');
    });
  } finally {
    await browser.close();
    console.log(`  artifacts: ${ART}`);
  }
  done();
  process.exit();
})();
