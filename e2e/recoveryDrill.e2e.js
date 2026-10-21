// Recovery drill (completion B7), on disposable copies only: a primary with
// a running HMS, a recovery copy taken from it, more writes on the primary
// (lost in the recovery window), then promotion. The old primary must be
// fenced before the new one takes writes; HMS on the old database stops
// being ready and cannot write; HMS refuses to start on it; on the new
// primary every old session is revoked, pending outbound messages are held
// and unfinished payments become Unknown for reconciliation. RPO and RTO of
// this local drill are measured and saved. Not regional evidence.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { api, runner, assert, sleep, creds, requireThrowawayDb, pgDocker } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const TEMPLATE = process.env.PHASE4_FOUNDATION_DB_NAME;
const tag = crypto.randomBytes(3).toString('hex');
const OLD = `hms_verify_claude_b7old_${tag}`;
const NEW = `hms_verify_claude_b7new_${tag}`;
const PORT_A = Number(process.env.E2E_SECOND_PORT || 15574);
const PORT_B = PORT_A + 2;
const ART = process.env.E2E_ARTIFACT_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'hms-b7-'));
const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
const dbConf = (database) => ({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres', database });
async function q(database, text, params = []) { const c = new Client(dbConf(database)); await c.connect(); try { return (await c.query(text, params)).rows; } finally { await c.end(); } }
const sh = (cmd, args, env = {}) => new Promise((resolve) => execFile(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout) + String(stderr), stdout: String(stdout) })));
const dockerPsql = (db, sql) => sh('docker', [...pgDocker('psql -U postgres -d "$0" -Atc "$1"'), db, sql]);
function startApi(database, port) {
  const child = spawn('node', ['server.js'], { cwd: BACKEND, env: { ...process.env, DB_NAME: database, PORT: String(port), AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '', OUTBOX_DISPATCH: 'off', INTERFACE_WORKER: 'off', FINANCE_WORKER: 'off' } });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d))); child.stderr.on('data', (d) => out.push(String(d)));
  child.log = () => out.join('');
  child.exited = new Promise((r) => child.on('exit', r));
  return child;
}
const base = (port) => `http://127.0.0.1:${port}/api`;
async function waitReady(port, child, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null) return false;
    if (await fetch(`${base(port)}/ready`).then((r) => r.ok).catch(() => false)) return true;
    await sleep(200);
  }
  return false;
}
async function login(port, role) {
  const [username, password] = creds(role);
  const r = await fetch(`${base(port)}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Auth-Transport': 'bearer' }, body: JSON.stringify({ username, password }) });
  return (await r.json()).token;
}
const call = (port, method, url, token, body) => fetch(base(port) + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) })).catch((e) => ({ status: 599, error: e.message }));
const promote = (env) => sh('node', ['scripts/recovery-promote.cts'], { RECOVERY_REASON: `Recovery drill ${tag}`, NEW_DB_NAME: NEW, NEW_DB_HOST: dbConf().host, NEW_DB_PORT: String(dbConf().port), NEW_DB_USER: dbConf().user, NEW_DB_PASSWORD: dbConf().password, ...env });
const patient = (port, token, n) => call(port, 'POST', '/patients/hms', token, { patientType: 'other', name: `Recovery drill ${tag} ${n}`, age: 40, gender: 'Other', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `96${String(Date.now()).slice(-8)}` });

(async () => {
  const { step, done } = runner('Recovery drill');
  assert(TEMPLATE && /^hms_verify_/.test(TEMPLATE), 'needs PHASE4_FOUNDATION_DB_NAME (an idle hms_verify_* copy) as the template');
  const evidence = { drill: tag, local_only: true };
  let apiA, apiB, tokenA;

  try {
    await step('Setup: a primary copy with a running HMS, a session, a pending outbound message and an unfinished payment', async () => {
      const made = await sh('docker', pgDocker(`createdb -U postgres -T ${TEMPLATE} ${OLD}`));
      assert(made.code === 0, `createdb ${made.out}`);
      const mig = await sh('node', ['migrate.js', 'up'], { DB_NAME: OLD });
      assert(mig.code === 0, `migrate ${mig.out.slice(-300)}`);
      const [{ id: pid }] = await q(OLD, "INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 30, 'Other', 'OPD', CURRENT_DATE) RETURNING id", [`Drill payer ${tag}`, `B7-${tag}`]);
      await q(OLD, "INSERT INTO hms_interface_messages (direction, system, message_type, contract_version, external_id, payload, status,delivery_epoch,delivery_cluster_id) SELECT 'out', 'sms', 'drill', '1', $1, '{}'::jsonb, 'Pending',epoch,cluster_id FROM hms_writer_fence WHERE singleton", [`B7-${tag}`]);
      await q(OLD, "INSERT INTO hms_payment_intents (patient_id, purpose, amount, method, state, created_by) VALUES ($1, 'deposit', 100, 'Card', 'Pending', (SELECT id FROM hms_users WHERE username = 'receptionist'))", [pid]);
      apiA = startApi(OLD, PORT_A);
      assert(await waitReady(PORT_A, apiA), `API on the primary did not start: ${apiA.log().slice(-400)}`);
      tokenA = await login(PORT_A, 'receptionist');
      assert((await patient(PORT_A, tokenA, 1)).status === 201, 'first write on the primary');
    });

    await step('A recovery copy is taken; later writes on the primary fall inside the recovery window and are counted', async () => {
      await sh('docker', pgDocker(`createdb -U postgres ${NEW}`));
      const copied = await sh('docker', pgDocker(`pg_dump -U postgres -Fc -d ${OLD} | pg_restore -U postgres -d ${NEW} --no-owner --exit-on-error`));
      assert(copied.code === 0, `copy ${copied.out.slice(-300)}`);
      for (let i = 2; i <= 4; i++) assert((await patient(PORT_A, tokenA, i)).status === 201, `write ${i}`);
      const [onOld] = await q(OLD, "SELECT count(*)::int AS n, max(occurred_at) AS last FROM audit.row_changes WHERE table_name = 'hms_patients' AND new_values->>'name' LIKE $1", [`Recovery drill ${tag}%`]);
      const [onNew] = await q(NEW, "SELECT count(*)::int AS n, max(occurred_at) AS last FROM audit.row_changes WHERE table_name = 'hms_patients' AND new_values->>'name' LIKE $1", [`Recovery drill ${tag}%`]);
      evidence.writes_on_primary = onOld.n; evidence.writes_in_copy = onNew.n;
      evidence.rpo_seconds = (new Date(onOld.last) - new Date(onNew.last)) / 1000;
      assert(onOld.n === 4 && onNew.n === 1 && evidence.rpo_seconds > 0, `recovery window ${JSON.stringify(evidence)}`);
    });

    await step('Promotion is refused when the old primary can be neither fenced nor shown to be isolated', async () => {
      const r = await promote({ OLD_DB_NAME: OLD, OLD_DB_HOST: '127.0.0.1', OLD_DB_PORT: '9', OLD_DB_USER: 'postgres', OLD_DB_PASSWORD: 'x' });
      assert(r.code === 2 && /could not be fenced/.test(r.out), `unfenced promotion: ${r.code} ${r.out.slice(-300)}`);
      const [f] = await q(NEW, 'SELECT epoch, role FROM hms_writer_fence');
      assert(f.epoch === 1 && f.role === 'primary', `the new database changed: ${JSON.stringify(f)}`);
    });

    await step('Promotion fences the old primary first: HMS there stops being ready and cannot write, and will not start again', async () => {
      const t0 = Date.now();
      const r = await promote({ OLD_DB_NAME: OLD, OLD_DB_HOST: dbConf().host, OLD_DB_PORT: String(dbConf().port), OLD_DB_USER: dbConf().user, OLD_DB_PASSWORD: dbConf().password });
      assert(r.code === 0, `promote ${r.code}: ${r.out.slice(-600)}`);
      const ev = JSON.parse(r.stdout);
      Object.assign(evidence, { promotion: ev });
      assert(ev.old_primary_state === 'fenced' && ev.old_fenced.write_refused && ev.epoch === 2, `evidence ${JSON.stringify(ev)}`);
      let notReady = false;
      for (let i = 0; i < 20 && !notReady; i++) { notReady = (await fetch(`${base(PORT_A)}/ready`).then((x) => x.status).catch(() => 503)) === 503; if (!notReady) await sleep(250); }
      assert(notReady, 'HMS on the fenced primary still reports ready');
      const w = await patient(PORT_A, tokenA, 5);
      assert(w.status >= 400, `a write on the fenced primary was accepted: ${w.status}`);
      const [{ n }] = await q(OLD, "SELECT count(*)::int AS n FROM hms_patients WHERE name LIKE $1", [`Recovery drill ${tag}%`]);
      assert(n === 4, `the fenced primary changed (${n} drill patients)`);
      apiA.kill('SIGTERM'); await apiA.exited;
      const again = startApi(OLD, PORT_A);
      const code = await again.exited;
      assert(code !== 0 && /fenced/.test(again.log()), `HMS started on a fenced database: ${again.log().slice(-300)}`);
      // The new primary serves: measured from the start of promotion.
      apiB = startApi(NEW, PORT_B);
      assert(await waitReady(PORT_B, apiB), `API on the new primary: ${apiB.log().slice(-400)}`);
      evidence.rto_seconds = (Date.now() - t0) / 1000;
    });

    await step('On the new primary: old sessions are revoked, pending messages are held, unfinished payments are Unknown, all on the worklist', async () => {
      const old = await call(PORT_B, 'GET', '/auth/me', tokenA);
      assert(old.status === 401, `a session from before the recovery still works: ${old.status}`);
      const fresh = await login(PORT_B, 'receptionist');
      assert((await patient(PORT_B, fresh, 6)).status === 201, 'a new session cannot write on the new primary');
      const [m] = await q(NEW, "SELECT status, next_attempt_at = 'infinity' AS held, last_error FROM hms_interface_messages WHERE external_id = $1", [`B7-${tag}`]);
      assert(m.status === 'Pending' && m.held && /Held after recovery/.test(m.last_error), `message ${JSON.stringify(m)}`);
      const [p] = await q(NEW, "SELECT state FROM hms_payment_intents WHERE patient_id = (SELECT id FROM hms_patients WHERE uhid = $1)", [`B7-${tag}`]);
      assert(p.state === 'Unknown', `payment ${p.state}`);
      const items = await q(NEW, "SELECT kind FROM hms_worklist_items WHERE kind LIKE 'recovery.%' AND status = 'Open'");
      assert(items.some((i) => i.kind === 'recovery.delivery_unknown') && items.some((i) => i.kind === 'recovery.payment_unknown'), `worklist ${JSON.stringify(items)}`);
      const [e] = await q(NEW, 'SELECT old_primary, sessions_revoked, messages_held, payments_unknown FROM hms_recovery_events ORDER BY completed_at DESC LIMIT 1');
      assert(e.old_primary === 'fenced' && e.sessions_revoked >= 1 && e.messages_held >= 1 && e.payments_unknown >= 1, `event ${JSON.stringify(e)}`);
      let blocked = false;
      try { await q(NEW, 'DELETE FROM hms_recovery_events'); } catch { blocked = true; }
      assert(blocked, 'recovery evidence could be deleted');
      let back = false;
      try { await q(OLD, "SET default_transaction_read_only = off; UPDATE hms_writer_fence SET role = 'primary'"); back = true; } catch { /* refused */ }
      assert(!back, 'a fenced database became primary again without a promotion');
    });

    await step('With the old primary unreachable, promotion needs recorded isolation evidence, and keeps it', async () => {
      apiB.kill('SIGTERM'); await apiB.exited; apiB = null;
      const r = await promote({ OLD_PRIMARY_ISOLATION: `Drill ${tag}: old region network isolated, change CHG-0001 (synthetic)` });
      assert(r.code === 0, `isolated promotion ${r.out.slice(-300)}`);
      const ev = JSON.parse(r.stdout);
      assert(ev.old_primary_state === 'isolated' && ev.epoch === 3 && /CHG-0001/.test(ev.isolation_reference), `evidence ${JSON.stringify(ev)}`);
      const none = await promote({});
      assert(none.code === 2 && /another writer may still be running/.test(none.out), 'promotion without any old-primary evidence was accepted');
      fs.writeFileSync(path.join(ART, `b7-recovery-drill-${tag}.json`), JSON.stringify(evidence, null, 2));
      console.log(`  drill: RPO ${evidence.rpo_seconds}s (${evidence.writes_on_primary - evidence.writes_in_copy} writes in the window), RTO ${evidence.rto_seconds}s`);
    });
  } finally {
    for (const c of [apiA, apiB]) if (c && c.exitCode === null) { c.kill('SIGTERM'); await c.exited; }
    for (const db of [OLD, NEW]) await dockerPsql('postgres', `DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
  }
  done();
  process.exit();
})();
