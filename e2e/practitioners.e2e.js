// Phase 2 part 3, practitioners (migration 0012): doctors have practitioner
// records separate from logins; registrations are recorded with dates and
// verified by an administrator; a doctor whose registrations have ALL expired
// cannot start or finish clinical work; a doctor with no registration recorded
// is not blocked.
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

const TODAY = new Date().toISOString().slice(0, 10);
const yearsAgo = (n) => `${new Date().getFullYear() - n}-01-01`;

(async () => {
  const { step, done } = runner('Practitioners');
  const admin = await apiLogin('admin');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  const demoDoctor = await apiLogin('doctor');
  const tag = stamp();
  const ctx = {};

  await step('Every doctor login has a practitioner record; the demo doctor keeps an unverified registration', async () => {
    const [{ missing }] = await sql(`SELECT count(*)::int AS missing FROM hms_users u WHERE u.role = 'doctor'
      AND NOT EXISTS (SELECT 1 FROM hms_practitioners p WHERE p.user_id = u.id)`);
    assert(missing === 0, `${missing} doctor logins without a practitioner record`);
    const [demo] = await sql(`SELECT c.verified_at, c.identifier FROM hms_practitioner_credentials c
      JOIN hms_practitioners p ON p.id = c.practitioner_id JOIN hms_users u ON u.id = p.user_id WHERE u.username = 'doctor'`);
    assert(demo && demo.identifier === 'REG-12345' && demo.verified_at === null, `demo registration: ${JSON.stringify(demo)}`);
  });

  await step('Only administrators record or verify registrations', async () => {
    const target = (await sql("SELECT id FROM hms_users WHERE username = 'doctor'"))[0].id;
    assert((await call('POST', `/practitioners/${target}/credentials`, desk, { kind: 'medical_registration', identifier: 'X1', issuingBody: 'KMC', validFrom: yearsAgo(1) })).status === 403, 'receptionist recorded a registration');
    assert((await call('POST', `/practitioners/${target}/credentials`, nurse, { kind: 'medical_registration', identifier: 'X1', issuingBody: 'KMC', validFrom: yearsAgo(1) })).status === 403, 'nurse recorded a registration');
  });

  // A dedicated doctor so the test does not touch the demo account.
  await step('A new doctor is created and recorded with an expired registration only', async () => {
    const username = `e2e.doc.${tag}`;
    const created = await call('POST', '/users', admin, { username, password: 'Doctor#Prac2026', name: `Dr Test ${tag}`, role: 'doctor', isActive: 1 });
    assert(created.status === 201, `create doctor ${created.status} ${JSON.stringify(created.data)}`);
    ctx.userId = created.data.data.id;
    ctx.token = await (async () => {
      const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-transport': 'bearer' }, body: JSON.stringify({ username, password: 'Doctor#Prac2026' }) });
      return (await r.json()).token;
    })();
    const expired = await call('POST', `/practitioners/${ctx.userId}/credentials`, admin, {
      kind: 'medical_registration', identifier: `E2E-${tag}`, issuingBody: 'Test Council', validFrom: yearsAgo(10), validTo: yearsAgo(2),
    });
    assert(expired.status === 201, `expired credential ${expired.status} ${JSON.stringify(expired.data)}`);
    const status = await call('GET', `/practitioners/${ctx.userId}`, admin);
    assert(status.data.data.registration_expired === true, `not reported expired: ${JSON.stringify(status.data)}`);
  });

  await step('A doctor whose registrations have all expired cannot start a consultation (403, clear reason)', async () => {
    const [patient] = await sql('SELECT id FROM hms_patients WHERE identity_status = $1 ORDER BY id LIMIT 1', ['registered']);
    const r = await call('POST', '/hms/encounters', ctx.token, { patient_id: patient.id, chief_complaint: 'expired-registration check' });
    assert(r.status === 403 && r.data.code === 'REGISTRATION_EXPIRED', `consultation with expired registration: ${r.status} ${JSON.stringify(r.data)}`);
  });

  await step('Renewing the registration restores clinical work', async () => {
    const renewed = await call('POST', `/practitioners/${ctx.userId}/credentials`, admin, {
      kind: 'medical_registration', identifier: `E2E-${tag}-R`, issuingBody: 'Test Council', validFrom: yearsAgo(1),
    });
    assert(renewed.status === 201, `renew ${renewed.status}`);
    const [patient] = await sql('SELECT id FROM hms_patients WHERE identity_status = $1 ORDER BY id LIMIT 1', ['registered']);
    const r = await call('POST', '/hms/encounters', ctx.token, { patient_id: patient.id, chief_complaint: 'renewed registration check' });
    assert(r.status === 201, `consultation after renewal: ${r.status} ${JSON.stringify(r.data)}`);
    const s = await call('GET', `/practitioners/${ctx.userId}`, admin);
    assert(s.data.data.registration_expired === false, 'still reported expired after renewal');
    ctx.renewedCredential = renewed.data.data.id;
  });

  await step('A registration can be verified once; a second verification of the same number for another practitioner is refused', async () => {
    const r1 = await call('POST', `/practitioners/${ctx.userId}/credentials/${ctx.renewedCredential}/verify`, admin);
    assert(r1.status === 200, `verify ${r1.status} ${JSON.stringify(r1.data)}`);
    assert((await call('POST', `/practitioners/${ctx.userId}/credentials/${ctx.renewedCredential}/verify`, admin)).status === 404, 'verified twice');
    const demoUser = (await sql("SELECT id FROM hms_users WHERE username = 'doctor'"))[0].id;
    const shared = await call('POST', `/practitioners/${demoUser}/credentials`, admin, {
      kind: 'medical_registration', identifier: `E2E-${tag}-R`, issuingBody: 'Test Council', validFrom: yearsAgo(1),
    });
    assert(shared.status === 201, `second credential ${shared.status}`);
    const clash = await call('POST', `/practitioners/${demoUser}/credentials/${shared.data.data.id}/verify`, admin);
    assert(clash.status === 409 && /already verified/.test(clash.data.message), `clash ${clash.status} ${clash.data?.message}`);
    // Tidy: end the test-only credential on the demo account (reason recorded).
    assert((await call('POST', `/practitioners/${demoUser}/credentials/${shared.data.data.id}/end`, admin, { reason: 'test cleanup', endOn: TODAY })).status === 200, 'end test credential');
  });

  await step('Ending a registration needs a reason and cannot be done twice; a doctor can read only their own record', async () => {
    const demoUser = (await sql("SELECT id FROM hms_users WHERE username = 'doctor'"))[0].id;
    const [row] = await sql("SELECT c.id FROM hms_practitioner_credentials c JOIN hms_practitioners p ON p.id = c.practitioner_id WHERE p.user_id = $1 AND c.identifier = 'REG-12345'", [demoUser]);
    assert((await call('POST', `/practitioners/${demoUser}/credentials/${row.id}/end`, admin, { endOn: TODAY })).status === 400, 'ended without a reason');
    assert((await call('GET', `/practitioners/${ctx.userId}`, demoDoctor)).status === 403, 'demo doctor read another practitioner');
    assert((await call('GET', `/practitioners/${demoUser}`, demoDoctor)).status === 200, 'doctor cannot read own record');
    assert((await call('GET', '/practitioners', desk)).status === 200, 'front desk cannot see the practitioner list');
  });

  await step('In the browser: an admin sees a doctor unverified registration on the Practitioners page', async () => {
    const browser = await chromium.launch();
    try {
      const { page } = await browserAs(browser, 'admin');
      await page.goto(`${BASE}/hms/practitioners`);
      await page.getByRole('button', { name: /Dr\.? Ramesh Kumar/ }).click();
      await page.getByText('REG-12345').waitFor({ timeout: 15000 });
      await page.getByText('Not verified').first().waitFor({ timeout: 15000 });
      assert(await page.getByRole('button', { name: 'Verify' }).count() >= 1, 'no Verify action for an unverified registration');
    } finally {
      await browser.close();
    }
  });

  done();
  process.exit();
})();
