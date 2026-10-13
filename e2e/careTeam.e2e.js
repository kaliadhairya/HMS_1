// Phase 2 part 5, care teams and patient scope (migration 0014): a doctor reads
// a patient's record only when the patient is in their care. Care comes from a
// care-team assignment, an admission they lead, a queued token or booking, or
// break-glass for one hour with a reason, reviewed later. Desk staff and
// administrators are not limited by care teams.
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
  const { step, done } = runner('Care teams');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const tag = stamp();
  const ctx = {};

  await step('Setup: a patient and two doctors, neither of whom has seen the patient', async () => {
    const reg = await call('POST', '/patients/hms', desk, {
      patientType: 'other', name: `Care Patient ${tag}`, age: 50, gender: 'Male', opdIndoor: 'OPD',
      testDate: new Date().toISOString().slice(0, 10), phoneNumber: `95${tag}`.slice(0, 10).padEnd(10, '1'),
    });
    assert(reg.status === 201, `register ${reg.status}`);
    ctx.patient = reg.data.data.id;
    const [dept] = await sql('SELECT id FROM hms_departments ORDER BY id LIMIT 1');
    ctx.dept = dept.id;
    for (const k of ['a', 'b']) {
      const username = `e2e.care.${k}.${tag}`;
      const created = await call('POST', '/users', admin, { username, password: 'Doctor#Care2026', name: `Dr Care ${k} ${tag}`, role: 'doctor', isActive: 1 });
      assert(created.status === 201, `doctor ${created.status}`);
      ctx[k] = { id: created.data.data.id, token: await loginAs(username, 'Doctor#Care2026') };
    }
  });

  await step('A doctor not in care is refused the patient record (403, reason given)', async () => {
    const r = await call('GET', `/patients/hms/${ctx.patient}`, ctx.a.token);
    assert(r.status === 403 && r.data.code === 'PATIENT_NOT_IN_CARE', `${r.status} ${JSON.stringify(r.data)}`);
    assert((await call('GET', `/patients/hms/${ctx.patient}/allergies`, ctx.a.token)).status === 403, 'allergies readable');
    assert((await call('GET', `/patients/hms/${ctx.patient}/identifiers`, ctx.a.token)).status === 403, 'identifiers readable');
    assert((await call('GET', `/hms/vitals/history/${ctx.patient}`, ctx.a.token)).status === 403, 'vitals readable');
  });

  await step('Desk staff and administrators are not limited by care teams', async () => {
    assert((await call('GET', `/patients/hms/${ctx.patient}`, desk)).status === 200, 'desk refused');
    assert((await call('GET', `/patients/hms/${ctx.patient}`, admin)).status === 200, 'admin refused');
  });

  await step('Front desk adds a doctor to the care team; that doctor can read the record', async () => {
    const add = await call('POST', `/patients/hms/${ctx.patient}/care-team`, desk, { practitionerUserId: ctx.a.id, role: 'consulting' });
    assert(add.status === 201, `add ${add.status} ${JSON.stringify(add.data)}`);
    assert((await call('GET', `/patients/hms/${ctx.patient}`, ctx.a.token)).status === 200, 'team member refused');
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team`, desk, { practitionerUserId: ctx.a.id })).status === 409, 'added twice');
    const [receptionist] = await sql("SELECT id FROM hms_users WHERE username = 'receptionist'");
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team`, desk, { practitionerUserId: receptionist.id })).status === 400, 'non-doctor added');
  });

  await step('Queuing a patient for a doctor puts the patient in that doctor\'s care', async () => {
    const token = await call('POST', '/hms/tokens', desk, { patient_id: ctx.patient, doctor_id: ctx.b.id, department_id: ctx.dept });
    assert(token.status === 201, `token ${token.status} ${JSON.stringify(token.data)}`);
    assert((await call('GET', `/patients/hms/${ctx.patient}`, ctx.b.token)).status === 200, 'queued doctor refused');
  });

  await step('A consultation is refused unless the patient is in care; in care it starts', async () => {
    const [other] = await sql("SELECT id FROM hms_patients WHERE identity_status = 'registered' AND id <> $1 ORDER BY id LIMIT 1", [ctx.patient]);
    const notMine = await call('POST', '/hms/encounters', ctx.a.token, { patient_id: other.id, chief_complaint: 'care check' });
    assert(notMine.status === 403 && notMine.data.code === 'PATIENT_NOT_IN_CARE', `consultation for a stranger: ${notMine.status} ${JSON.stringify(notMine.data)}`);
    const mine = await call('POST', '/hms/encounters', ctx.a.token, { patient_id: ctx.patient, chief_complaint: 'care check' });
    assert(mine.status === 201, `consultation in care: ${mine.status} ${JSON.stringify(mine.data)}`);
  });

  await step('Break-glass needs a real reason, gives one hour, is audited, and waits for review', async () => {
    assert((await call('POST', `/patients/hms/${ctx.patient}/break-glass`, ctx.a.token, { reason: 'x' })).status === 400, 'short reason accepted');
    assert((await call('POST', `/patients/hms/${ctx.patient}/break-glass`, desk, { reason: 'Patient collapsed in the lobby' })).status === 403, 'desk used break-glass');
    const bg = await call('POST', `/patients/hms/${ctx.patient}/break-glass`, ctx.a.token, { reason: 'Collapsed in the corridor, needs history' });
    assert(bg.status === 201, `break-glass ${bg.status} ${JSON.stringify(bg.data)}`);
    const inWindow = await call('GET', `/patients/hms/${ctx.patient}/identifiers`, ctx.a.token);
    assert(inWindow.status === 200, `break-glass read ${inWindow.status}`);
    const [{ window }] = await sql(`SELECT extract(epoch FROM (expires_at - granted_at))::int AS window FROM hms_break_glass_access WHERE id = $1`, [bg.data.data.id]);
    assert(window <= 3600, `window ${window}s`);
    const queue = (await call('GET', '/patients/break-glass?unreviewed=1', admin)).data.data;
    const mine = queue.find((b) => b.id === bg.data.data.id);
    assert(mine && mine.reviewed_at === null, 'break-glass not listed for review');
    assert((await call('POST', `/patients/break-glass/${bg.data.data.id}/review`, admin, { note: 'Reviewed: genuine emergency' })).status === 200, 'review');
    assert((await call('POST', `/patients/break-glass/${bg.data.data.id}/review`, admin, { note: 'again' })).status === 404, 'reviewed twice');
  });

  await step('Break-glass expires: after the hour the doctor is refused again', async () => {
    await sql("UPDATE hms_break_glass_access SET expires_at = now() - interval '1 minute', granted_at = now() - interval '61 minutes' WHERE user_id = $1 AND patient_id = $2", [ctx.a.id, ctx.patient]);
    // The team assignment for doctor a is still current, so remove it to isolate break-glass.
    const [asg] = await sql('SELECT id FROM hms_care_team_assignments WHERE patient_id = $1 AND practitioner_user_id = $2 AND valid_to IS NULL', [ctx.patient, ctx.a.id]);
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team/${asg.id}/end`, admin, { reason: 'left the team' })).status === 200, 'end assignment');
    const r = await call('GET', `/patients/hms/${ctx.patient}`, ctx.a.token);
    assert(r.status === 403, `after break-glass expiry and team removal: ${r.status}`);
  });

  await step('Removing a team member needs an admin and a reason; the removed doctor loses access', async () => {
    const [asg] = await sql('SELECT id FROM hms_care_team_assignments WHERE patient_id = $1 AND practitioner_user_id = $2 AND valid_to IS NULL', [ctx.patient, ctx.b.id]);
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team/${asg.id}/end`, desk, { reason: 'x' })).status === 403, 'desk removed a team member');
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team/${asg.id}/end`, admin, {})).status === 400, 'removed without a reason');
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team/${asg.id}/end`, admin, { reason: 'Moved to another clinic' })).status === 200, 'remove');
    assert((await call('GET', `/patients/hms/${ctx.patient}`, ctx.b.token)).status === 403, 'removed doctor still has access');
  });

  done();
  process.exit();
})();
