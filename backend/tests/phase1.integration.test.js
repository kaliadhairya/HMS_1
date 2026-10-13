const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const enabled = process.env.HMS_TEST_DATABASE === 'true';

test('Phase 1 transaction and failure acceptance', { skip: !enabled }, async (t) => {
  assert.match(process.env.DB_NAME || '', /^hms_(phase1|test|ci|verify)/, 'Use an isolated test database');
  const express = require('express');
  const { Client } = require('pg');
  const { sequelize } = require('../models/db');
  const { dbConfig } = require('../migrate');
  const { requestContext, bindAuditActor, storage } = require('../utils/auditContext');
  const { idempotencyGuard } = require('../utils/idempotency');
  const settings = require('../utils/settings');
  const { publish, allocateSequences, eventsPage, latestSequence } = require('../utils/outbox');
  const { acceptOnce } = require('../utils/inbox');
  bindAuditActor(sequelize);
  const db = new Client(dbConfig());
  t.after(async () => { await db.end().catch(() => {}); await sequelize.close().catch(() => {}); });
  await db.connect();
  const { rows: users } = await db.query("SELECT id FROM hms_users WHERE role = 'receptionist' ORDER BY id LIMIT 1");
  assert.ok(users.length, 'Seed test users first');
  const userId = users[0].id;
  await db.query("SELECT setval('hms_patient_advances_seq', (SELECT COALESCE(max(id),0)+100 FROM hms_patient_advances), false)");
  const tag = crypto.randomUUID();
  const { rows: patients } = await db.query("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ('Phase 1 synthetic patient', $1, 'other', 30, 'Male', 'OPD', CURRENT_DATE) RETURNING id", [`P1-${tag.slice(0,12)}`]);
  const patientId = patients[0].id;
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use((req, res, next) => { req.user = { id: userId, role: 'receptionist' }; storage.getStore().userId = userId; next(); });
  app.use(require('../middleware/accessAudit'));
  let stalled;
  let resume;
  const begun = new Promise((resolve) => { stalled = resolve; });
  const released = new Promise((resolve) => { resume = resolve; });
  let stalledOnce = false;
  app.post('/api/billing/payment', (req, res, next) => idempotencyGuard(req, res, next).catch(next), async (req, res, next) => {
    try {
      const insert = async () => {
        const [rows] = await sequelize.query(`INSERT INTO hms_patient_advances (id, patient_id, amount, payment_mode, received_by, notes) VALUES (nextval('hms_patient_advances_seq'), :patientId, 10, 'Cash', :userId, :note) RETURNING id`, { replacements: { patientId, userId, note: req.body.note } });
        return rows[0].id;
      };
      const id = req.body.nested ? await sequelize.transaction(async () => insert()) : await insert();
      if (req.body.stall && !stalledOnce) {
        stalledOnce = true;
        await sequelize.query("UPDATE hms_idempotency_keys SET created_at = now() - interval '10 minutes' WHERE request_id = :requestId", { replacements: { requestId: req.id } });
        const [[row]] = await sequelize.query('SELECT pg_backend_pid() AS pid');
        stalled(row.pid);
        await released;
      }
      res.status(req.body.fail || 201).json({ success: !req.body.fail, id });
    } catch (error) { next(error); }
  });
  app.get('/api/patients/:patientId', (req, res) => {
    res.type('application/pdf');
    res.write('PRIVATE-SENTINEL');
    res.end('-END');
  });
  app.use('/api/auth', require('../routes/auth'));
  app.use((error, req, res, next) => res.status(500).json({ success: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const call = (body, key) => fetch(`${origin}/api/billing/payment`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) });
  const count = async (note) => Number((await db.query('SELECT count(*) AS n FROM hms_patient_advances WHERE notes = $1', [note])).rows[0].n);
  try {
    await t.test('domain changes and their original response become visible atomically', async () => {
      const key = crypto.randomUUID();
      const body = { note: `${tag}-atomic`, nested: true };
      const first = await call(body, key);
      assert.equal(first.status, 201);
      const answer = await first.json();
      const receipt = (await db.query('SELECT state, response_body FROM hms_idempotency_keys WHERE user_id=$1 AND idempotency_key=$2', [userId, key])).rows[0];
      assert.equal(receipt.state, 'completed');
      assert.equal(receipt.response_body.id, answer.id);
      const replay = await call({ nested: true, note: body.note }, key);
      assert.equal(replay.headers.get('idempotent-replay'), 'true');
      assert.deepEqual(await replay.json(), answer);
      assert.equal(await count(body.note), 1);
    });
    await t.test('500 after nested writes rolls back changes, audit and the claim', async () => {
      const key = crypto.randomUUID();
      const body = { note: `${tag}-failure`, nested: true, fail: 500 };
      assert.equal((await call(body, key)).status, 500);
      assert.equal(await count(body.note), 0);
      assert.equal((await db.query('SELECT count(*)::int AS n FROM hms_idempotency_keys WHERE idempotency_key=$1', [key])).rows[0].n, 0);
      assert.equal((await db.query("SELECT count(*)::int AS n FROM audit.row_changes WHERE new_values->>'notes'=$1", [body.note])).rows[0].n, 0);
    });
    await t.test('400 after a write rolls back the domain but keeps a replayable rejection', async () => {
      const key = crypto.randomUUID();
      const body = { note: `${tag}-rejection`, fail: 400 };
      assert.equal((await call(body, key)).status, 400);
      const replay = await call(body, key);
      assert.equal(replay.status, 400);
      assert.equal(replay.headers.get('idempotent-replay'), 'true');
      assert.equal(await count(body.note), 0);
    });
    await t.test('a ten-minute-old active original is held; terminating its DB connection permits one retry', async () => {
      const key = crypto.randomUUID();
      const body = { note: `${tag}-crash`, stall: true };
      const original = call(body, key);
      const pid = await Promise.race([begun, new Promise((_,reject)=>setTimeout(()=>reject(new Error('stalled fixture did not start')),3000))]);
      const repeat = await call(body, key);
      assert.equal(repeat.status, 409);
      assert.equal((await repeat.json()).code, 'IDEMPOTENCY_IN_PROGRESS');
      assert.equal(await count(body.note), 0);
      await db.query('SELECT pg_terminate_backend($1)', [pid]);
      resume();
      assert.ok((await original).status >= 500);
      assert.equal((await call(body, key)).status, 201);
      assert.equal(await count(body.note), 1);
    });
    await t.test('lost HTTP response after commit replays the same result without another payment', async () => {
      const http = require('http');
      const proxy = http.createServer((req, res) => {
        const upstream = http.request(`${origin}/api/billing/payment`, { method: 'POST', headers: req.headers }, (reply) => { reply.resume(); res.destroy(); });
        req.pipe(upstream);
      }).listen(0, '127.0.0.1');
      await new Promise((resolve) => proxy.once('listening', resolve));
      const key = crypto.randomUUID();
      const body = { note: `${tag}-lost` };
      try {
        await assert.rejects(fetch(`http://127.0.0.1:${proxy.address().port}`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify(body) }));
        const replay = await call(body, key);
        assert.equal(replay.status, 201);
        assert.equal(replay.headers.get('idempotent-replay'), 'true');
        assert.equal(await count(body.note), 1);
      } finally { proxy.closeAllConnections(); await new Promise((resolve) => proxy.close(resolve)); }
    });
    await t.test('access audit is durable before the first streamed clinical byte', async () => {
      const response = await fetch(`${origin}/api/patients/${patientId}`);
      const id = response.headers.get('x-request-id');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM audit.access_events WHERE request_id=$1', [id])).rows[0].n, 1);
      assert.equal(await response.text(), 'PRIVATE-SENTINEL-END');
    });
    await t.test('access-audit failure returns 503 without any clinical stream bytes', async () => {
      const query = sequelize.query;
      sequelize.query = async function(sql, options) { if (sql.includes('INSERT INTO audit.access_events')) throw new Error('injected audit failure'); return query.call(this, sql, options); };
      try {
        const response = await fetch(`${origin}/api/patients/${patientId}`);
        assert.equal(response.status, 503);
        assert.ok(!(await response.text()).includes('PRIVATE-SENTINEL'));
      } finally { sequelize.query = query; }
    });
    await t.test('stale settings refresh cannot overwrite a committed update; rolled-back cache changes remain invisible', async () => {
      await settings.saveSetting('session_timeout', { nurse: 30 });
      const query = sequelize.query;
      let unblock, reached;
      const snapshot = new Promise((resolve) => { reached = resolve; });
      sequelize.query = async function(sql, options) {
        const result = await query.call(this, sql, options);
        if (sql === 'SELECT key, value, revision FROM hms_app_settings') { reached(); await new Promise((resolve) => { unblock = resolve; }); }
        return result;
      };
      const refresh = settings.loadSettings();
      await snapshot;
      await settings.saveSetting('session_timeout', { nurse: 41 });
      unblock(); await refresh; sequelize.query = query;
      assert.equal(settings.session_timeout.nurse, 41);
      await assert.rejects(sequelize.transaction(async (transaction) => { await settings.saveSetting('session_timeout', { nurse: 99 }, null, { transaction }); throw new Error('abort'); }));
      assert.equal(settings.session_timeout.nurse, 41);
    });
    await t.test('failed commit does not publish uncommitted settings to the cache', async () => {
      const before=structuredClone(settings.session_timeout);
      const query=sequelize.query;
      sequelize.query=async function(sql,options){if(/^COMMIT/i.test(sql))throw new Error('injected commit failure');return query.call(this,sql,options);};
      try { await assert.rejects(settings.saveSetting('session_timeout',{nurse:999})); }
      finally {sequelize.query=query;}
      assert.deepEqual(settings.session_timeout,before);
      assert.deepEqual((await db.query("SELECT value FROM hms_app_settings WHERE key='session_timeout'")).rows[0].value,before);
    });
    await t.test('password-reset credentials are consumed once even with simultaneous requests', async()=>{
      const User=require('../models/User');const {signPasswordResetToken}=require('../utils/authTokens');
      const user=await User.create({username:`p1_${tag.slice(0,12)}`,name:'Synthetic reset principal',role:'nurse',password:'InitialTest@123',isActive:1,first_login:'N'});
      const token=signPasswordResetToken(user);
      const reset=()=>fetch(`${origin}/api/auth/reset-password`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resetToken:token,newPassword:'ReplacementTest@123'})});
      const results=await Promise.all([reset(),reset()]);assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
    });
    await t.test('failed session revocation rolls back the password and leaves reset credentials usable', async()=>{
      const User=require('../models/User');const {signPasswordResetToken}=require('../utils/authTokens');
      const user=await User.create({username:`p1b_${tag.slice(0,12)}`,name:'Synthetic revoke principal',role:'nurse',password:'InitialTest@123',isActive:1,first_login:'N'});
      const token=signPasswordResetToken(user);const before=user.password;
      const query=sequelize.query;
      sequelize.query=async function(sql,options){if(/UPDATE hms_sessions SET revoked_at/.test(sql))throw new Error('injected revocation failure');return query.call(this,sql,options);};
      const reset=()=>fetch(`${origin}/api/auth/reset-password`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({resetToken:token,newPassword:'ReplacementTest@123'})});
      try {assert.equal((await reset()).status,500);}finally{sequelize.query=query;}
      assert.equal((await User.findByPk(user.id)).password,before);
      assert.equal((await reset()).status,200);
    });
    await t.test('concurrent settings transforms retain both edits', async () => {
      await Promise.all([settings.saveSetting('session_timeout', (current) => ({ ...current, doctor: 42 })), settings.saveSetting('session_timeout', (current) => ({ ...current, pharmacist: 43 }))]);
      const row = (await db.query("SELECT value FROM hms_app_settings WHERE key='session_timeout'")).rows[0];
      assert.equal(row.value.doctor, 42); assert.equal(row.value.pharmacist, 43);
    });
    await t.test('late-committing lower event IDs remain available after newer IDs were replayed', async () => {
      const baseline = await latestSequence();
      const early = await sequelize.transaction();
      await publish(`${tag}-late`, `user:${userId}`, {}, { transaction: early });
      await sequelize.transaction((transaction) => publish(`${tag}-first`, `user:${userId}`, {}, { transaction }));
      await allocateSequences();
      const page = await eventsPage({id:userId,role:'receptionist'}, baseline);
      assert.ok(page.data.some((event) => event.type === `${tag}-first`));
      assert.ok(!page.data.some((event) => event.type === `${tag}-late`));
      await early.commit(); await allocateSequences();
      const later = await eventsPage({id:userId,role:'receptionist'}, page.next_sequence);
      assert.ok(later.data.some((event) => event.type === `${tag}-late`));
    });
    await t.test('replay paginates a backlog larger than 200 events', async () => {
      const baseline = await latestSequence();
      await sequelize.transaction(async (transaction) => { for(let i=0;i<451;i++) await publish(`${tag}-batch`, `user:${userId}`, {i}, {transaction}); });
      for(let i=0;i<100;i++) {
        await allocateSequences();
        const pending=(await db.query('SELECT count(*)::int AS n FROM hms_outbox WHERE event_type=$1 AND delivery_sequence IS NULL',[`${tag}-batch`])).rows[0].n;
        if(!pending)break;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      let cursor=baseline, more, found=[];
      do { const page=await eventsPage({id:userId,role:'receptionist'},cursor); found.push(...page.data.filter((event)=>event.type===`${tag}-batch`)); cursor=page.next_sequence; more=page.has_more; } while(more);
      assert.equal(found.length,451); assert.equal(new Set(found.map((event)=>event.data.event_id)).size,451);
    });
    await t.test('inbox processing rollback permits redelivery; committed messages deduplicate', async () => {
      const id=crypto.randomUUID();
      await assert.rejects(sequelize.transaction(async(transaction)=>{assert.equal(await acceptOnce('p1',id,{transaction}),true);throw new Error('abort');}));
      await sequelize.transaction(async(transaction)=>{assert.equal(await acceptOnce('p1',id,{transaction}),true);assert.equal(await acceptOnce('p1',id,{transaction}),false);});
    });
  } finally {
    server.closeAllConnections(); await new Promise((resolve)=>server.close(resolve));
    await db.end(); await sequelize.close();
  }
});
