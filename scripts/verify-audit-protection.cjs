#!/usr/bin/env node
// Local engineering evidence only: disposable PostgreSQL copies and ephemeral
// MinIO Object Lock. This does not establish an independently administered
// production storage boundary or a regional recovery service level.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const backend = path.join(root, 'backend');
const { Client } = require(path.join(backend, 'node_modules/pg'));
const S3 = require(path.join(backend, 'node_modules/@aws-sdk/client-s3'));
const source = process.env.DB_NAME;
if (!/^(?:hms_p4_final_|hms_verify_final_)[a-z0-9_]+$/.test(source || '') || /claude/.test(source)) {
  throw new Error('An owned disposable source database is required');
}
const stamp = Date.now();
const database = `hms_verify_final_audit_${stamp}`;
const restored = `hms_verify_final_audit_restore_${stamp}`;
const container = `hms-clinical-final-audit-${stamp}`;
const runDir = path.join(os.homedir(), '.local/state/hms-clinical-final/audit', String(stamp));
fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
const Bucket = `hms-audit-${stamp}`;
const Prefix = `hospital-${stamp}/`;
const endpoint = 'http://127.0.0.1:19064';
const rootUser = `fixture${stamp}`;
const rootPassword = crypto.randomBytes(32).toString('hex');
const image = 'minio/minio:RELEASE.2025-09-07T16-13-09Z';
const results = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const client = credentials => new S3.S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
const owner = client({ accessKeyId: rootUser, secretAccessKey: rootPassword });
let store;
let sequelize;
let started = false;
let probeRole;
let api;
const admin = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: 'postgres' });
const command = (executable, args, env = process.env) => {
  const result = spawnSync(executable, args, { env, cwd: backend, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) {
    const log = path.join(runDir, `failed-command-${crypto.randomUUID()}.log`);
    fs.writeFileSync(log, `${result.stdout || ''}\n${result.stderr || ''}\n${result.error?.code || ''}`, { mode: 0o600 });
    throw new Error(`${path.basename(executable)} failed (${result.status}); protected details: ${log}`);
  }
  return result.stdout;
};
async function step(title, fn) {
  const start = Date.now();
  try { await fn(); } catch (error) {
    results.push({ title, ok: false, error: error.message, duration_ms: Date.now() - start });
    throw error;
  }
  results.push({ title, ok: true, duration_ms: Date.now() - start });
  console.log(`PASS ${title}`);
}
async function put(Key, body) {
  const Body = typeof body === 'string' ? body : JSON.stringify(body);
  return store.send(new S3.PutObjectCommand({ Bucket, Key, Body, Metadata: { sha256: sha(Body) }, ChecksumSHA256: crypto.createHash('sha256').update(Body).digest('base64') }));
}
async function main() {
  await admin.connect();
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE "${source}"`);
  process.env.DB_NAME = database;
  process.env.AUDIT_WORM_PREFIX = Prefix.slice(0, -1);
  process.env.AUDIT_WORM_BUCKET = Bucket;
  process.env.AUDIT_WORM_ENDPOINT = endpoint;
  process.env.AUDIT_WORM_LOCK_MODE = 'COMPLIANCE';
  delete process.env.AUDIT_CHECKPOINT_SCOPE;
  fs.writeFileSync(path.join(runDir, 'minio.env'), `MINIO_ROOT_USER=${rootUser}\nMINIO_ROOT_PASSWORD=${rootPassword}\nMC_HOST_fixture=http://${rootUser}:${rootPassword}@127.0.0.1:9000\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(runDir, 'shipper-policy.json'), JSON.stringify({ Version: '2012-10-17', Statement: [
    { Effect: 'Allow', Action: ['s3:ListBucket', 's3:ListBucketVersions'], Resource: [`arn:aws:s3:::${Bucket}`], Condition: { StringLike: { 's3:prefix': [`${Prefix}*`] } } },
    { Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject', 's3:GetObjectVersion', 's3:GetObjectRetention'], Resource: [`arn:aws:s3:::${Bucket}/${Prefix}*`] },
  ] }), { mode: 0o600 });
  command('docker', ['run', '-d', '--rm', '--name', container, '--env-file', path.join(runDir, 'minio.env'), '-p', '127.0.0.1:19064:9000', '--tmpfs', '/data:rw,size=512m,mode=0700', '--mount', `type=bind,src=${runDir},dst=/verification,readonly`, image, 'server', '/data', '--address', ':9000']);
  started = true;
  let ready = false;
  for (let i = 0; i < 40; i++) {
    try { const result = await fetch(`${endpoint}/minio/health/ready`); if (result.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'isolated object store did not become ready');
  await owner.send(new S3.CreateBucketCommand({ Bucket, ObjectLockEnabledForBucket: true }));
  await owner.send(new S3.PutObjectLockConfigurationCommand({ Bucket, ObjectLockConfiguration: { ObjectLockEnabled: 'Enabled', Rule: { DefaultRetention: { Mode: 'COMPLIANCE', Days: 1 } } } }));
  // mc generates credentials; capture them directly into private memory/file,
  // rather than passing a password on any command line or printing its output.
  const created = command('docker', ['exec', container, 'mc', '--json', 'admin', 'accesskey', 'create', 'fixture/', '--policy', '/verification/shipper-policy.json']);
  const credential = JSON.parse(created.trim().split('\n').pop());
  assert.ok(credential.accessKey && credential.secretKey, 'restricted shipper credentials were not created');
  process.env.AUDIT_WORM_ACCESS_KEY = credential.accessKey;
  process.env.AUDIT_WORM_SECRET_KEY = credential.secretKey;
  process.env.AUDIT_WORM_REGION = 'us-east-1';
  store = client({ accessKeyId: credential.accessKey, secretAccessKey: credential.secretKey });
  fs.writeFileSync(path.join(runDir, 'shipper.env'), `AUDIT_WORM_ACCESS_KEY=${credential.accessKey}\nAUDIT_WORM_SECRET_KEY=${credential.secretKey}\n`, { mode: 0o600 });
  ({ sequelize } = require(path.join(backend, 'models/db')));
  require(path.join(backend, 'utils/auditContext')).bindAuditActor(sequelize);
  const seal = require(path.join(backend, 'utils/auditSealer'));
  const ship = require(path.join(backend, 'utils/auditShipper'));
  const { loadKeyMaterial, signManifest, scopeForDatabase } = require(path.join(backend, 'services/auditKeys.cts'));
  // Delivery bookkeeping belongs to this new isolated test database only.
  await sequelize.query('TRUNCATE hms_audit_checkpoint_shipments');
  const scope = await scopeForDatabase(sequelize);
  const checkpoints = path.join(runDir, 'checkpoints');
  const keyFile = path.join(runDir, 'signing-keys.json');
  const ring = {
    version: 1, active_key_id: 'initial', legacy_key_id: 'initial', keys: [
      { id: 'initial', secret: crypto.randomBytes(32).toString('hex'), not_before: new Date(Date.now() - 3600000).toISOString(), sign_until: null },
      { id: 'rotated', secret: crypto.randomBytes(32).toString('hex'), not_before: new Date(Date.now() - 3600000).toISOString(), sign_until: null },
    ],
  };
  const writeRing = () => {
    fs.writeFileSync(`${keyFile}.next`, JSON.stringify(ring), { mode: 0o600 });
    fs.renameSync(`${keyFile}.next`, keyFile);
  };
  writeRing();
  process.env.AUDIT_CHECKPOINT_KEYRING_FILE = keyFile;
  let first, firstBytes, firstShipment;
  await step('an empty protected inventory fails closed', async () => {
    const result = await ship.checkRemote(sequelize, { transport: store });
    assert.ok(result.problems.some(p => p.kind === 'audit.checkpoint_missing'));
  });
  await step('complete checkpoints are read back by immutable version with checksum and retention', async () => {
    await seal.sealOnce(sequelize);
    first = await seal.writeCheckpoint(sequelize, checkpoints, loadKeyMaterial());
    firstBytes = fs.readFileSync(first);
    await ship.queue(sequelize, first);
    const result = await ship.shipPending(sequelize, checkpoints, { transport: store });
    [firstShipment] = await sequelize.query('SELECT * FROM hms_audit_checkpoint_shipments WHERE file_name=:name', { type: 'SELECT', replacements: { name: path.basename(first) } });
    assert.equal(result.shipped, 1, firstShipment.last_error || 'Checkpoint was not shipped');
    assert.ok(firstShipment.remote_version);
    assert.equal(firstShipment.lock_mode, 'COMPLIANCE');
    assert.deepEqual((await ship.checkRemote(sequelize, { transport: store })).problems, []);
  });
  await step('restricted shipper cannot delete versions, change retention or write outside its hospital prefix', async () => {
    await assert.rejects(store.send(new S3.DeleteObjectCommand({ Bucket, Key: firstShipment.remote_key, VersionId: firstShipment.remote_version })));
    await assert.rejects(store.send(new S3.PutObjectRetentionCommand({ Bucket, Key: firstShipment.remote_key, VersionId: firstShipment.remote_version, Retention: { Mode: 'COMPLIANCE', RetainUntilDate: new Date(Date.now() + 1000) } })));
    await assert.rejects(store.send(new S3.PutObjectCommand({ Bucket, Key: 'other-hospital/forbidden', Body: 'forbidden' })));
  });
  await step('storage owner cannot remove a retained version and an overwrite preserves the pinned proof', async () => {
    await assert.rejects(owner.send(new S3.DeleteObjectCommand({ Bucket, Key: firstShipment.remote_key, VersionId: firstShipment.remote_version })));
    await put(firstShipment.remote_key, { forged: true });
    const object = await store.send(new S3.GetObjectCommand({ Bucket, Key: firstShipment.remote_key, VersionId: firstShipment.remote_version }));
    assert.equal(sha(await object.Body.transformToByteArray()), sha(firstBytes));
    assert.deepEqual((await ship.checkRemote(sequelize, { transport: store })).problems, []);
  });
  await step('rotation accepts original historical bytes together with the newly active key', async () => {
    ring.keys[0].sign_until = new Date().toISOString();
    ring.active_key_id = 'rotated';
    writeRing();
    await seal.sealOnce(sequelize);
    const next = await seal.writeCheckpoint(sequelize, checkpoints, loadKeyMaterial());
    assert.equal(JSON.parse(fs.readFileSync(next, 'utf8')).key_id, 'rotated');
    assert.equal(JSON.parse(firstBytes).key_id, 'initial');
    await ship.queue(sequelize, next);
    assert.equal((await ship.shipPending(sequelize, checkpoints, { transport: store })).shipped, 1);
    assert.equal(sha(fs.readFileSync(first)), sha(firstBytes));
    assert.deepEqual((await ship.checkRemote(sequelize, { transport: store })).problems, []);
  });
  await step('a real dump and isolated restore retain hospital identity and verify old proofs without re-signing', async () => {
    const backupEnv = { ...process.env, PGHOST: process.env.DB_HOST, PGPORT: process.env.DB_PORT, PGUSER: process.env.DB_USER, PGPASSWORD: process.env.DB_PASSWORD };
    const dump = path.join(runDir, 'audit-recovery.dump');
    const major = Math.floor(Number((await admin.query('SHOW server_version_num')).rows[0].server_version_num) / 10000);
    const binaries = path.join('/usr/lib/postgresql', String(major), 'bin');
    command(path.join(binaries, 'pg_dump'), ['--format=custom', '--file', dump, '--dbname', database], backupEnv);
    fs.chmodSync(dump, 0o600);
    await admin.query(`CREATE DATABASE "${restored}"`);
    command(path.join(binaries, 'pg_restore'), ['--exit-on-error', '--no-owner', '--no-acl', '--dbname', restored, dump], backupEnv);
    const restoredEnv = { ...process.env, DB_NAME: restored };
    const local = command(process.execPath, ['scripts/audit-verify.js', checkpoints], restoredEnv);
    assert.ok(local.includes('PASS: audit chains intact'), 'restored local historical verification did not pass');
    const remote = command(process.execPath, ['-e', `const {sequelize}=require('./models/db'); const s=require('./utils/auditShipper'); s.checkRemote(sequelize).then(r=>{console.log(JSON.stringify(r));if(r.problems.length)process.exitCode=1}).catch(()=>{process.exitCode=1}).finally(()=>sequelize.close());`], restoredEnv);
    assert.deepEqual(JSON.parse(remote.trim().split('\n').pop()).problems, []);
    assert.equal(sha(fs.readFileSync(first)), sha(firstBytes));
  });
  await step('the API worklist enforces ownership, resolution notes and immutable history', async () => {
    const [administrator] = await sequelize.query("SELECT id FROM hms_users WHERE username='admin' AND is_active=1", { type: 'SELECT' });
    assert.ok(administrator, 'Explicit synthetic administrator fixture is required');
    const env = { ...process.env, HMS_WORKER_USER_ID: String(administrator.id), PORT: '5064', HOST: '127.0.0.1', HMS_PROCESS_ROLE: 'api', E2E_API: 'http://127.0.0.1:5064/api', AUDIT_CHECKPOINT_DIR: checkpoints };
    const portProbe = require('node:net').createServer();
    await new Promise((resolve, reject) => { portProbe.once('error', reject); portProbe.listen(5064, '127.0.0.1', () => portProbe.close(resolve)); });
    const log = fs.openSync(path.join(runDir, 'api.log'), 'w', 0o600);
    api = spawn(process.execPath, ['server.js'], { cwd: backend, env, stdio: ['ignore', log, log] });
    fs.closeSync(log);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (api.exitCode !== null) throw new Error('The private API stopped; inspect its protected log');
      try { if ((await fetch(`${env.E2E_API}/ready`, { signal: AbortSignal.timeout(500) })).ok) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.ok(ready, 'The private API did not become ready');
    const output = command(process.execPath, ['../e2e/auditWorm.e2e.js'], env);
    fs.writeFileSync(path.join(runDir, 'auditWorm.log'), output, { mode: 0o600 });
    console.log(output.trim());
    api.kill('SIGTERM');
    await new Promise(resolve => { api.once('exit', resolve); setTimeout(() => api.kill('SIGKILL'), 3000).unref(); });
    api = null;
  });
  await step('unknown keys, missing chain heads and authentic mismatching heads are rejected', async () => {
    const heads = await sequelize.query("SELECT chain, seq::int AS seq, encode(head_hash,'hex') AS hash FROM audit.chain_heads ORDER BY chain", { type: 'SELECT' });
    const clean = heads.map(({ chain, seq, hash }) => ({ chain, seq, hash }));
    const invalid = signManifest(clean.slice(0, 1), loadKeyMaterial(), new Date(), scope);
    await put(`${Prefix}incomplete.json`, invalid);
    const unknown = { ...signManifest(clean, loadKeyMaterial(), new Date(), scope), key_id: 'unavailable-key' };
    await put(`${Prefix}unknown-key.json`, unknown);
    const wrong = clean.map((head, index) => index === 0 ? { ...head, hash: '0'.repeat(64) } : head);
    await put(`${Prefix}mismatch.json`, signManifest(wrong, loadKeyMaterial(), new Date(), scope));
    const result = await ship.checkRemote(sequelize, { transport: store });
    assert.ok(result.problems.some(p => p.kind === 'audit.checkpoint_invalid' && p.key === 'incomplete.json'));
    assert.ok(result.problems.some(p => p.kind === 'audit.checkpoint_invalid' && p.key === 'unknown-key.json'));
    assert.ok(result.problems.some(p => p.kind === 'audit.chain_mismatch'));
  });
  await step('unshipped records, missing pinned objects and stale delivery produce explicit problems', async () => {
    await sequelize.query(`INSERT INTO hms_audit_checkpoint_shipments(file_name,checkpoint_at,sha256,queued_at) VALUES('audit-checkpoint-stuck.json',now()-interval '1 hour',:sha,now()-interval '1 hour')`, { replacements: { sha: '1'.repeat(64) } });
    await sequelize.query(`INSERT INTO hms_audit_checkpoint_shipments(file_name,checkpoint_at,sha256,shipped_at,remote_key,remote_version,lock_mode,retain_until) VALUES('audit-checkpoint-gone.json',now(),:sha,now(),:key,'missing-version','COMPLIANCE',now()+interval '1 day')`, { replacements: { sha: '2'.repeat(64), key: `${Prefix}missing.json` } });
    const result = await ship.checkRemote(sequelize, { transport: store, now: new Date(Date.now() + 600000) });
    for (const kind of ['audit.checkpoint_unshipped', 'audit.checkpoint_missing', 'audit.checkpoint_gap']) assert.ok(result.problems.some(p => p.kind === kind), kind);
  });
  await step('a restricted worker reports once per approved facility and stops after membership revocation', async () => {
    const [worker] = await sequelize.query(`INSERT INTO hms_users(username,password,name,role,is_active) VALUES(:name,'NOT-A-LOGIN','Synthetic audit worker','admin',1) RETURNING id`, { type: 'SELECT', replacements: { name: `audit-worker-${stamp}` } });
    const [facility] = await sequelize.query(`INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,'Synthetic audit facility','UTC') RETURNING id`, { type: 'SELECT', replacements: { code: `AUDIT-${stamp}` } });
    await sequelize.query(`INSERT INTO hms_facility_memberships(user_id,facility_id,granted_by_user_id,reason) VALUES(:user,:facility,:user,'Synthetic isolated audit worker approval')`, { replacements: { user: worker.id, facility: facility.id } });
    probeRole = `hms_audit_probe_${stamp}`;
    const probePassword = crypto.randomBytes(32).toString('hex');
    // A database password is passed as a bind parameter to PostgreSQL's own
    // format(), never interpolated into shell text or placed in tool output.
    const definition = await admin.query("SELECT format('CREATE ROLE %I LOGIN PASSWORD %L NOSUPERUSER NOBYPASSRLS', $1::text, $2::text) AS ddl", [probeRole, probePassword]);
    await admin.query(definition.rows[0].ddl);
    await sequelize.query(`GRANT USAGE ON SCHEMA public,audit TO ${probeRole}; GRANT SELECT ON hms_users,hms_facilities,hms_facility_memberships,hms_worklist_items,hms_audit_checkpoint_shipments,audit.checkpoint_identity,audit.row_changes,audit.access_events,hms_audit_logs TO ${probeRole}; GRANT INSERT,UPDATE ON hms_worklist_items TO ${probeRole}`);
    const code = `const {sequelize}=require('./models/db');require('./utils/auditContext').bindAuditActor(sequelize);require('./utils/auditShipper').checkAndReport(sequelize).then(r=>console.log(JSON.stringify({problems:r.problems.length}))).catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>sequelize.close());`;
    const probeEnv = { ...process.env, DB_USER: probeRole, DB_PASSWORD: probePassword, HMS_WORKER_USER_ID: String(worker.id) };
    command(process.execPath, ['-e', code], probeEnv);
    command(process.execPath, ['-e', code], probeEnv);
    const before = await sequelize.query(`SELECT facility_id,occurrences FROM hms_worklist_items WHERE kind='audit.checkpoint_invalid' AND dedupe_key='incomplete.json' ORDER BY facility_id`, { type: 'SELECT' });
    assert.equal(before.length, 2);
    assert.ok(before.every(row => row.occurrences === 2));
    await sequelize.query(`UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=:user,revocation_reason='Synthetic audit worker membership revocation' WHERE user_id=:user AND facility_id=:facility AND revoked_at IS NULL`, { replacements: { user: worker.id, facility: facility.id } });
    command(process.execPath, ['-e', code], probeEnv);
    const [revoked] = await sequelize.query(`SELECT occurrences FROM hms_worklist_items WHERE kind='audit.checkpoint_invalid' AND dedupe_key='incomplete.json' AND facility_id=:facility`, { type: 'SELECT', replacements: { facility: facility.id } });
    assert.equal(revoked.occurrences, 2, 'revoked facility received worker activity');
    const refused = spawnSync(process.execPath, ['-e', code], { cwd: backend, env: { ...probeEnv, HMS_WORKER_USER_ID: '' }, encoding: 'utf8', timeout: 30000 });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /approved active worker/);
  });
}

main().catch(error => {
  results.push({ title: 'verification failed', ok: false, error: error.message });
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    await new Promise(resolve => { api.once('exit', resolve); setTimeout(() => api.kill('SIGKILL'), 3000).unref(); });
  }
  if (sequelize) await sequelize.close();
  for (const name of [restored, database]) {
    try { await admin.query(`DROP DATABASE IF EXISTS "${name}"`); } catch (error) { console.error(`Owned fixture cleanup failed: ${name}: ${error.code}`); process.exitCode = 1; }
  }
  if (probeRole) await admin.query(`DROP ROLE IF EXISTS "${probeRole}"`).catch(error => { console.error(`Owned probe-role cleanup failed: ${error.code}`); process.exitCode = 1; });
  await admin.end().catch(() => {});
  if (started) {
    try { command('docker', ['stop', container]); } catch (error) { console.error('Owned storage fixture cleanup failed'); process.exitCode = 1; }
  }
  owner.destroy();
  store?.destroy();
  const untracked = command('git', ['ls-files','--full-name','--others','--exclude-standard','-z']).split('\0').filter(Boolean).map(file => ({ file, sha256: sha(fs.readFileSync(path.join(root,file))) }));
  const report = { candidate: command('git', ['rev-parse', 'HEAD']).trim(), tracked_diff_sha256: sha(command('git', ['diff', '--binary'])), untracked, source_database: source, postgres_restore: 'pg_dump/pg_restore', fixture: image, synthetic: true, results };
  fs.writeFileSync(path.join(runDir, 'verification.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`Evidence: ${path.join(runDir, 'verification.json')}`);
});
