// Live events (completion A8): delivery and catch-up follow the API's patient
// scope, events carry identifiers and an envelope (type, version, sequence,
// patient, record, correlation), a revoked session stops receiving at once,
// and background workers run in their own process when asked.
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { io } = require('../frontend/node_modules/socket.io-client');
const { API, api, apiLogin, sql, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const ORIGIN = API.replace(/\/api$/, '');
const BACKEND = path.join(__dirname, '..', 'backend');
const SECOND_PORT = process.env.E2E_SECOND_PORT || '15103';
const tag = crypto.randomUUID().slice(0, 8);
const PROBE = `scope_probe_${tag}`;

function connect(token) {
  return new Promise((resolve, reject) => {
    const socket = io(ORIGIN, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    socket.received = [];
    socket.onAny((type, data) => socket.received.push({ type, data }));
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => { socket.close(); reject(e); });
  });
}
const probe = (patientId, audience = 'all') => sql(`INSERT INTO hms_outbox (event_type, audience, payload, patient_id)
  VALUES ($1, $2, CAST($3 AS jsonb), $4) RETURNING id`, [PROBE, audience, JSON.stringify({ probe: tag, patient_id: patientId }), patientId]).then(([r]) => Number(r.id));
const ids = (socket) => socket.received.filter((e) => e.type === PROBE).map((e) => e.data.event_id);
async function settle(sockets, wanted, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !wanted.every(([s, id]) => ids(s).includes(id))) await sleep(200);
  await sleep(1500); // and give anything that should not arrive the chance to
}
async function replay(token, after) {
  const r = await api('GET', `/events?after_sequence=${after}`, { token });
  assert(r.status === 200, `events ${r.status}`);
  return r.data.data.filter((e) => e.type === PROBE).map((e) => e.data.event_id);
}
function startProcess(script, extraEnv) {
  const out = [];
  const child = spawn('node', [script], { cwd: BACKEND, env: { ...process.env, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', ...extraEnv } });
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  child.log = () => out.join('');
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}
async function waitForLog(child, text, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end && !child.log().includes(text) && child.exitCode === null) await sleep(200);
  return child.log().includes(text);
}

(async () => {
  const { step, done } = runner('Live event scope');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const free = await sql(`SELECT p.id FROM hms_patients p WHERE NOT patient_in_care($1, p.id)
    AND NOT EXISTS (SELECT 1 FROM hms_ipd_requests r WHERE r.patient_id = p.id AND r.status = 'Pending')
    AND NOT EXISTS (SELECT 1 FROM hms_admissions a WHERE a.patient_id = p.id AND a.status = 'Active') ORDER BY p.id DESC LIMIT 3`, [doctorUser.id]);
  assert(free.length === 3, 'needs three patients outside the doctor\'s care');
  const [mine, other, admitting] = free.map((p) => Number(p.id));
  await inCare(mine);
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const sockets = [];
  let doc, nur, start;

  try {
    await step('A doctor receives a patient\'s live events only for patients in their care; other roles are not limited by care', async () => {
      [{ sequence: start }] = await sql('SELECT COALESCE(max(delivery_sequence), 0)::bigint AS sequence FROM hms_outbox');
      doc = await connect(doctor); nur = await connect(nurse); sockets.push(doc, nur);
      const a = await probe(mine);
      const b = await probe(other);
      const c = await probe(null);
      await settle([doc, nur], [[doc, a], [doc, c], [nur, a], [nur, b], [nur, c]]);
      assert(ids(doc).includes(a) && ids(doc).includes(c), `doctor missed in-care/no-patient events: ${ids(doc)}`);
      assert(!ids(doc).includes(b), 'doctor received an event for a patient outside their care');
      assert([a, b, c].every((id) => ids(nur).includes(id)), `nurse events ${ids(nur)}`);
    });

    await step('Catching up after a reconnect applies the same scope, in delivery order, with the event envelope', async () => {
      const got = await replay(doctor, start);
      const [a, b, c] = (await sql('SELECT id FROM hms_outbox WHERE event_type = $1 ORDER BY id', [PROBE])).map((r) => Number(r.id));
      assert(got.includes(a) && got.includes(c) && !got.includes(b), `doctor replay ${got} (in care ${a}, other ${b}, none ${c})`);
      assert((await replay(nurse, start)).length === 3, 'nurse replay incomplete');
      const live = doc.received.filter((e) => e.type === PROBE).map((e) => e.data);
      const seqs = live.map((e) => e.delivery_sequence);
      assert(seqs.every((s, i) => i === 0 || s > seqs[i - 1]), `out of order ${seqs}`);
      const e = live.find((x) => x.event_id === a);
      assert(e.event_type === PROBE && e.schema_version === 1 && e.patient_id === mine && e.occurred_at && e.delivery_sequence > Number(start), `envelope ${JSON.stringify(e)}`);
    });

    await step('When care ends, the doctor stops receiving the patient\'s events, live and on catch-up', async () => {
      const [{ sequence }] = await sql('SELECT COALESCE(max(delivery_sequence), 0)::bigint AS sequence FROM hms_outbox');
      const [assignment] = await sql('SELECT id FROM hms_care_team_assignments WHERE patient_id = $1 AND practitioner_user_id = $2 AND valid_to IS NULL', [mine, doctorUser.id]);
      const ended = await api('POST', `/patients/hms/${mine}/care-team/${assignment.id}/end`, { token: await apiLogin('admin'), body: { reason: 'Event scope test: care handed over' } });
      assert(ended.status === 200, `end care ${ended.status} ${JSON.stringify(ended.data)}`);
      const d = await probe(mine);
      await settle([nur], [[nur, d]]);
      assert(ids(nur).includes(d), 'nurse missed the event');
      assert(!ids(doc).includes(d), 'doctor still received events after care ended');
      assert(!(await replay(doctor, sequence)).includes(d), 'catch-up returned an event after care ended');
    });

    await step('A new admission request alerts nurses with identifiers only; the details come from the API', async () => {
      await inCare(admitting);
      const before = nur.received.length;
      const r = await api('POST', '/ipd/requests', { token: doctor, body: { patientId: admitting, reasonForAdmission: `Event scope ${tag}`, primaryDiagnosis: 'Synthetic observation', wardPreference: 'General Ward', urgencyLevel: 'Urgent' } });
      assert(r.status === 201, `request ${r.status} ${JSON.stringify(r.data)}`);
      const end = Date.now() + 6000;
      let alert;
      while (Date.now() < end && !(alert = nur.received.slice(before).find((e) => e.type === 'new_ipd_request'))) await sleep(200);
      assert(alert, 'nurse got no admission alert');
      const keys = Object.keys(alert.data).sort().join(',');
      assert(keys === 'aggregate,correlation_id,delivery_sequence,event_id,event_type,occurred_at,patient_id,request_id,schema_version,urgency', `alert keys ${keys}`);
      assert(alert.data.patient_id === admitting && alert.data.urgency === 'Urgent' && alert.data.aggregate.type === 'ipd.request', JSON.stringify(alert.data));
      const list = await api('GET', '/ipd/requests?status=Pending', { token: nurse });
      assert(list.data.data.some((x) => Number(x.ID ?? x.id) === Number(alert.data.request_id)), 'the request the alert names is not readable');
      await sql("UPDATE hms_ipd_requests SET status = 'Cancelled' WHERE id = $1", [alert.data.request_id]);
    });

    await step('An event of another facility reaches no one here, live or on catch-up; this facility\'s events do', async () => {
      const [{ id: here }] = await sql('SELECT hms_initial_facility() AS id');
      const [{ id: other }] = await sql("INSERT INTO hms_facilities (code, name, timezone) VALUES ($1, 'Synthetic second facility', 'Asia/Kolkata') RETURNING id", [`B-${tag}`]);
      const [{ sequence }] = await sql('SELECT COALESCE(max(delivery_sequence), 0)::bigint AS sequence FROM hms_outbox');
      const insert = (facility) => sql(`INSERT INTO hms_outbox (event_type, audience, payload, facility_id) VALUES ($1, 'nurse', CAST($2 AS jsonb), $3) RETURNING id`,
        [PROBE, JSON.stringify({ probe: tag }), facility]).then(([r]) => Number(r.id));
      const away = await insert(other);
      const home = await insert(here);
      await settle([nur], [[nur, home]]);
      assert(ids(nur).includes(home) && !ids(nur).includes(away), `facility scope live: ${ids(nur)} (home ${home}, other ${away})`);
      const replayed = await replay(nurse, sequence);
      assert(replayed.includes(home) && !replayed.includes(away), `facility scope on catch-up ${replayed}`);
    });

    await step('When a grant changes, that user\'s connections are re-checked at once: no facility membership, no connection', async () => {
      const [nurseUser] = await sql("SELECT id FROM hms_users WHERE username = 'nurse'");
      const second = await connect(nurse); sockets.push(second);
      const gone = new Promise((resolve) => second.on('disconnect', () => resolve(true)));
      const [m] = await sql("SELECT id FROM hms_facility_memberships WHERE user_id = $1 AND facility_id = hms_initial_facility() AND revoked_at IS NULL", [nurseUser.id]);
      const [admin] = await sql("SELECT id FROM hms_users WHERE username = 'superadmin'");
      await sql('UPDATE hms_facility_memberships SET revoked_at = now(), revoked_by_user_id = $2 WHERE id = $1', [m.id, admin.id]);
      try {
        await sql("INSERT INTO hms_outbox (event_type, audience, payload) VALUES ('clinical.authorization.changed', $1, '{}'::jsonb)", [`user:${nurseUser.id}`]);
        assert(await Promise.race([gone, sleep(6000).then(() => false)]), 'a user without membership kept a live connection');
      } finally {
        await sql("INSERT INTO hms_facility_memberships (facility_id, user_id, reason, granted_by_user_id) VALUES (hms_initial_facility(), $1, 'Restored after the event scope test (synthetic)', $2)", [nurseUser.id, admin.id]);
      }
    });

    await step('A revoked session is disconnected and receives nothing more', async () => {
      if (!nur.connected) { nur = await connect(nurse); sockets.push(nur); }
      const admin = await apiLogin('super_admin');
      const [nurseUser] = await sql("SELECT id FROM hms_users WHERE username = 'nurse'");
      const gone = new Promise((resolve) => nur.on('disconnect', () => resolve(true)));
      assert((await api('POST', `/security/sessions/${nurseUser.id}/force-logout`, { token: admin })).status === 200, 'force-logout');
      assert(await Promise.race([gone, sleep(5000).then(() => false)]), 'socket stayed connected');
      const e = await probe(null);
      await sleep(2000);
      assert(!ids(nur).includes(e), 'a revoked session received an event');
    });

    await step('Workers run in their own process: an API-only instance starts none, and "node worker.js" starts them', async () => {
      const bad = startProcess('server.js', { PORT: SECOND_PORT, HMS_PROCESS_ROLE: 'workers' });
      assert(await bad.exited !== 0 && bad.log().includes('HMS_PROCESS_ROLE must be one of'), `unknown role accepted: ${bad.log().slice(-200)}`);
      const misuse = startProcess('server.js', { PORT: SECOND_PORT, HMS_PROCESS_ROLE: 'worker' });
      assert(await misuse.exited !== 0 && misuse.log().includes('node worker.js'), 'server.js ran as a worker');
      const apiOnly = startProcess('server.js', { PORT: SECOND_PORT, HMS_PROCESS_ROLE: 'api' });
      const worker = startProcess('worker.js', { DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '' });
      try {
        assert(await waitForLog(apiOnly, 'Server running'), `api-only did not start: ${apiOnly.log().slice(-2500)}`);
        assert(apiOnly.log().includes('separate "node worker.js" process') && !apiOnly.log().includes('Background workers started'), 'api-only instance started workers');
        assert((await fetch(`http://127.0.0.1:${SECOND_PORT}/api/ready`)).ok, 'api-only instance not ready');
        assert(await waitForLog(worker, 'Background workers started'), `worker did not start: ${worker.log().slice(-300)}`);
        assert(worker.log().includes('interfaces') && worker.log().includes('finance') && !worker.log().includes('failed:'), worker.log().slice(-300));
        assert(worker.exitCode === null, 'worker exited');
      } finally {
        apiOnly.kill('SIGTERM'); worker.kill('SIGTERM');
        await Promise.all([apiOnly.exited, worker.exited]);
      }
    });
  } finally {
    sockets.forEach((s) => s.close());
    await sql("UPDATE hms_care_team_assignments SET valid_to = now(), ended_reason = 'Event scope test finished' WHERE practitioner_user_id = $1 AND patient_id = ANY($2::int[]) AND valid_to IS NULL", [doctorUser.id, [mine, admitting]]).catch(() => {});
  }
  done();
  process.exit();
})();
