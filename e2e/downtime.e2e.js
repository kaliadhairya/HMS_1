// Downtime kit and reconciliation (Phase 6I). Needs DOWNTIME_KIT_DIR and
// DOWNTIME_KIT_KEY on the backend (the harness sets both). Synthetic data.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { api, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
for (const k of ['DOWNTIME_KIT_DIR', 'DOWNTIME_KIT_KEY']) assert(process.env[k], `${k} is required for this suite`);
const backend = path.join(__dirname, '../backend');
const tag = crypto.randomUUID().slice(0, 6);

(async () => {
  const { step, done } = runner('Downtime');
  const admin = await apiLogin('admin');
  const sa = await apiLogin('super_admin');
  const nurse = await apiLogin('nurse');
  const doctor = await apiLogin('doctor');
  let kit, episode, admitted;

  await step('The kit holds every admitted patient with allergy status, encrypted; only administrators refresh it', async () => {
    [admitted] = await sql(`SELECT p.id, p.name, p.uhid FROM hms_admissions a JOIN hms_patients p ON p.id = a.patient_id WHERE a.status = 'Active' ORDER BY a.id LIMIT 1`);
    assert(admitted, 'needs an admitted patient in the test copy');
    assert((await api('POST', '/downtime/snapshots', { token: nurse, body: {} })).status === 403, 'a nurse refreshed the kit');
    const r = await api('POST', '/downtime/snapshots', { token: admin, body: {} });
    assert(r.status === 201 && r.data.data.patient_count >= 1, `snapshot ${r.status} ${JSON.stringify(r.data)}`);
    kit = r.data.data;
    const raw = fs.readFileSync(path.join(process.env.DOWNTIME_KIT_DIR, kit.file_name), 'utf8');
    assert(!raw.includes(admitted.name) && !raw.includes(admitted.uhid), 'the kit file is readable without the key');
    assert(crypto.createHash('sha256').update(raw).digest('hex') === kit.sha256, 'recorded checksum differs from the file');
    const status = await api('GET', '/downtime/status', { token: nurse });
    assert(status.status === 200 && status.data.data.stale === false && status.data.data.last.id === kit.id, 'status does not show the fresh kit');
  });

  await step('The offline opener shows the summary without the application, and marks an old kit STALE', async () => {
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hms-kit-')), 'kit.html');
    const file = path.join(process.env.DOWNTIME_KIT_DIR, 'downtime-latest.hmskit.json');
    const fresh = spawnSync(process.execPath, ['scripts/downtime-open.js', file, out], { cwd: backend, env: process.env, encoding: 'utf8' });
    assert(fresh.status === 0 && fresh.stdout.startsWith('CURRENT'), `open ${fresh.stdout} ${fresh.stderr}`);
    const html = fs.readFileSync(out, 'utf8');
    assert(html.includes(admitted.name.replace(/&/g, '&amp;')) && /READ ONLY/.test(html) && /ALLERG/i.test(html), 'summary content missing');
    const later = spawnSync(process.execPath, ['scripts/downtime-open.js', file, out], { cwd: backend, env: { ...process.env, DOWNTIME_OPEN_AT: new Date(Date.now() + 864e5).toISOString() }, encoding: 'utf8' });
    assert(later.stdout.startsWith('STALE') && fs.readFileSync(out, 'utf8').includes('STALE —'), 'an old kit is not marked stale');
    const wrongKey = spawnSync(process.execPath, ['scripts/downtime-open.js', file, out], { cwd: backend, env: { ...process.env, DOWNTIME_KIT_KEY: 'a'.repeat(64) }, encoding: 'utf8' });
    assert(wrongKey.status !== 0, 'the kit opened with the wrong key');
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
  });

  await step('A downtime is declared once; paper records are logged with their actual time inside it', async () => {
    const open = await sql('SELECT id FROM hms_downtime_episodes WHERE closed_at IS NULL');
    assert(!open.length, 'test copy already has an open downtime');
    const r = await api('POST', '/downtime/episodes', { token: admin, body: { reason: `Synthetic network outage ${tag}`, startedAt: new Date(Date.now() - 3600e3).toISOString() } });
    assert(r.status === 201, `declare ${r.status}`);
    episode = r.data.data;
    assert((await api('POST', '/downtime/episodes', { token: sa, body: { reason: 'A second outage' } })).status === 409, 'two downtimes at once');
    const log = (body, token = nurse) => api('POST', `/downtime/episodes/${episode.id}/entries`, { token, body });
    const at = new Date(Date.now() - 1800e3).toISOString();
    assert((await log({ kind: 'administration', patientId: admitted.id, paperReference: `MAR-${tag}-1`, occurredAt: new Date(Date.now() - 7200e3).toISOString(), summary: 'Before the outage' })).status === 400, 'a record from before the downtime was logged');
    const a = await log({ kind: 'other', patientId: admitted.id, paperReference: `OBS-${tag}-1`, occurredAt: at, summary: 'Synthetic vital signs on paper' });
    const b = await log({ kind: 'temporary_identity', paperReference: `TID-${tag}-1`, occurredAt: at, summary: 'Unknown patient registered on paper' });
    assert(a.status === 201 && b.status === 201, `log ${a.status}/${b.status}`);
    assert((await log({ kind: 'other', patientId: admitted.id, paperReference: `OBS-${tag}-1`, occurredAt: at, summary: 'again' })).status === 409, 'the same paper form logged twice');
  });

  await step('After the downtime, each record is entered, then checked by someone else; the downtime closes only when all are done', async () => {
    assert((await api('POST', `/downtime/episodes/${episode.id}/end`, { token: admin })).status === 200, 'end');
    const entries = (await api('GET', '/downtime/episodes', { token: nurse })).data.data.find((e) => e.id === episode.id).entries;
    const other = entries.find((e) => e.kind === 'other'); const tid = entries.find((e) => e.kind === 'temporary_identity');
    assert((await api('POST', `/downtime/episodes/${episode.id}/close`, { token: admin })).status === 409, 'closed with records outstanding');
    assert((await api('POST', `/downtime/entries/${tid.id}/entered`, { token: nurse, body: { enteredAs: '999999999' } })).status === 422, 'linked to a record that does not exist');
    const [p] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, identity_status) VALUES ($1, $2, 'other', 30, 'Unknown', 'Indoor', CURRENT_DATE, 'temporary') RETURNING id", [`Unknown patient ${tag}`, `TMP-${tag}`]);
    assert((await api('POST', `/downtime/entries/${tid.id}/entered`, { token: nurse, body: { enteredAs: String(p.id) } })).status === 200, 'enter temporary identity');
    assert((await api('POST', `/downtime/entries/${other.id}/entered`, { token: nurse, body: { enteredAs: 'vitals chart, entered late' } })).status === 200, 'enter other');
    const self = await api('POST', `/downtime/entries/${other.id}/reconcile`, { token: nurse, body: {} });
    assert(self.status === 403, `the nurse checked their own entry: ${self.status}`);
    for (const e of [other, tid]) assert((await api('POST', `/downtime/entries/${e.id}/reconcile`, { token: doctor, body: { note: 'Matches the paper form' } })).status === 200, 'second-person check');
    let rewritten = false;
    try { await sql("UPDATE hms_downtime_entries SET summary = 'changed' WHERE id = $1", [other.id]); } catch { rewritten = true; }
    assert(rewritten, 'a logged paper record was rewritten');
    const closed = await api('POST', `/downtime/episodes/${episode.id}/close`, { token: admin });
    assert(closed.status === 200 && closed.data.data.closed_at, `close ${closed.status} ${JSON.stringify(closed.data)}`);
    assert(!(await sql("SELECT 1 FROM hms_worklist_items WHERE kind = 'downtime.reconcile' AND dedupe_key = $1 AND status = 'Open'", [episode.id])).length, 'reconciliation item left open');
  });

  done();
  process.exit();
})();
