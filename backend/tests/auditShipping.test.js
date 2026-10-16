const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { signManifest } = require('../services/auditKeys.cts');
const { CHAINS } = require('../utils/auditSealer');
const shipper = require('../utils/auditShipper');
const scope = crypto.randomUUID();
const key = crypto.randomBytes(32).toString('hex');
process.env.AUDIT_WORM_BUCKET = 'isolated-audit-unit-fixture';
process.env.AUDIT_WORM_PREFIX = 'isolated-hospital';
process.env.AUDIT_WORM_LOCK_MODE = 'COMPLIANCE';
process.env.AUDIT_CHECKPOINT_KEY = key;
delete process.env.AUDIT_CHECKPOINT_KEYRING_FILE;
delete process.env.AUDIT_CHECKPOINT_SCOPE;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-audit-shipping-test-'));
  const file = `audit-checkpoint-${crypto.randomUUID()}.json`;
  const bytes = Buffer.from(JSON.stringify(signManifest(CHAINS.map(chain => ({ chain, seq: 0, hash: '0'.repeat(64) })), key, new Date(), scope)));
  fs.writeFileSync(path.join(dir, file), bytes);
  const pending = { id: crypto.randomUUID(), file_name: file, sha256: digest(bytes) };
  const commands = [];
  const updates = [];
  const retain = new Date(Date.now() + 86400000);
  const object = { VersionId: 'immutable-version', ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: retain, Metadata: { sha256: pending.sha256 }, ContentLength: bytes.length };
  const db = { query: async (sql, options) => {
    if (sql.includes('audit.checkpoint_identity')) return [{ scope_id: scope }];
    if (sql.startsWith('SELECT * FROM hms_audit_checkpoint_shipments')) return [pending];
    if (sql.startsWith('SELECT file_name')) return [];
    if (sql.startsWith('UPDATE')) { updates.push({ sql, values: options.replacements }); return []; }
    throw new Error('Unexpected database operation');
  } };
  const transport = { send: async command => {
    const name = command.constructor.name;
    commands.push({ name, input: command.input });
    if (name === 'PutObjectCommand') return { VersionId: object.VersionId };
    if (name === 'HeadObjectCommand') return { ...object };
    if (name === 'GetObjectCommand') return { ...object, Body: { transformToByteArray: async () => bytes } };
    if (name === 'ListObjectsV2Command') return { Contents: [{ Key: `${shipper.prefix()}${file}` }], IsTruncated: false };
    throw new Error('Unexpected storage operation');
  } };
  return { dir, file, bytes, pending, object, db, transport, updates, commands, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('shipping does not acknowledge missing versions, false checksums, expired locks or changed readback', async () => {
  const cases = [
    ['PutObjectCommand', result => ({ ...result, VersionId: undefined })],
    ['HeadObjectCommand', result => ({ ...result, VersionId: 'different-version' })],
    ['HeadObjectCommand', result => ({ ...result, Metadata: { sha256: '0'.repeat(64) } })],
    ['HeadObjectCommand', result => ({ ...result, ObjectLockMode: 'GOVERNANCE' })],
    ['HeadObjectCommand', result => ({ ...result, ObjectLockRetainUntilDate: new Date(0) })],
    ['GetObjectCommand', result => ({ ...result, VersionId: 'different-version' })],
    ['GetObjectCommand', result => ({ ...result, Body: { transformToByteArray: async () => Buffer.from('corrupt') } })],
    ['GetObjectCommand', result => ({ ...result, ObjectLockRetainUntilDate: new Date(Date.now() + 10000) })],
  ];
  for (const [kind, alter] of cases) {
    const f = fixture();
    try {
      const transport = { send: async command => {
        const result = await f.transport.send(command);
        return command.constructor.name === kind ? alter(result) : result;
      } };
      assert.equal((await shipper.shipPending(f.db, f.dir, { transport })).shipped, 0, kind);
      assert.equal(f.updates.length, 1);
      assert.ok(f.updates[0].sql.includes('last_error = :e'));
      assert.ok(f.updates[0].values.e.length > 0);
      assert.ok(!f.updates.some(update => update.sql.includes('shipped_at = now()')));
    } finally { f.cleanup(); }
  }
});

test('changed local bytes never reach the storage transport', async () => {
  const f = fixture();
  try {
    fs.appendFileSync(path.join(f.dir, f.file), 'tampering');
    assert.equal((await shipper.shipPending(f.db, f.dir, { transport: f.transport })).shipped, 0);
    assert.equal(f.commands.length, 0);
  } finally { f.cleanup(); }
});

test('an unknown remote object is pinned before its body is fetched', async () => {
  const f = fixture();
  try {
    assert.deepEqual((await shipper.checkRemote(f.db, { transport: f.transport })).problems, []);
    const get = f.commands.find(command => command.name === 'GetObjectCommand');
    assert.equal(get.input.VersionId, 'immutable-version');
  } finally { f.cleanup(); }
});

test('an unversioned remote object and a substituted pinned body fail verification', async () => {
  for (const kind of ['HeadObjectCommand', 'GetObjectCommand']) {
    const f = fixture();
    try {
      const transport = { send: async command => {
        const result = await f.transport.send(command);
        return command.constructor.name === kind ? { ...result, VersionId: kind === 'HeadObjectCommand' ? 'null' : 'substituted' } : result;
      } };
      const result = await shipper.checkRemote(f.db, { transport });
      assert.ok(result.problems.some(problem => ['audit.checkpoint_unversioned', 'audit.checkpoint_invalid'].includes(problem.kind)));
    } finally { f.cleanup(); }
  }
});

test('inventory pagination cannot silently truncate or loop', async () => {
  const f = fixture();
  try {
    const result = await shipper.checkRemote(f.db, { transport: { send: async () => ({ Contents: [], IsTruncated: true }) } });
    assert.ok(result.problems.some(problem => problem.kind === 'audit.worm_unreachable'));
  } finally { f.cleanup(); }
});

test('unavailable hospital identity prevents any remote storage query', async () => {
  const f = fixture();
  try {
    const result = await shipper.checkRemote({ query: async () => [] }, { transport: f.transport });
    assert.ok(result.problems.some(problem => problem.kind === 'audit.scope_unavailable'));
    assert.equal(f.commands.length, 0);
  } finally { f.cleanup(); }
});
