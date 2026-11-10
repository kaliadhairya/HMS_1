// Doctors reach the laboratory workspace from their lab list (Phase 4 request
// "clinical navigation"): result review, coded ordering and critical results
// are there; the old report view says it acknowledges nothing.
const crypto = require('crypto');
const { chromium, BASE, browserAs, sql, runner, assert, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 6);

(async () => {
  const { step, done } = runner('Doctor navigation');
  const browser = await chromium.launch();
  let pid;
  try {
    await step('From the lab list, a doctor opens the patient in the laboratory workspace', async () => {
      const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
      [{ id: pid }] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 30, 'Female', 'OPD', CURRENT_DATE) RETURNING id", [`Synthetic navigation ${tag}`, `NAV-${tag}`]);
      await inCare(pid);
      const [e] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Draft') RETURNING id", [pid, doc.id]);
      const [o] = await sql("INSERT INTO hms_investigation_orders (encounter_id, patient_id, doctor_id, status) VALUES ($1, $2, $3, 'Pending') RETURNING id", [e.id, pid, doc.id]);
      await sql("INSERT INTO hms_investigation_order_items (order_id, item_name, test_category, status) VALUES ($1, 'Synthetic legacy test', 'TEST', 'Pending')", [o.id]);
      const { page, errors, ctx } = await browserAs(browser, 'doctor');
      await page.goto(`${BASE}/doctor/labs?patientId=${pid}`);
      await page.getByRole('button', { name: `Open Synthetic navigation ${tag} in the laboratory workspace` }).first().click();
      await page.waitForURL((u) => u.pathname === '/lab/governed' && u.searchParams.get('patient_id') === String(pid), { timeout: 15000 });
      await page.goto(`${BASE}/doctor/labs?patientId=${pid}`);
      await page.getByRole('button', { name: 'Order coded tests and review results' }).click();
      await page.waitForURL((u) => u.pathname === '/lab/governed' && u.searchParams.get('patient_id') === String(pid), { timeout: 15000 });
      assert(!errors.length, errors.join(' | '));
      await ctx.close();
    });
    await step('Escape closes the referral dialog and the doctor sidebar remains navigable', async () => {
      const { page, ctx } = await browserAs(browser, 'doctor');
      try {
        await page.goto(`${BASE}/doctor/dashboard`, { waitUntil: 'networkidle' });
        await page.locator('.sidebar-nav a[href="/doctor/referrals"]').click();
        const dialog = page.getByRole('dialog', { name: 'Select Referral Type' });
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        const targets = ['/doctor/rest-forms', '/doctor/dashboard', '/hms/referrals', '/hms/triage',
          '/hms/appointments', '/hms/patients/search', '/hms/patients/new', '/abdm/outside-records',
          '/hms/adt', '/ipd/patients', '/ipd/requests', '/worklist', '/downtime'];
        for (const target of targets) {
          await page.goto(`${BASE}/doctor/dashboard`, { waitUntil: 'networkidle' });
          await page.locator(`.sidebar-nav a[href="${target}"]`).first().click();
          await page.waitForURL((url) => url.pathname === target, { timeout: 10000 });
        }
      } finally { await ctx.close(); }
    });
  } finally {
    await browser.close();
  }
  done();
  process.exit();
})();
