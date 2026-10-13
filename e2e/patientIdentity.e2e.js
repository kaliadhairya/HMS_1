// Phase 2 part 1, patient identity (migration 0010): unknown arrivals get a
// temporary identity without name, phone or payment; newborns (age 0) are
// linked to their mother; identifiers carry issuer and verification, and a
// verified identifier cannot belong to two patients (it is flagged as a
// possible duplicate, never merged silently).
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

const randomAbha = () => Array.from({ length: 14 }, (_, i) => (i === 0 ? 9 : Math.floor(Math.random() * 10))).join('');

(async () => {
  const { step, done } = runner('Patient identity');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  const lab = await apiLogin('lab_technician');
  const ctx = {};

  await step('Every existing patient has exactly one current, verified UHID identifier', async () => {
    const [row] = await sql(`SELECT count(*)::int AS missing FROM hms_patients p WHERE p.uhid IS NOT NULL AND (
      SELECT count(*) FROM hms_patient_identifiers i WHERE i.patient_id = p.id AND i.system = 'UHID' AND i.valid_to IS NULL AND i.verification_status = 'verified') <> 1`);
    assert(row.missing === 0, `${row.missing} patients without exactly one UHID identifier`);
  });

  await step('An unknown, unconscious arrival is registered with no name, phone or payment', async () => {
    const r = await call('POST', '/patients/hms/temporary', nurse, { estimatedAge: 40, arrivalNote: 'Brought by ambulance, unconscious' });
    assert(r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
    ctx.temp = r.data.data;
    const [p] = await sql('SELECT identity_status, gender, age, birth_date_estimated, phonenumber FROM hms_patients WHERE id = $1', [ctx.temp.id]);
    assert(p.identity_status === 'temporary' && p.gender === 'Unknown' && p.age === 40 && p.birth_date_estimated && !p.phonenumber, JSON.stringify(p));
    const ids = await sql("SELECT system FROM hms_patient_identifiers WHERE patient_id = $1 AND valid_to IS NULL ORDER BY system", [ctx.temp.id]);
    assert(ids.map((i) => i.system).join(',') === 'TEMPORARY,UHID', `identifiers ${JSON.stringify(ids)}`);
    assert((await call('POST', '/patients/hms/temporary', lab, { estimatedAge: 30 })).status === 403, 'lab technician registered a patient');
  });

  await step("Confirming the identity keeps the record and UHID, and retires the temporary identifier", async () => {
    const r = await call('POST', `/patients/hms/${ctx.temp.id}/confirm-identity`, desk, { name: `Ravi Identified ${stamp()}`, gender: 'Male', age: 42, phoneNumber: '9876500011' });
    assert(r.status === 200, `${r.status} ${JSON.stringify(r.data)}`);
    const [p] = await sql('SELECT uhid, identity_status, name FROM hms_patients WHERE id = $1', [ctx.temp.id]);
    assert(p.uhid === ctx.temp.uhid && p.identity_status === 'registered', JSON.stringify(p));
    const [temp] = await sql("SELECT valid_to FROM hms_patient_identifiers WHERE patient_id = $1 AND system = 'TEMPORARY'", [ctx.temp.id]);
    assert(temp.valid_to, 'temporary identifier not retired');
    assert((await call('POST', `/patients/hms/${ctx.temp.id}/confirm-identity`, desk, { name: 'Again', gender: 'Male', age: 42 })).status === 409, 'confirmed twice');
  });

  await step('A newborn aged 0 is registered and linked to the mother as guardian', async () => {
    const [mother] = await sql("SELECT id, name FROM hms_patients WHERE gender = 'Female' ORDER BY id LIMIT 1");
    const r = await call('POST', '/patients/hms/newborn', nurse, { motherPatientId: mother.id, gender: 'Female' });
    assert(r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
    const [baby] = await sql('SELECT age, name, dob FROM hms_patients WHERE id = $1', [r.data.data.id]);
    assert(baby.age === 0 && baby.name === `Baby of ${mother.name}` && baby.dob, JSON.stringify(baby));
    const [link] = await sql('SELECT related_patient_id, relationship, is_guardian FROM hms_related_persons WHERE patient_id = $1', [r.data.data.id]);
    assert(link.related_patient_id === mother.id && link.relationship === 'Mother' && link.is_guardian, JSON.stringify(link));
    const [male] = await sql("SELECT id FROM hms_patients WHERE gender = 'Male' ORDER BY id LIMIT 1");
    assert((await call('POST', '/patients/hms/newborn', nurse, { motherPatientId: male.id })).status === 400, 'a male patient accepted as mother');
  });

  await step('Ordinary registration now accepts age 0', async () => {
    const r = await call('POST', '/patients/hms', desk, {
      patientType: 'other', name: `Neonate ${stamp()}`, age: 0, gender: 'Male', opdIndoor: 'OPD',
      testDate: new Date().toISOString().slice(0, 10), phoneNumber: '9876500012',
      emergency_contact_name: 'Sita', emergency_contact_relation: 'Mother', emergency_contact_phone: '9876500013',
    });
    assert(r.status === 201, `${r.status} ${JSON.stringify(r.data)}`);
    const [contact] = await sql('SELECT name, is_emergency_contact FROM hms_related_persons WHERE patient_id = $1', [r.data.data.id]);
    assert(contact && contact.name === 'Sita' && contact.is_emergency_contact, 'emergency contact not kept as a related person');
    const [uhid] = await sql("SELECT verification_status FROM hms_patient_identifiers WHERE patient_id = $1 AND system = 'UHID'", [r.data.data.id]);
    assert(uhid && uhid.verification_status === 'verified', 'UHID identifier missing for a newly registered patient');
  });

  await step('Identifiers: validated, verified by registration staff, and a verified ABHA cannot belong to two patients', async () => {
    const [a, b] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 2');
    const abha = randomAbha();
    assert((await call('POST', `/patients/hms/${a.id}/identifiers`, desk, { system: 'ABHA_NUMBER', value: '123' })).status === 400, 'bad ABHA accepted');
    assert((await call('POST', `/patients/hms/${a.id}/identifiers`, desk, { system: 'UHID', value: 'X', issuer: 'x' })).status === 400, 'manual UHID accepted');
    const addA = await call('POST', `/patients/hms/${a.id}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha });
    const addB = await call('POST', `/patients/hms/${b.id}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha });
    assert(addA.status === 201 && addB.status === 201, `adds ${addA.status} ${addB.status}`);
    assert((await call('POST', `/patients/hms/${a.id}/identifiers/${addA.data.data.id}/verify`, nurse)).status === 403, 'nurse verified an identifier');
    assert((await call('POST', `/patients/hms/${a.id}/identifiers/${addA.data.data.id}/verify`, desk)).status === 200, 'verify A');
    const clash = await call('POST', `/patients/hms/${b.id}/identifiers/${addB.data.data.id}/verify`, desk);
    // Not verified; both records go to the possible-duplicates review (part 2).
    assert(clash.status === 202 && clash.data.verified === false && /possible-duplicates review/.test(clash.data.message), `second verify: ${clash.status} ${clash.data?.message}`);
    const [count] = await sql("SELECT count(*)::int AS n FROM hms_patient_identifiers WHERE value = $1 AND verification_status = 'verified'", [abha]);
    assert(count.n === 1, `${count.n} verified copies`);
  });

  await step('Two staff verifying the same ABHA for two patients at once: exactly one succeeds', async () => {
    const [a, b] = await sql('SELECT id FROM hms_patients ORDER BY id DESC LIMIT 2');
    const abha = randomAbha();
    const ia = (await call('POST', `/patients/hms/${a.id}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha })).data.data.id;
    const ib = (await call('POST', `/patients/hms/${b.id}/identifiers`, desk, { system: 'ABHA_NUMBER', value: abha })).data.data.id;
    const admin = await apiLogin('admin');
    const results = await Promise.all([
      call('POST', `/patients/hms/${a.id}/identifiers/${ia}/verify`, desk),
      call('POST', `/patients/hms/${b.id}/identifiers/${ib}/verify`, admin),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert(statuses.join(',') === '200,409', `statuses ${statuses}`);
    const [count] = await sql("SELECT count(*)::int AS n FROM hms_patient_identifiers WHERE value = $1 AND verification_status = 'verified'", [abha]);
    assert(count.n === 1, `${count.n} verified copies`);
  });

  await step('Retiring keeps history; the UHID cannot be retired; related persons can be added and ended', async () => {
    const [p] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 1');
    const [uhid] = await sql("SELECT id FROM hms_patient_identifiers WHERE patient_id = $1 AND system = 'UHID' AND valid_to IS NULL", [p.id]);
    assert((await call('POST', `/patients/hms/${p.id}/identifiers/${uhid.id}/retire`, desk, { reason: 'test' })).status === 404, 'UHID retired');
    const ext = await call('POST', `/patients/hms/${p.id}/identifiers`, desk, { system: 'EXTERNAL_MRN', value: `EXT-${stamp()}`, issuer: 'City Hospital' });
    assert((await call('POST', `/patients/hms/${p.id}/identifiers/${ext.data.data.id}/retire`, desk, {})).status === 400, 'retired without reason');
    assert((await call('POST', `/patients/hms/${p.id}/identifiers/${ext.data.data.id}/retire`, desk, { reason: 'entered in error' })).status === 200, 'retire');
    const listed = (await call('GET', `/patients/hms/${p.id}/identifiers`, desk)).data.data;
    assert(listed.some((i) => i.id === ext.data.data.id && i.valid_to), 'retired identifier not kept in history');
    const rel = await call('POST', `/patients/hms/${p.id}/related-persons`, nurse, { name: 'Guardian', relationship: 'Uncle', phone: '9876500014', isGuardian: true });
    assert(rel.status === 201, `add related ${rel.status}`);
    assert((await call('POST', `/patients/hms/${p.id}/related-persons/${rel.data.data.id}/end`, nurse)).status === 200, 'end related');
    const people = (await call('GET', `/patients/hms/${p.id}/related-persons`, nurse)).data.data;
    assert(people.some((r) => r.id === rel.data.data.id && r.valid_to), 'ended relationship not kept');
  });

  await step('In the browser: register an unknown patient, see the temporary warning, confirm the identity, view identifiers', async () => {
    const browser = await chromium.launch();
    try {
      const { page } = await browserAs(browser, 'receptionist');
      await page.goto(`${BASE}/hms/patients/new`);
      await page.getByRole('button', { name: 'Register unknown patient' }).click();
      await page.locator('#tmp-age').fill('35');
      await page.getByRole('button', { name: 'Register unknown patient' }).click();
      await page.getByText('Temporary identity.').waitFor({ timeout: 15000 });
      const name = `Meera Confirmed ${stamp()}`;
      await page.getByRole('button', { name: 'Confirm identity' }).click();
      await page.locator('#ci-name').fill(name);
      await page.locator('#ci-gender').selectOption('Female');
      await page.getByRole('button', { name: 'Confirm identity' }).last().click();
      await page.getByText('Temporary identity.').waitFor({ state: 'detached', timeout: 15000 });
      await page.getByRole('tab', { name: 'Identity and contacts' }).click();
      await page.getByText('Verified').first().waitFor({ timeout: 15000 });
      const [p] = await sql('SELECT identity_status, gender FROM hms_patients WHERE name = $1', [name]);
      assert(p && p.identity_status === 'registered' && p.gender === 'Female', `database shows ${JSON.stringify(p)}`);
    } finally {
      await browser.close();
    }
  });

  done();
  process.exit();
})();
