// Durable state (migration 0008): settings and IPD draft charges live in the
// database, not in one process; notifications are saved with the change they
// announce and delivered even when the process that saved them dies first.
//
// A second backend process (port 5003, same database) stands in for "after a
// restart" and for "another server instance".
const { spawn } = require('child_process');
const path = require('path');
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, sleep } = require('./helpers');
const { io } = require('../frontend/node_modules/socket.io-client');

const BACKEND = path.join(__dirname, '..', 'backend');
const ORIGIN = API.replace(/\/api$/, '');
const SECOND_PORT = process.env.E2E_SECOND_PORT || '15103';
const SECOND = `http://127.0.0.1:${SECOND_PORT}`;

function startSecondServer(extraEnv = {}) {
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: {
      ...process.env, ...extraEnv, PORT: SECOND_PORT, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '',
      JWT_SECRET: process.env.JWT_SECRET, INTERNAL_SERVICE_SECRET: '', TZ: 'UTC',
    },
    stdio: 'ignore',
  });
  return child;
}

async function waitUntil(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { try { if (await fn()) return true; } catch { /* not yet */ } await sleep(300); }
  return false;
}

async function call(base, method, url, token, body, headers = {}) {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers,
      ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, requestId: res.headers.get('x-request-id'), data: await res.json().catch(() => null) };
}

async function loginAt(base, username, password) {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-auth-transport': 'bearer' },
    body: JSON.stringify({ username, password }),
  });
  return (await res.json()).token;
}

function listen(token, event) {
  return new Promise((resolve, reject) => {
    const socket = io(ORIGIN, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    const received = [];
    socket.on(event, (data) => received.push(data));
    socket.on('connect', () => resolve({ socket, received }));
    socket.on('connect_error', reject);
  });
}

// A real signed-order amendment replaces the retired free-text status command
// as the notification trigger; the durable outbox failure scenarios are unchanged.
async function medicationDraft(token) {
  assert(/^hms_p3_/.test(process.env.DB_NAME || ''), 'Use an isolated Phase 3 database');
  const [fixture] = await sql(`SELECT o.patient_id,o.encounter_id,v.product_id,v.dose,v.dose_unit,v.route,v.frequency,v.supply_quantity,v.supply_unit
    FROM hms_med_orders o JOIN hms_med_order_versions v ON v.order_id=o.id AND v.version=o.current_version
    JOIN hms_patients p ON p.id=o.patient_id WHERE p.name LIKE 'Synthetic%' AND v.product_id IS NOT NULL AND v.prn=false ORDER BY o.created_at DESC LIMIT 1`);
  assert(fixture, 'Run medication acceptance fixtures first');
  const tag=crypto.randomUUID().slice(0,8);
  const [patient]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',40,'Other','OPD',CURRENT_DATE) RETURNING id",['Synthetic outbox patient '+tag,'P3-OUTBOX-'+tag]);
  const [prescriber]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [encounter]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",[patient.id,prescriber.id]);
  const body={...fixture,patient_id:patient.id,encounter_id:encounter.id,starts_at:new Date(Date.now()-60000).toISOString(),ends_at:new Date(Date.now()+86400000).toISOString()};
  const r=await call(ORIGIN,'POST','/medication/orders',token,body);
  assert(r.status===201, 'Unable to create coded notification fixture');
  const signed=await call(ORIGIN,'POST','/medication/orders/'+r.data.data.order.id+'/sign',token,{reason:'Synthetic outbox authorization'},{'if-match':'1'});
  assert(signed.status===200, 'Unable to authorize the outbox fixture');
  return {id:r.data.data.order.id,revision:2,body};
}
async function amend(base,token,rx) {
  return call(base,'POST',`/medication/orders/${rx.id}/amend`,token,{...rx.body,reason:'Synthetic durable notification test'}, {'if-match':String(rx.revision)});
}

(async () => {
  const { step, done } = runner('Durability');
  const sa = await apiLogin('super_admin');
  const doctor = await apiLogin('doctor');
  const lab = await apiLogin('lab_technician');
  let second = null;

  try {
    await step('A saved setting is stored in the database and audited', async () => {
      const before = (await call(ORIGIN, 'GET', '/security/sessions', sa)).data.data.timeout_settings;
      const r = await call(ORIGIN, 'PUT', '/security/sessions/timeout', sa, { nurse: 45 });
      assert(r.status === 200, `save ${r.status}`);
      const [row] = await sql("SELECT value FROM hms_app_settings WHERE key = 'session_timeout'");
      assert(row && row.value.nurse === 45, `stored ${JSON.stringify(row)}`);
      const audited = await sql("SELECT actor_user_id FROM audit.row_changes WHERE table_name = 'hms_app_settings' AND request_id = $1", [r.requestId]);
      assert(audited.length === 1 && audited[0].actor_user_id, 'setting change not audited');
      await call(ORIGIN, 'PUT', '/security/sessions/timeout', sa, before);
    });

    await step('A change made by another server instance is picked up without a restart', async () => {
      const [row] = await sql("SELECT value FROM hms_app_settings WHERE key = 'session_timeout'");
      await sql("UPDATE hms_app_settings SET value = jsonb_set(value, '{pharmacist}', '17') WHERE key = 'session_timeout'");
      try {
        const seen = await waitUntil(async () => (await call(ORIGIN, 'GET', '/security/sessions', sa)).data.data.timeout_settings.pharmacist === 17, 12000);
        assert(seen, 'running server never saw the change');
      } finally {
        await sql("UPDATE hms_app_settings SET value = $1 WHERE key = 'session_timeout'", [row.value]);
      }
    });

    await step('API keys are stored as a hash; the full key is shown once', async () => {
      const created = await call(ORIGIN, 'POST', '/security/api-keys', sa, { name: `e2e-${Date.now()}` });
      assert(created.status === 200 && /^hms_[0-9a-f]{48}$/.test(created.data.data.key), 'no key returned at creation');
      const [row] = await sql("SELECT value FROM hms_app_settings WHERE key = 'api_keys'");
      const stored = row.value.find((k) => k.id === created.data.data.id);
      assert(stored && !stored.key && stored.key_hash === crypto.createHash('sha256').update(created.data.data.key).digest('hex'), 'raw key stored');
      const listed = (await call(ORIGIN, 'GET', '/security/api-keys', sa)).data.data.find((k) => k.id === created.data.data.id);
      assert(listed && !listed.key && !listed.key_hash && listed.key_prefix, `list exposes ${JSON.stringify(listed)}`);
      await call(ORIGIN, 'DELETE', `/security/api-keys/${created.data.data.id}`, sa);
    });

    await step('One-time API-key secrets are absent from idempotency receipts', async () => {
      const key=crypto.randomUUID();
      const body={name:`e2e-secret-${Date.now()}`};
      const request=()=>fetch(`${ORIGIN}/api/security/api-keys`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${sa}`,'idempotency-key':key},body:JSON.stringify(body)});
      const first=await request(); const answer=await first.json();
      assert(first.status===200 && answer.data.key,'creation failed');
      const [receipt]=await sql('SELECT response_body FROM hms_idempotency_keys WHERE idempotency_key=$1',[key]);
      assert(!JSON.stringify(receipt.response_body).includes(answer.data.key),'one-time secret persisted in receipt');
      const replay=await request();
      assert(replay.status===409 && (await replay.json()).code==='ONE_TIME_SECRET_ALREADY_ISSUED','secret replay was not held');
      await call(ORIGIN,'DELETE',`/security/api-keys/${answer.data.id}`,sa);
    });

    second = startSecondServer();
    assert(await waitUntil(async () => (await fetch(`${SECOND}/api/ready`)).ok, 30000), 'second server did not start');

    await step('Settings and IPD draft charges written by one process are seen by a freshly started one', async () => {
      const [admission] = await sql("SELECT id FROM hms_admissions WHERE status = 'Active' AND NOT EXISTS (SELECT 1 FROM hms_bills b WHERE b.admission_id = hms_admissions.id) ORDER BY id LIMIT 1");
      const [medicine] = await sql('SELECT id, generic_name FROM hms_medicines WHERE is_active = 1 ORDER BY id LIMIT 1');
      assert(admission && medicine, 'no unbilled active admission or medicine to use');
      const added = await call(ORIGIN, 'POST', `/ipd/admissions/${admission.id}/charges`, sa, { medicineId: medicine.id, medicineName: medicine.generic_name, quantity: 2 });
      assert(added.status === 200, `add charge ${added.status} ${JSON.stringify(added.data)}`);
      try {
        const sa2 = await loginAt(SECOND, 'superadmin', 'Superadmin@123');
        const charges = (await call(SECOND, 'GET', `/ipd/admissions/${admission.id}/charges`, sa2)).data.data.charges;
        assert(charges.some((c) => c.ID === added.data.data.ID && c.QUANTITY === 2), 'second process does not see the draft charge');
        const [ip] = await sql("SELECT value FROM hms_app_settings WHERE key = 'session_timeout'");
        const consistent=await waitUntil(async()=>{
          const observed=(await call(SECOND,'GET','/security/sessions',sa2)).data.data.timeout_settings;
          return require('node:util').isDeepStrictEqual(observed,ip.value);
        },12000);
        assert(consistent, 'second process has different settings beyond the refresh interval');
      } finally {
        await call(ORIGIN, 'DELETE', `/ipd/admissions/${admission.id}/charges/${added.data.data.ID}`, sa);
      }
    });

    await step('A change and its notification commit together; connected clients receive it with an event ID', async () => {
      const rx = await medicationDraft(doctor);
      const { socket, received } = await listen(doctor, 'medication_order_changed');
      try {
        const r = await amend(ORIGIN, doctor, rx);
        assert(r.status === 200, `status change ${r.status}`);
        const events = await sql('SELECT id, audience FROM hms_outbox WHERE request_id = $1 ORDER BY id', [r.requestId]);
        assert(events.length === 3, `expected 3 outbox events, found ${events.length}`);
        assert(await waitUntil(async () => received.some((e) => events.some((ev) => Number(ev.id) === e.event_id))), 'event not delivered to the doctor');
      } finally {
        socket.close();
      }
    });

    await step('An event saved by a process that is killed before delivering it is delivered by another', async () => {
      second.kill('SIGKILL');
      second = startSecondServer({ OUTBOX_DISPATCH: 'off' });
      assert(await waitUntil(async () => (await fetch(`${SECOND}/api/ready`)).ok, 30000), 'second server did not restart');
      const doctor2 = await loginAt(SECOND, 'doctor', 'Doctor@123');
      const rx = await medicationDraft(doctor);
      // Saved by the second server, whose dispatcher is off: the event waits in the outbox.
      const { socket, received } = await listen(doctor, 'medication_order_changed');
      try {
        const r = await amend(SECOND, doctor2, rx);
        assert(r.status === 200, `status change ${r.status}`);
        const [event] = await sql("SELECT id FROM hms_outbox WHERE request_id = $1 AND audience = 'doctor'", [r.requestId]);
        second.kill('SIGKILL');
        second = null;
        assert(await waitUntil(async () => received.some((e) => e.event_id === Number(event.id))), 'orphaned event was never delivered');
        const [row] = await sql('SELECT delivered_at FROM hms_outbox WHERE id = $1', [event.id]);
        assert(row.delivered_at, 'event not marked delivered');
      } finally {
        socket.close();
      }
    });

    await step('An event left undelivered while every server was down is delivered by the next server to start', async () => {
      // An undelivered event from an old transaction: no running dispatcher will reach back for it.
      const [{ sequence: beforeSequence }] = await sql('SELECT COALESCE(max(delivery_sequence),0) AS sequence FROM hms_outbox');
      const [orphan] = await sql(`INSERT INTO hms_outbox (txid, event_type, audience, payload)
                                  VALUES ('3'::xid8, 'e2e_orphan', 'doctor', '{"note":"left behind"}') RETURNING id`);
      const code = `const { dispatchOnce } = require('./utils/outbox'); const { sequelize } = require('./models/db');
        const sent = []; const room = { emit: (type, data) => sent.push({ type, id: data.event_id }) };
        const io = { to: () => room, emit: room.emit };
        (async () => { await dispatchOnce(io, { cursor: ${Number(beforeSequence)} }); console.log(JSON.stringify(sent)); await sequelize.close(); })();`;
      const out = await new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', code], { cwd: BACKEND, env: process.env });
        let text = '';
        child.stdout.on('data', (d) => { text += d; });
        child.on('close', () => resolve(text.trim().split('\n').pop()));
        child.on('error', reject);
      });
      const sent = JSON.parse(out || '[]');
      assert(sent.some((e) => e.type === 'e2e_orphan' && e.id === Number(orphan.id)), `starting dispatcher sent ${out}`);
      const [row] = await sql('SELECT delivered_at FROM hms_outbox WHERE id = $1', [orphan.id]);
      assert(row.delivered_at, 'orphan not marked delivered');
    });

    await step('A client that was disconnected catches up, and only on events meant for its role', async () => {
      const [{ id: before }] = await sql('SELECT COALESCE(max(id), 0) AS id FROM hms_outbox');
      const rx = await medicationDraft(doctor);
      const r = await amend(ORIGIN, doctor, rx);
      assert(r.status === 200, `status change ${r.status}`);
      assert(await waitUntil(async () => (await sql('SELECT count(*)::int AS n FROM hms_outbox WHERE request_id = $1 AND delivered_at IS NULL', [r.requestId]))[0].n === 0), 'not delivered');
      const forDoctor = (await call(ORIGIN, 'GET', `/events?after=${before}`, doctor)).data.data;
      assert(forDoctor.some((e) => e.type === 'medication_order_changed'), 'doctor missed event not returned');
      const forLab = (await call(ORIGIN, 'GET', `/events?after=${before}`, lab)).data.data;
      assert(!forLab.some((e) => e.type === 'medication_order_changed'), 'lab technician received a doctor/pharmacist event');
    });

    await step('The inbox accepts a message once', async () => {
      const id = crypto.randomUUID();
      const code = `const { acceptOnce } = require('./utils/inbox'); const { sequelize } = require('./models/db');
        (async () => { const result = await sequelize.transaction(async(transaction) => { const a = await acceptOnce('e2e', '${id}', {transaction}); const b = await acceptOnce('e2e', '${id}', {transaction}); return [a,b]; }); console.log(JSON.stringify(result)); await sequelize.close(); })();`;
      const out = await new Promise((resolve, reject) => {
        const child = spawn('node', ['-e', code], { cwd: BACKEND, env: process.env });
        let text = '';
        child.stdout.on('data', (d) => { text += d; });
        child.on('close', () => resolve(text.trim().split('\n').pop()));
        child.on('error', reject);
      });
      assert(out === '[true,false]', `acceptOnce returned ${out}`);
    });

    await step('Sessions work across replicas and logout on another replica drops the original socket', async () => {
      second=startSecondServer();
      assert(await waitUntil(async()=> (await fetch(`${SECOND}/api/ready`)).ok,30000),'second replica did not start');
      const token=await loginAt(ORIGIN,'doctor','Doctor@123');
      assert((await call(SECOND,'GET','/auth/me',token)).status===200,'session not portable across replicas');
      const {socket}=await listen(token,'medication_order_changed');
      try {
        assert((await call(SECOND,'POST','/auth/logout',token,{})).status===200,'remote logout failed');
        assert(await waitUntil(async()=>!socket.connected,5000),'revoked socket survived on the original replica');
        assert((await call(ORIGIN,'GET','/auth/me',token)).status===401,'original replica accepted revoked session');
      }finally{socket.close();}
    });
  } finally {
    if (second) second.kill('SIGKILL');
  }

  done();
  process.exit(process.exitCode || 0);
})();
