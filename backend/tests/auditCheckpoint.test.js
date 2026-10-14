const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { validateCheckpoint, lockProblems } = require('../utils/auditCheckpoint');
const chains = ['audit.row_changes', 'audit.access_events', 'public.hms_audit_logs'];
const key = crypto.randomBytes(32);
const now = new Date('2026-10-14T12:00:00Z');
const heads = () => chains.map((chain) => ({ chain, seq: 1, hash: 'a'.repeat(64) }));
function signed(values = heads(), at = '2026-10-14T11:59:00Z') {
  const body = { created_at: at, heads: values };
  return { ...body, signature: crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex') };
}
test('a complete signed historical manifest remains valid', () => {
  assert.deepEqual(validateCheckpoint(signed(), key, chains, now), []);
  assert.deepEqual(validateCheckpoint(signed(chains.map((chain) => ({ chain, seq: 0, hash: '0'.repeat(64) }))), key, chains, now), []);
});
test('an authentic signature does not make an omitted chain acceptable', () => {
  assert.ok(validateCheckpoint(signed(heads().slice(0, 1)), key, chains, now).some((p) => p.includes('Missing chain')));
});
test('duplicate and unrecognized heads are rejected', () => {
  assert.ok(validateCheckpoint(signed([...heads(), heads()[0]]), key, chains, now).length);
  assert.ok(validateCheckpoint(signed([...heads(), { chain: 'untrusted.sql', seq: 1, hash: 'b'.repeat(64) }]), key, chains, now).length);
});
test('bad signatures, hashes and unsafe sequences cannot be treated as verified', () => {
  const forged = signed(); forged.signature = 'z'.repeat(64);
  assert.ok(validateCheckpoint(forged, key, chains, now).length);
  for (const change of [{ seq: -1 }, { seq: 1.5 }, { seq: 0, hash: 'a'.repeat(64) }, { hash: 'bad' }]) {
    const h = heads(); Object.assign(h[0], change);
    assert.ok(validateCheckpoint(signed(h), key, chains, now).length);
  }
});
test('future timestamps and missing verification material fail closed', () => {
  assert.ok(validateCheckpoint(signed(heads(), '2026-10-14T12:01:00Z'), key, chains, now).length);
  assert.ok(validateCheckpoint(signed(), null, chains, now).length);
});
test('expired or weaker object retention cannot establish protection', () => {
  assert.deepEqual(lockProblems({ ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: '2026-10-15T12:00:00Z' }, now), []);
  assert.ok(lockProblems({ ObjectLockMode: 'COMPLIANCE', ObjectLockRetainUntilDate: now }, now).length);
  assert.ok(lockProblems({ ObjectLockMode: 'GOVERNANCE', ObjectLockRetainUntilDate: '2026-10-15T12:00:00Z' }, now).length);
});
