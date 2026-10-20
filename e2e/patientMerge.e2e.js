// Phase 2 part 2, duplicate review and reversible merge (migration 0011):
// likely duplicates are proposed, never merged automatically; a shared phone
// alone is not a duplicate; front desk can dismiss; only admins merge; a merge
// moves every record onto the kept patient and an unmerge returns exactly
// those records; merged records leave patient search.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp, chromium, BASE, browserAs } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const register = (token, name, phone, extra = {}) => call('POST', '/patients/hms', token, {
  patientType: 'other', name, age: 34, gender: 'Female', opdIndoor: 'OPD',
  testDate: new Date().toISOString().slice(0, 10), phoneNumber: phone, ...extra,
});

(async () => {
  const { step, done } = runner('Patient merge');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');
  const tag = stamp();
  const phone = `98${tag}`.slice(0, 10).padEnd(10, '7');
  const ctx = {};

  await step('Registering the same person twice proposes a duplicate; a family member on the same phone does not', async () => {
    // Real-looking names; the run's unique number is in the phone, not the name.
    const first = await register(desk, 'Lakshmi Narayan', phone);
    assert(first.status === 201, `first ${first.status} ${JSON.stringify(first.data)}`);
    const relative = await register(desk, 'Arjun Narayan', phone, { gender: 'Male', age: 9 });
    assert(relative.status === 201, `relative ${relative.status}`);
    const second = await register(desk, 'Lakshmi Narayanan', phone);
    assert(second.status === 201 && second.data.data.possibleDuplicates >= 1, `duplicate not flagged: ${JSON.stringify(second.data.data)}`);
    ctx.a = first.data.data.id; ctx.b = second.data.data.id; ctx.relative = relative.data.data.id;
    const open = (await call('GET', '/patients/duplicates?status=open', desk)).data.data;
    ctx.case = open.find((c) => [c.patient_a.id, c.patient_b.id].sort().join() === [ctx.a, ctx.b].sort().join());
    assert(ctx.case && ctx.case.evidence.includes('same phone, similar name'), 'case missing from the review queue');
    const pairedWithLakshmi = open.some((c) => {
      const ids = [c.patient_a.id, c.patient_b.id];
      return ids.includes(ctx.relative) && (ids.includes(ctx.a) || ids.includes(ctx.b));
    });
    assert(!pairedWithLakshmi, 'the family member sharing the phone was paired with Lakshmi');
    const [p] = await sql('SELECT identity_status FROM hms_patients WHERE id = $1', [ctx.b]);
    assert(p.identity_status === 'registered', 'patient changed before any review');
  });

  await step('Only admins merge; a nurse cannot even review', async () => {
    assert((await call('GET', '/patients/duplicates', nurse)).status === 403, 'nurse saw the review queue');
    const r = await call('POST', `/patients/duplicates/${ctx.case.id}/merge`, desk, { survivorId: ctx.a, reason: 'x' });
    assert(r.status === 403, `receptionist merged: ${r.status}`);
    assert((await call('POST', `/patients/duplicates/${ctx.case.id}/merge`, admin, { survivorId: ctx.a })).status === 400, 'merged without a reason');
  });

  await step('A merge moves every record to the kept patient and hides the duplicate from search', async () => {
    await sql("INSERT INTO hms_allergies (id, patient_id, allergen) VALUES (nextval('hms_allergy_seq'), $1, 'Sulfa')", [ctx.b]);
    await call('POST', `/patients/hms/${ctx.b}/related-persons`, desk, { name: 'Mohan', relationship: 'Husband', phone: '9876500021', isEmergencyContact: true });
    const r = await call('POST', `/patients/duplicates/${ctx.case.id}/merge`, admin, { survivorId: ctx.a, reason: 'Same Aadhaar card seen at the desk' });
    assert(r.status === 200 && r.data.data.moved >= 3, `merge ${r.status} ${JSON.stringify(r.data)}`);
    const [dup] = await sql('SELECT identity_status, merged_into_patient_id, uhid FROM hms_patients WHERE id = $1', [ctx.b]);
    assert(dup.identity_status === 'merged' && dup.merged_into_patient_id === ctx.a, JSON.stringify(dup));
    const [allergy] = await sql("SELECT patient_id FROM hms_allergies WHERE allergen = 'Sulfa' AND patient_id IN ($1, $2)", [ctx.a, ctx.b]);
    assert(allergy.patient_id === ctx.a, 'allergy not moved');
    const [oldUhid] = await sql("SELECT patient_id FROM hms_patient_identifiers WHERE system = 'UHID' AND value = $1", [dup.uhid]);
    assert(oldUhid.patient_id === ctx.a, "the duplicate's UHID no longer finds the kept patient");
    const found = (await call('GET', `/patients/hms/search?q=${encodeURIComponent('Lakshmi Narayanan')}`, desk)).data.data;
    assert(!found.some((p) => p.id === ctx.b), 'merged record still in search');
    const profile = (await call('GET', `/patients/hms/${ctx.b}`, desk)).data.data;
    assert(profile.merged_into && profile.merged_into.id === ctx.a, 'merged profile does not point to the kept patient');
  });

  await step('Unmerge returns exactly the moved records', async () => {
    assert((await call('POST', `/patients/duplicates/${ctx.case.id}/unmerge`, admin, {})).status === 400, 'unmerged without a reason');
    const r = await call('POST', `/patients/duplicates/${ctx.case.id}/unmerge`, admin, { reason: 'Different people after all' });
    assert(r.status === 200, `unmerge ${r.status} ${JSON.stringify(r.data)}`);
    const [dup] = await sql('SELECT identity_status, merged_into_patient_id FROM hms_patients WHERE id = $1', [ctx.b]);
    assert(dup.identity_status === 'registered' && dup.merged_into_patient_id === null, JSON.stringify(dup));
    const [allergy] = await sql("SELECT patient_id FROM hms_allergies WHERE allergen = 'Sulfa' AND patient_id IN ($1, $2)", [ctx.a, ctx.b]);
    assert(allergy.patient_id === ctx.b, 'allergy not returned');
    assert((await call('POST', `/patients/duplicates/${ctx.case.id}/unmerge`, admin, { reason: 'again' })).status === 409, 'unmerged twice');
  });

  await step('Dismissing keeps a pair out of the queue; a manual report needs a reason', async () => {
    const other = await register(desk, 'Priya Menon', `97${tag}`.slice(0, 10).padEnd(10, '5'));
    const twin = await register(desk, 'Priya Menon', `97${tag}`.slice(0, 10).padEnd(10, '5'));
    const open = (await call('GET', '/patients/duplicates?status=open', desk)).data.data;
    const c = open.find((x) => [x.patient_a.id, x.patient_b.id].sort().join() === [other.data.data.id, twin.data.data.id].sort().join());
    assert(c, 'twin pair not proposed');
    assert((await call('POST', `/patients/duplicates/${c.id}/dismiss`, desk, {})).status === 400, 'dismissed without a reason');
    assert((await call('POST', `/patients/duplicates/${c.id}/dismiss`, desk, { reason: 'Twins, different people' })).status === 200, 'dismiss');
    await call('POST', '/patients/duplicates/scan', desk);
    const again = (await call('GET', '/patients/duplicates?status=open', desk)).data.data;
    assert(!again.some((x) => x.id === c.id || [x.patient_a.id, x.patient_b.id].sort().join() === [other.data.data.id, twin.data.data.id].sort().join()), 'dismissed pair proposed again');
    assert((await call('POST', '/patients/duplicates', desk, { patientAId: ctx.a, patientBId: ctx.relative })).status === 400, 'report without a reason');
  });

  await step('A merge is refused while both patients are admitted', async () => {
    const admitted = await sql("SELECT DISTINCT patient_id FROM hms_admissions WHERE status = 'Active' ORDER BY patient_id LIMIT 2");
    if (admitted.length < 2) { console.log('      (skipped: fewer than two admitted patients in this data)'); return; }
    const rep = await call('POST', '/patients/duplicates', desk, { patientAId: admitted[0].patient_id, patientBId: admitted[1].patient_id, reason: 'test of the admission rule' });
    assert(rep.status === 201, `report ${rep.status}`);
    const r = await call('POST', `/patients/duplicates/${rep.data.data.id}/merge`, admin, { survivorId: admitted[0].patient_id, reason: 'test' });
    assert(r.status === 409 && /active admission/.test(r.data.message), `merge of two admitted patients: ${r.status} ${r.data?.message}`);
    await call('POST', `/patients/duplicates/${rep.data.data.id}/dismiss`, desk, { reason: 'test only' });
  });

  await step('A verification clash sends both records to review (202) and verifies nothing', async () => {
    const [x, y] = [ctx.a, ctx.relative];
    const abha = Array.from({ length: 14 }, (_, i) => (i === 0 ? 8 : Math.floor(Math.random() * 10))).join('');
    const ix = (await call('POST', `/patients/hms/${x}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha })).data.data.id;
    const iy = (await call('POST', `/patients/hms/${y}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha })).data.data.id;
    assert((await call('POST', `/patients/hms/${x}/identifiers/${ix}/verify`, desk)).status === 200, 'first verify');
    const clash = await call('POST', `/patients/hms/${y}/identifiers/${iy}/verify`, desk);
    assert(clash.status === 202 && clash.data.verified === false, `clash ${clash.status} ${JSON.stringify(clash.data)}`);
    const [st] = await sql('SELECT verification_status FROM hms_patient_identifiers WHERE id = $1', [iy]);
    assert(st.verification_status === 'unverified', 'clashing identifier was verified');
    const [pa, pb] = [Math.min(x, y), Math.max(x, y)];
    const [c] = await sql("SELECT id FROM hms_patient_merge_cases WHERE patient_a_id = $1 AND patient_b_id = $2 AND status = 'open'", [pa, pb]);
    assert(c, 'no review case opened');
  });

  await step('In the browser: an admin merges a pair from the review page and undoes it from the Merged tab', async () => {
    const p1 = await register(desk, 'Fatima Sheikh', `96${tag}`.slice(0, 10).padEnd(10, '3'));
    const p2 = await register(desk, 'Fathima Sheikh', `96${tag}`.slice(0, 10).padEnd(10, '3'));
    assert(p2.data.data.possibleDuplicates >= 1, 'pair not proposed');
    const browser = await chromium.launch();
    try {
      const { page } = await browserAs(browser, 'admin');
      page.on('dialog', (d) => d.accept('Confirmed with the patient at the desk'));
      await page.goto(`${BASE}/hms/patients/duplicates`);
      const reviewCase = page.locator('article[aria-label^="Case"]').filter({ hasText: p2.data.data.uhid });
      const keep = reviewCase.getByRole('button', { name: `Keep ${p1.data.data.uhid}`, exact: true });
      await keep.waitFor({ timeout: 15000 });
      await keep.click();
      await page.getByText(/Merged\. \d+ record/).waitFor({ timeout: 15000 });
      const [dup] = await sql('SELECT identity_status FROM hms_patients WHERE id = $1', [p2.data.data.id]);
      assert(dup.identity_status === 'merged', `after merge: ${dup.identity_status}`);
      await page.getByRole('tab', { name: 'Merged', exact: true }).click();
      const article = page.locator('article', { hasText: p2.data.data.uhid });
      await article.getByRole('button', { name: 'Undo merge' }).click();
      await page.getByText(/Unmerged\. \d+ record/).waitFor({ timeout: 15000 });
      const [back] = await sql('SELECT identity_status FROM hms_patients WHERE id = $1', [p2.data.data.id]);
      assert(back.identity_status === 'registered', `after undo: ${back.identity_status}`);
    } finally {
      await browser.close();
    }
  });

  done();
  process.exit();
})();
