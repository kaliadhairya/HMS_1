// Deterministic counterexamples against unchanged Phase 6 source. These are
// source-level reproductions with controlled dependencies, not DB/S3 drills.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { spawnSync } = require('node:child_process');
const source = path.resolve(process.argv[2] || '../HMS_1-phase6-review');
function load(file, dependencies, env = {}) {
  const module = { exports: {} };
  const code = fs.readFileSync(path.join(source, file), 'utf8');
  const requireStub = name => Object.hasOwn(dependencies, name) ? dependencies[name] : require(name);
  vm.runInNewContext('(function(require,module,exports){\n' + code + '\n})',
    { Buffer, console, process: { env }, setInterval, Date }, { filename: file })(requireStub, module, module.exports);
  return module.exports;
}
function deviceHarness({ held = false } = {}) {
  const messages = require(path.join(source, 'backend/utils/deviceMessages'));
  const calls = [], reports = [], settlements = [];
  const contract = { system: 'analyzer:review', status: 'Active', kind: 'analyzer', protocol: 'hl7v2',
    service_user_id: 42, allowed_hosts: [], code_map: {
      X: { lab_code_system: 'TEST', lab_code: 'X', method: 'TEST' },
      Y: { lab_code_system: 'TEST', lab_code: 'Y', method: 'TEST' },
    } };
  const sequelize = {
    query: async (sql, options) => {
      if (sql.includes('FROM hms_device_contracts')) return [contract];
      if (sql.includes('FROM hms_lab_specimens')) return [{ id: 1, patient_id: 1 }];
      if (sql.includes('FROM hms_patients')) return [{ id: 1, uhid: 'REVIEW-PATIENT' }];
      if (sql.includes('FROM hms_lab_specimen_links')) return [{ id: options.replacements.code === 'X' ? 1 : 2 }];
      if (sql.includes('FROM hms_users')) return [{ id: 42, role: 'lab_technician', is_active: 1 }];
      throw new Error('Unexpected review SQL: ' + sql);
    }, transaction: async fn => fn({ savepoint: true }),
  };
  const seen = new Map();
  const Analyzer = { ingest: async body => {
    calls.push(body);
    const fingerprint = JSON.stringify(body);
    if (seen.has(body.message_id) && seen.get(body.message_id) !== fingerprint) throw new Error('MESSAGE_ID_REUSED');
    seen.set(body.message_id, fingerprint);
    return held ? { provisional: true, reconciliation_id: 'pending', failure_code: 'UNIT_MISMATCH' }
      : { provisional: true, reconciliation_id: 'matched', result: { id: 'result' } };
  } };
  const api = load('backend/services/devices.js', {
    sequelize: { QueryTypes: { SELECT: 'SELECT' } }, '../models/db': { sequelize },
    '../utils/deviceMessages': messages, './interfaces': {
      receive: async () => ({ message: { id: 'message', status: 'Received' }, duplicate: false }),
      settle: async (_id, status) => settlements.push(status),
    }, './worklist': { report: async item => reports.push(item) },
    './laboratoryAnalyzer': Analyzer, '../utils/auditContext': { storage: new AsyncLocalStorage() },
  });
  return { api, calls, reports, settlements };
}
const raw = many => ['MSH|^~\\&|TEST|LAB|HMS|HOSP|20261014120000||ORU^R01|REVIEW-1|P|2.5.1',
  'PID|1||REVIEW-PATIENT', 'OBR|1||ACCESSION|X', 'OBX|1|NM|X^Test||5|TEST-U||N|||F',
  ...(many ? ['OBR|2||ACCESSION|Y', 'OBX|1|NM|Y^Test||6|TEST-U||N|||F'] : [])].join('\r');
function wormHarness(incomplete) {
  const now = new Date();
  const key = 'SYNTHETIC-REVIEW-KEY';
  const body = { created_at: now.toISOString(), heads: [{ chain: 'audit.row_changes', seq: 1, hash: 'a'.repeat(64) }] };
  const checkpoint = { ...body, signature: crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex') };
  class Command { constructor(input) { this.input = input; } }
  class ListObjectsV2Command extends Command {}
  class GetObjectCommand extends Command {}
  class S3Client { async send(command) {
    if (command instanceof ListObjectsV2Command) return { Contents: incomplete ? [{ Key: 'review/audit-checkpoint-review.json' }] : [] };
    if (command instanceof GetObjectCommand) return { ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: new Date(now.getTime() + 86400000), Body: { transformToString: async () => JSON.stringify(checkpoint) } };
    throw new Error('Unexpected S3 command');
  } }
  const sequelize = { query: async sql => sql.includes('SELECT encode') ? [{ hash: 'a'.repeat(64) }] : [] };
  const api = load('backend/utils/auditShipper.js', {
    sequelize: { QueryTypes: { SELECT: 'SELECT' } }, '@aws-sdk/client-s3': { S3Client, ListObjectsV2Command, GetObjectCommand,
      PutObjectCommand: Command, HeadObjectCommand: Command },
    './auditSealer': { CHAINS: ['audit.row_changes', 'audit.access_events', 'public.hms_audit_logs'] },
    '../services/worklist': { report: async () => {} },
  }, { AUDIT_WORM_BUCKET: 'synthetic-review', DB_NAME: 'review', AUDIT_CHECKPOINT_KEY: key });
  return { api, sequelize, now };
}
(async () => {
  const observations = [];
  const held = deviceHarness({ held: true });
  const h = await held.api.receive('analyzer:review', raw(false), {}, {});
  assert.equal(h.status, 'Processed'); assert.match(h.ack, /MSA\|AA\|/); assert.equal(held.reports.length, 0);
  observations.push({ id: 'P6-R01', confirmed: true, actual: 'Held Phase 4 result becomes Processed/AA with no interface failure item' });
  const multiple = deviceHarness();
  const m = await multiple.api.receive('analyzer:review', raw(true), {}, {});
  assert.equal(multiple.calls.length, 2); assert.equal(multiple.calls[0].message_id, multiple.calls[1].message_id);
  assert.equal(m.status, 'Unmatched'); assert.ok(m.problems.some(p => p.includes('MESSAGE_ID_REUSED')));
  observations.push({ id: 'P6-R02', confirmed: true, actual: 'Two OBR groups reusing OBX-1 create the same Phase 4 message ID' });
  for (const [incomplete, id, description] of [[false, 'P6-R04', 'Empty remote store and empty queue return no problems'],
    [true, 'P6-R05', 'Signed checkpoint containing only one of three chains returns no problems']]) {
    const w = wormHarness(incomplete); const r = await w.api.checkRemote(w.sequelize, { now: w.now });
    assert.equal(r.problems.length, 0); assert.equal(r.checked, incomplete ? 1 : 0);
    observations.push({ id, confirmed: true, actual: description });
  }
  const text = fs.readFileSync(path.join(source, 'docker-compose.yml'), 'utf8');
  const archive = text.match(/- archive_command=(.*)/)[1];
  const os = require('node:os'); const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-p7-archive-'));
  try {
    fs.mkdirSync(path.join(temp, 'archive')); fs.writeFileSync(path.join(temp, 'wal'), 'SYNTHETIC WAL');
    const cmd = archive.replaceAll('/wal-archive', path.join(temp, 'archive')).replaceAll('%p', path.join(temp, 'wal')).replaceAll('%f', 'REVIEW_WAL');
    const first = spawnSync('sh', ['-c', cmd]); const retry = spawnSync('sh', ['-c', cmd]);
    assert.equal(first.status, 0); assert.equal(retry.status, 1);
    observations.push({ id: 'P6-R07', confirmed: true, actual: 'Archive retry for an already stored identical segment returns failure' });
  } finally { fs.rmSync(temp, { recursive: true }); }
  console.log(JSON.stringify({ source, scope: 'Source-level counterexamples; controlled dependencies, not live DB/S3 acceptance', observations }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
