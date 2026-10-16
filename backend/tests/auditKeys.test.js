const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseKeyring, loadKeyMaterial, signManifest, scopeForDatabase } = require('../services/auditKeys.cts');
const { validateCheckpoint } = require('../utils/auditCheckpoint');

const chains = ['audit.row_changes', 'audit.access_events', 'public.hms_audit_logs'];
const heads = chains.map(chain => ({ chain, seq: 1, hash: 'a'.repeat(64) }));
const scope = crypto.randomUUID();
const before = new Date('2026-10-14T12:00:00Z');
const after = new Date('2026-10-16T12:00:00Z');
function ring(active = 'b') {
  return {
    version: 1, active_key_id: active, legacy_key_id: 'a',
    keys: [
      { id: 'a', secret: 'private-old-test-key-'.repeat(4), not_before: '2026-01-01T00:00:00Z', sign_until: '2026-10-15T00:00:00Z' },
      { id: 'b', secret: 'private-new-test-key-'.repeat(4), not_before: '2026-10-15T00:00:00Z', sign_until: null },
    ],
  };
}

test('rotation verifies unchanged historical bytes and current signatures with distinct keys', () => {
  const old = JSON.stringify(signManifest(heads, ring('a'), before, scope));
  const current = signManifest(heads, ring(), after, scope);
  assert.deepEqual(validateCheckpoint(JSON.parse(old), ring(), chains, after, scope), []);
  assert.deepEqual(validateCheckpoint(current, ring(), chains, after, scope), []);
  assert.equal(JSON.stringify(JSON.parse(old)), old, 'historical checkpoint was rewritten');
  assert.equal(JSON.parse(old).key_id, 'a');
  assert.equal(current.key_id, 'b');
  assert.ok(validateCheckpoint(JSON.parse(old), { ...ring(), legacy_key_id: null, keys: ring().keys.slice(1) }, chains, after, scope).length);
});

test('legacy proofs use only the explicitly retained legacy key', () => {
  const body = { created_at: before.toISOString(), heads };
  const proof = { ...body, signature: crypto.createHmac('sha256', ring().keys[0].secret).update(JSON.stringify(body)).digest('hex') };
  assert.deepEqual(validateCheckpoint(proof, ring(), chains, after, scope), []);
  assert.ok(validateCheckpoint(proof, { ...ring(), legacy_key_id: null }, chains, after, scope).length);
  assert.ok(validateCheckpoint(proof, { ...ring(), legacy_key_id: 'b' }, chains, after, scope).length);
});

test('retired and not-yet-active keys cannot sign new checkpoints', () => {
  assert.throws(() => signManifest(heads, ring('a'), after, scope), /interval/);
  assert.throws(() => signManifest(heads, ring('b'), before, scope), /interval/);
  assert.throws(() => signManifest(heads, ring('b'), new Date('invalid'), scope), /time/);
});

test('scope, key ID, unsupported schemas and content tampering fail closed', () => {
  const proof = signManifest(heads, ring(), after, scope);
  for (const changed of [
    { ...proof, scope: crypto.randomUUID() }, { ...proof, key_id: 'unknown' },
    { ...proof, schema_version: 3 }, { ...proof, created_at: before.toISOString() },
    { ...proof, heads: heads.slice(0, 1) },
  ]) assert.ok(validateCheckpoint(changed, ring(), chains, after, scope).length);
  assert.ok(validateCheckpoint(proof, ring(), chains, after, crypto.randomUUID()).length);
  assert.throws(() => signManifest(heads, ring(), after, ''), /identity/);
});

test('keyrings reject duplicates, ambiguous legacy references and weak or invalid entries', () => {
  for (const changed of [
    { ...ring(), version: 2 }, { ...ring(), keys: [...ring().keys, ring().keys[0]] },
    { ...ring(), active_key_id: 'missing' }, { ...ring(), legacy_key_id: 'missing' },
    { ...ring(), keys: [{ ...ring().keys[0], secret: 'weak' }] },
    { ...ring(), keys: [{ ...ring().keys[0], sign_until: '2025-01-01T00:00:00Z' }] },
  ]) assert.throws(() => parseKeyring(changed));
});

test('keyring loading accepts private files and refuses public files, directories and symlinks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-audit-key-test-'));
  try {
    const file = path.join(dir, 'keys.json');
    fs.writeFileSync(file, JSON.stringify(ring()), { mode: 0o600 });
    assert.equal(loadKeyMaterial({ AUDIT_CHECKPOINT_KEYRING_FILE: file }).active_key_id, 'b');
    fs.chmodSync(file, 0o644);
    assert.throws(() => loadKeyMaterial({ AUDIT_CHECKPOINT_KEYRING_FILE: file }), /private/);
    fs.symlinkSync(file, path.join(dir, 'link'));
    assert.throws(() => loadKeyMaterial({ AUDIT_CHECKPOINT_KEYRING_FILE: path.join(dir, 'link') }));
    assert.throws(() => loadKeyMaterial({ AUDIT_CHECKPOINT_KEYRING_FILE: dir }), /private/);
    assert.throws(() => loadKeyMaterial({ AUDIT_CHECKPOINT_KEY: 'weak' }), /32/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('audit identity is the immutable database sentinel, independent of its database name', async () => {
  const saved = process.env.AUDIT_CHECKPOINT_SCOPE;
  delete process.env.AUDIT_CHECKPOINT_SCOPE;
  const query = async () => [{ scope_id: scope }];
  try {
    assert.equal(await scopeForDatabase({ query }), scope);
    await assert.rejects(scopeForDatabase({ query: async () => [] }), /unavailable/);
    await assert.rejects(scopeForDatabase({ query: async () => [{ scope_id: '-'.repeat(36) }] }), /unavailable/);
    process.env.AUDIT_CHECKPOINT_SCOPE = crypto.randomUUID();
    await assert.rejects(scopeForDatabase({ query }), /does not match/);
  } finally {
    if (saved === undefined) delete process.env.AUDIT_CHECKPOINT_SCOPE;
    else process.env.AUDIT_CHECKPOINT_SCOPE = saved;
  }
});
