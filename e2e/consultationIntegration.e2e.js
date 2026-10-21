// Synthetic clinical UI acceptance on an explicitly disposable database.
const crypto = require('node:crypto');
const { chromium, BASE, api, apiLogin, sql, browserAs, inCare, runner, assert, requireThrowawayDb } = require('./helpers');
requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 8);
const { step, done } = runner('Coded consultation integration');
(async () => {
  const browser = await chromium.launch();
  let ui, patient, encounter, test;
  try {
    await step('Prepare a synthetic patient in care and an approved laboratory catalogue version', async () => {
      [patient] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Other','OPD',hms_service_today()) RETURNING id, name, uhid", [`Synthetic consultation ${tag}`, `FINAL-${tag}`]);
      await inCare(patient.id);
      const [doctor] = await sql("SELECT id FROM hms_users WHERE username='doctor'");
      [encounter] = await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id", [patient.id, doctor.id]);
      [test] = await sql("SELECT v.id FROM hms_lab_test_versions v JOIN hms_lab_tests t ON t.id=v.test_id WHERE t.code_system='TEST-DEV' AND v.effective_at<=now() ORDER BY v.created_at DESC LIMIT 1");
      assert(test, 'Run device acceptance fixtures before this suite');
      ui = await browserAs(browser, 'doctor');
    });
    await step('Consultation uses coded medicine identities, unknown allergy state, and preserves medication entry across tabs', async () => {
      const page = ui.page;
      await page.goto(`${BASE}/hms/consultation/${encounter.id}`, { waitUntil: 'domcontentloaded' });
      await page.locator('button').filter({ hasText: /^Prescription$/ }).click();
      await page.getByLabel('Approved product', { exact: true }).waitFor();
      assert(await page.getByLabel('Dose', { exact: true }).inputValue() === '', 'A dose was invented');
      assert(await page.locator('#cn-med-search').count() === 0, 'Legacy medicine writer remains');
      await page.getByRole('region', { name: 'Governed allergy review' }).locator('strong').filter({ hasText: /^(Allergy status unknown|Allergies not reviewed yet)$/ }).waitFor();
      assert(await page.getByRole('region', { name: 'Governed allergy review' }).locator('strong').filter({ hasText: /^(Allergy status unknown|Allergies not reviewed yet)$/ }).count() === 1, 'An empty allergy list was treated as reviewed-none');
      await page.getByLabel('Dose', { exact: true }).fill('0.25');
      await page.locator('button').filter({ hasText: /^History$/ }).click();
      await page.locator('button').filter({ hasText: /^Prescription$/ }).click();
      assert(await page.getByLabel('Dose', { exact: true }).inputValue() === '0.25', 'Switching tabs discarded the medicine draft');
    });
    await step('Coded laboratory ordering preserves chart notes and reconciles a committed-but-lost response once', async () => {
      const page = ui.page;
      await page.locator('button').filter({ hasText: /^History$/ }).click();
      await page.getByLabel('Chief complaint', { exact: true }).fill('Synthetic unsaved note retained');
      await page.locator('button').filter({ hasText: /^Investigations$/ }).click();
      await page.getByLabel('Approved tests and panels', { exact: true }).selectOption(test.id);
      await page.locator('button').filter({ hasText: /^History$/ }).click();
      await page.locator('button').filter({ hasText: /^Investigations$/ }).click();
      assert(await page.getByLabel('Approved tests and panels', { exact: true }).evaluate((node) => [...node.selectedOptions].length) === 1, 'Test selection was discarded');
      let allowResponse = false;
      await page.route('**/api/laboratory/orders', async (route) => {
        if (!allowResponse) {
          const response = await route.fetch();
          assert(response.status() === 201, `Backend did not commit: ${response.status()}`);
          await route.abort('failed'); // Lost response after the real commit.
        } else await route.continue();
      });
      await page.getByRole('button', { name: 'Send coded tests to laboratory', exact: true }).click();
      await page.getByRole('button', { name: 'Reconcile original lab order', exact: true }).waitFor();
      let [count] = await sql('SELECT count(*)::int AS n FROM hms_investigation_orders WHERE encounter_id=$1', [encounter.id]);
      assert(count.n === 1, 'First command did not commit exactly once');
      allowResponse = true;
      await page.getByRole('button', { name: 'Reconcile original lab order', exact: true }).click();
      await page.getByText('Saved and confirmed.', { exact: true }).waitFor();
      [count] = await sql('SELECT count(*)::int AS n FROM hms_investigation_orders WHERE encounter_id=$1', [encounter.id]);
      assert(count.n === 1, 'Reconciliation created another investigation');
      await page.locator('button').filter({ hasText: /^History$/ }).click();
      assert(await page.getByLabel('Chief complaint', { exact: true }).inputValue() === 'Synthetic unsaved note retained', 'Order refresh overwrote the consultation draft');
      await page.unroute('**/api/laboratory/orders');
    });
    await step('Quick Consult uses the same coded orders and has no free-text medicine editor', async () => {
      const page = ui.page;
      await page.goto(`${BASE}/doctor/quick-consult`, { waitUntil: 'domcontentloaded' });
      await page.getByPlaceholder('Search patient name, ID or UHID').fill(patient.uhid);
      await page.locator('button.list-row').filter({ hasText: patient.name }).click();
      await page.locator('button').filter({ hasText: /^Prescription$/ }).click();
      await page.getByLabel('Approved product', { exact: true }).waitFor();
      assert(await page.locator('#qc-med-search').count() === 0, 'Quick Consult still writes free-text prescriptions');
      assert(await page.getByLabel('Dose', { exact: true }).inputValue() === '', 'Quick Consult invented a dose');
      assert(ui.errors.length === 0, `Page errors: ${ui.errors.join('; ')}`);
    });
    await step('Visit links open coded ordering for the exact encounter; the retired slip address is gone; historical prescriptions cannot be deleted', async () => {
      const page = ui.page;
      // The patient journey links each visit straight to coded ordering (completion A6).
      await page.goto(`${BASE}/patient/${patient.id}/journey`, { waitUntil: 'domcontentloaded' });
      const visit = page.locator('button.timeline-head', { hasText: 'visit with Dr.' }).first();
      await visit.waitFor();
      await visit.click();
      await page.getByRole('button', { name: 'Open', exact: true }).first().click();
      await page.waitForURL((url) => url.pathname === '/medication/orders');
      const target = new URL(page.url());
      assert(target.searchParams.get('patient_id') === String(patient.id) && target.searchParams.get('encounter_id') === String(encounter.id), 'Visit link lost patient/encounter identity');
      // The redirect-only screen is removed: its old address is no longer a route.
      await page.goto(`${BASE}/hms/prescription-slip?patientId=${patient.id}&encounterId=${encounter.id}`, { waitUntil: 'domcontentloaded' });
      await page.waitForURL((url) => url.pathname !== '/hms/prescription-slip');
      assert(new URL(page.url()).pathname !== '/medication/orders', 'the retired slip address still redirects to ordering');
      const [doctor] = await sql("SELECT id FROM hms_users WHERE username='doctor'");
      const [prescription] = await sql("INSERT INTO hms_prescriptions(patient_id,encounter_id,doctor_id,status) VALUES($1,$2,$3,'Draft') RETURNING id", [patient.id, encounter.id, doctor.id]);
      const token = await apiLogin('doctor');
      const result = await api('DELETE', `/doctor/prescriptions/${prescription.id}`, { token });
      assert(result.status === 409 && result.data.code === 'CLINICAL_HISTORY_IMMUTABLE', 'Historical prescription deletion remained reachable');
      assert((await sql('SELECT id FROM hms_prescriptions WHERE id=$1', [prescription.id])).length === 1, 'Historical prescription was erased');
    });
  } finally { await browser.close(); }
  done();
  process.exit();
})().catch((error) => { console.error(error.message); process.exit(1); });
