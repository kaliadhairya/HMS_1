// Admission transfers through the v2 API (completion A3): the admission and bed are named
// by public identifier, a transfer states the admission version it was based on, a stale or
// missing version changes nothing, and a repeated request with the same key moves the patient once.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const key = () => ({ 'idempotency-key': crypto.randomUUID() });

(async () => {
  const { step, done } = runner('V2 admissions');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');
  const desk = await apiLogin('receptionist');
  // An active admission in a bed, and a bed that is free in the same facility.
  const [adm] = await sql("SELECT a.id, a.public_id, a.bed_id FROM hms_admissions a WHERE a.status = 'Active' AND a.bed_id IS NOT NULL ORDER BY a.id LIMIT 1");
  const [free] = await sql("SELECT b.id, b.public_id FROM hms_beds b WHERE b.is_active = 1 AND b.status = 'Available' AND b.id NOT IN (SELECT bed_id FROM hms_admissions WHERE status = 'Active' AND bed_id IS NOT NULL) ORDER BY b.id LIMIT 1");
  assert(adm && free, 'the database needs an active admission in a bed and a free bed');
  const [{ public_id: fromBed }] = await sql('SELECT public_id FROM hms_beds WHERE id = $1', [adm.bed_id]);
  const state = async () => (await call('GET', `/v2/admissions/${adm.public_id}`, admin)).data.data;
  const bedStatus = async (id) => (await sql('SELECT status FROM hms_beds WHERE id = $1', [id]))[0].status;
  const body = { to_bed_id: free.public_id, reason: 'Moved to a quieter room' };
  let before;

  await step('A transfer without the admission version is refused and changes nothing', async () => {
    before = await state();
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, body, key());
    assert(r.status === 428, `missing If-Match: ${r.status}`);
    assert((await state()).version === before.version && (await state()).bed_id === fromBed, 'a refused transfer moved the patient');
  });

  await step('A transfer based on an old version is refused and changes nothing', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, body, { ...key(), 'if-match': '"999"' });
    assert(r.status === 412 && r.data.code === 'VERSION_CONFLICT', `stale version: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    assert((await state()).bed_id === fromBed, 'a stale transfer moved the patient');
  });

  const transferKey = crypto.randomUUID();
  await step('A transfer with the current version moves the patient, bumps the version and changes both beds', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, body, { 'idempotency-key': transferKey, 'if-match': `"${before.version}"` });
    assert(r.status === 200 && r.data.data.bed_id === free.public_id && r.data.data.version === before.version + 1, `transfer ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    assert(r.headers.get('etag') === `"${before.version + 1}"`, 'missing version header');
    assert(await bedStatus(adm.bed_id) === 'Dirty' && await bedStatus(free.id) === 'Occupied', 'bed states did not change');
  });

  await step('A repeated request with the same key replays the result and does not move the patient again', async () => {
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, body, { 'idempotency-key': transferKey, 'if-match': `"${before.version}"` });
    assert(r.status === 200 && r.data.data.version === before.version + 1, `replay ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert((await state()).version === before.version + 1, 'the replay moved the patient again');
  });

  await step('A move into the bed the patient is already in is refused', async () => {
    const now = await state();
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, { to_bed_id: free.public_id, reason: 'Already there' }, { ...key(), 'if-match': `"${now.version}"` });
    assert(r.status === 409 && r.data.code === 'ALREADY_IN_BED', `already in bed: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  });

  await step('A role outside ward work is refused; the read shows the current state', async () => {
    const denied = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, desk, body, { ...key(), 'if-match': `"${before.version + 1}"` });
    assert(denied.status === 403, `receptionist moved a patient: ${denied.status}`);
    const now = await call('GET', `/v2/admissions/${adm.public_id}`, nurse);
    assert(now.status === 200 && now.data.data.bed_id === free.public_id && now.data.data.version === before.version + 1, `read ${now.status}`);
  });

  // Put the test patient back where it was, so later suites see the seeded state.
  await step('The test move is reversed under the same rules', async () => {
    // The bed the patient left is cleaned first (a separate, legitimate step), then the move back is checked.
    await sql("UPDATE hms_beds SET status = 'Available' WHERE id = $1", [adm.bed_id]);
    const now = await state();
    const r = await call('POST', `/v2/admissions/${adm.public_id}/transfer`, admin, { to_bed_id: fromBed, reason: 'Returned to the original bed' }, { ...key(), 'if-match': `"${now.version}"` });
    assert(r.status === 200 && r.data.data.bed_id === fromBed, `reverse ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
