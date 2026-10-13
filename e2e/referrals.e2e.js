// Phase 2 part 9, referrals with acknowledged handoffs (migration 0018): a
// referral is accepted by the receiving clinician (who then joins the patient's
// care), its outcome is recorded, or it is closed with a documented reason. The
// database refuses a completed or closed referral without the matching record.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function loginAs(username, password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-transport': 'bearer' }, body: JSON.stringify({ username, password }) });
  return (await r.json()).token;
}

(async () => {
  const { step, done } = runner('Referrals');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const tag = stamp();
  const ctx = {};

  await step('Setup: a patient in the sending doctor\'s care, and a receiving doctor', async () => {
    const [sender] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    ctx.sender = { id: sender.id, token: await apiLogin('doctor') };
    const reg = await call('POST', '/patients/hms', desk, {
      patientType: 'other', name: `Referred Patient ${tag}`, age: 62, gender: 'Male', opdIndoor: 'OPD',
      testDate: new Date().toISOString().slice(0, 10), phoneNumber: `93${tag}`.slice(0, 10).padEnd(10, '4'),
    });
    assert(reg.status === 201, `register ${reg.status}`);
    ctx.patient = reg.data.data.id;
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team`, desk, { practitionerUserId: sender.id, role: 'consulting' })).status === 201, 'sender in care');
    const username = `e2e.ref.${tag}`;
    const created = await call('POST', '/users', admin, { username, password: 'Doctor#Ref2026', name: `Dr Receiver ${tag}`, role: 'doctor', isActive: 1 });
    assert(created.status === 201, `receiver ${created.status}`);
    ctx.receiver = { id: created.data.data.id, token: await loginAs(username, 'Doctor#Ref2026') };
  });

  await step('A doctor refers a patient in their care to a named doctor; the referral waits as Pending', async () => {
    const r = await call('POST', '/referrals', ctx.sender.token, { patientId: ctx.patient, toUserId: ctx.receiver.id, reason: 'Needs cardiology review', urgency: 'urgent', dueHours: 24 });
    assert(r.status === 201 && r.data.data.status === 'Pending' && r.data.data.due_at, `referral ${r.status} ${JSON.stringify(r.data)}`);
    ctx.ref = r.data.data.id;
  });

  await step('Completing before accepting is refused; only the receiving clinician can accept', async () => {
    assert((await call('POST', `/referrals/${ctx.ref}/complete`, ctx.receiver.token, { outcome: 'Seen and treated' })).status === 409, 'completed before acceptance');
    assert((await call('POST', `/referrals/${ctx.ref}/acknowledge`, ctx.sender.token)).status === 403, 'sender accepted their own referral');
    assert((await call('GET', `/patients/hms/${ctx.patient}`, ctx.receiver.token)).status === 403, 'receiver read the patient before accepting');
  });

  await step('Accepting makes the receiving clinician part of the patient\'s care', async () => {
    const r = await call('POST', `/referrals/${ctx.ref}/acknowledge`, ctx.receiver.token);
    assert(r.status === 200, `accept ${r.status} ${JSON.stringify(r.data)}`);
    assert((await call('POST', `/referrals/${ctx.ref}/acknowledge`, ctx.receiver.token)).status === 409, 'accepted twice');
    assert((await call('GET', `/patients/hms/${ctx.patient}`, ctx.receiver.token)).status === 200, 'accepted clinician refused');
  });

  await step('The outcome completes the referral; completing again is refused', async () => {
    assert((await call('POST', `/referrals/${ctx.ref}/complete`, ctx.receiver.token, { outcome: 'x' })).status === 400, 'empty-ish outcome accepted');
    const r = await call('POST', `/referrals/${ctx.ref}/complete`, ctx.receiver.token, { outcome: 'Echo normal; medication adjusted' });
    assert(r.status === 200, `complete ${r.status} ${JSON.stringify(r.data)}`);
    assert((await call('POST', `/referrals/${ctx.ref}/complete`, ctx.receiver.token, { outcome: 'again' })).status === 409, 'completed twice');
    const [row] = await sql('SELECT status, outcome FROM hms_referrals WHERE id = $1', [ctx.ref]);
    assert(row.status === 'Completed' && row.outcome, JSON.stringify(row));
  });

  await step('A referral to a specialty is closed only with a documented reason, by the sender or an administrator', async () => {
    const r = await call('POST', '/referrals', ctx.sender.token, { patientId: ctx.patient, toSpecialty: 'Nephrology', reason: 'Renal function review' });
    assert(r.status === 201, `specialty referral ${r.status}`);
    ctx.external = r.data.data.id;
    assert((await call('POST', `/referrals/${ctx.external}/acknowledge`, ctx.receiver.token)).status === 403, 'accepted a specialty referral not addressed to them');
    assert((await call('POST', `/referrals/${ctx.external}/close`, ctx.sender.token, { reason: 'x' })).status === 400, 'closed without a reason');
    assert((await call('POST', `/referrals/${ctx.external}/close`, ctx.receiver.token, { reason: 'Handled elsewhere' })).status === 403, 'receiver closed another doctor\'s referral');
    assert((await call('POST', `/referrals/${ctx.external}/close`, ctx.sender.token, { reason: 'Patient referred privately; nephrology seen' })).status === 200, 'close');
    assert((await call('POST', `/referrals/${ctx.external}/close`, admin, { reason: 'again' })).status === 409, 'closed twice');
  });

  await step('Overdue referrals are flagged in the receiving doctor\'s list', async () => {
    const r = await call('POST', '/referrals', ctx.sender.token, { patientId: ctx.patient, toUserId: ctx.receiver.id, reason: 'Follow-up overdue test', dueHours: 1 });
    assert(r.status === 201, `overdue setup ${r.status}`);
    ctx.late = r.data.data.id;
    await sql("UPDATE hms_referrals SET due_at = now() - interval '2 hours' WHERE id = $1", [ctx.late]);
    const inbox = (await call('GET', '/referrals?box=incoming', ctx.receiver.token)).data.data;
    const late = inbox.find((x) => x.id === ctx.late);
    assert(late && late.overdue === true, `not flagged overdue: ${JSON.stringify(late)}`);
    const outbox = (await call('GET', '/referrals?box=outgoing', ctx.sender.token)).data.data;
    assert(outbox.some((x) => x.id === ctx.late), 'sender cannot see their outgoing referral');
  });

  await step('The database refuses a completed or closed referral without its record', async () => {
    let codeA = null;
    let codeB = null;
    try { await sql("UPDATE hms_referrals SET status = 'Completed' WHERE id = $1", [ctx.late]); } catch (e) { codeA = e.code; }
    try { await sql("UPDATE hms_referrals SET status = 'Closed' WHERE id = $1", [ctx.late]); } catch (e) { codeB = e.code; }
    assert(codeA === '23514' && codeB === '23514', `constraints: ${codeA} ${codeB}`);
  });

  done();
  process.exit();
})();
