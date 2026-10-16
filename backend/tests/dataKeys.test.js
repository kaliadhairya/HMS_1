const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const keys = require('../services/dataKeys.cts');

const K1 = crypto.randomBytes(32).toString('hex');
const K2 = crypto.randomBytes(32).toString('hex');
function withEnv(env, fn) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return fn(); } finally { for (const k of Object.keys(saved)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
const legacyCbc = (text, key) => {
  const iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv('aes-256-cbc', key, iv);
  return `${iv.toString('hex')}:${Buffer.concat([c.update(text, 'utf8'), c.final()]).toString('hex')}`;
};

test('values carry their key ID and only open for the purpose they were written for', () => withEnv({ HMS_DATA_KEYS: `k1:${K1}`, HMS_DATA_KEY_ACTIVE: undefined }, () => {
  const v = keys.encryptText('123412341234', 'patient.aadhaar');
  assert.match(v, /^hk2:k1:/);
  assert.equal(keys.decryptText(v, 'patient.aadhaar'), '123412341234');
  assert.throws(() => keys.decryptText(v, 'abdm.sms-text'), { code: 'DATA_INTEGRITY' });
  const parts = v.split(':'); parts[4] = parts[4].slice(0, -2) + (parts[4].endsWith('AA') ? 'BB' : 'AA');
  assert.throws(() => keys.decryptText(parts.join(':'), 'patient.aadhaar'), { code: 'DATA_INTEGRITY' });
}));

test('rotation: the new key writes, the old key still reads until removed', () => {
  const old = withEnv({ HMS_DATA_KEYS: `k1:${K1}`, HMS_DATA_KEY_ACTIVE: undefined }, () => keys.encryptText('secret', 'p'));
  withEnv({ HMS_DATA_KEYS: `k2:${K2},k1:${K1}`, HMS_DATA_KEY_ACTIVE: undefined }, () => {
    assert.equal(keys.decryptText(old, 'p'), 'secret');
    assert.equal(keys.needsRekey(old), true);
    const fresh = keys.encryptText('secret', 'p');
    assert.match(fresh, /^hk2:k2:/);
    assert.equal(keys.needsRekey(fresh), false);
  });
  withEnv({ HMS_DATA_KEYS: `k2:${K2}`, HMS_DATA_KEY_ACTIVE: undefined }, () => {
    assert.throws(() => keys.decryptText(old, 'p'), { code: 'DATA_KEY_MISSING' });
  });
});

test('values written by the earlier AES-CBC code still open, from either earlier key', () => withEnv({ HMS_DATA_KEYS: `k1:${K1}`, ENCRYPTION_KEY: 'a-general-key-of-32-characters!!', AADHAAR_ENCRYPTION_KEY: K2 }, () => {
  const general = legacyCbc('otp text', Buffer.from('a-general-key-of-32-characters!!', 'utf8'));
  const aadhaar = legacyCbc('987698769876', Buffer.from(K2, 'hex'));
  assert.equal(keys.decryptText(general, 'abdm.sms-text'), 'otp text');
  assert.equal(keys.decryptText(aadhaar, 'patient.aadhaar'), '987698769876');
  assert.equal(keys.needsRekey(aadhaar), true);
}));

test('documents: encrypted, bound to their record, and checked when opened', () => withEnv({ HMS_DATA_KEYS: `k1:${K1}` }, () => {
  const pdf = Buffer.from('%PDF-1.4 synthetic');
  const stored = keys.encryptBlob(pdf, 'patient-document:7:abc');
  assert.equal(stored.includes(Buffer.from('synthetic')), false);
  assert.deepEqual(keys.decryptBlob(stored, 'patient-document:7:abc').plain, pdf);
  assert.throws(() => keys.decryptBlob(stored, 'patient-document:8:abc'), { code: 'DATA_INTEGRITY' });
}));

test('production refuses to run without keys; bad key lists are refused', () => {
  withEnv({ HMS_DATA_KEYS: undefined, NODE_ENV: 'production' }, () => assert.throws(() => keys.assertDataKeys(), /HMS_DATA_KEYS is not set/));
  withEnv({ HMS_DATA_KEYS: 'k1:short', NODE_ENV: undefined }, () => assert.throws(() => keys.assertDataKeys(), /id:64-hex/));
  withEnv({ HMS_DATA_KEYS: `k1:${K1},k1:${K2}` }, () => assert.throws(() => keys.assertDataKeys(), /same key ID twice/));
  withEnv({ HMS_DATA_KEYS: `k1:${K1}`, HMS_DATA_KEY_ACTIVE: 'k9' }, () => assert.throws(() => keys.assertDataKeys(), /not in HMS_DATA_KEYS/));
  withEnv({ HMS_DATA_KEYS: undefined, NODE_ENV: undefined, HMS_REQUIRE_DATA_KEYS: undefined }, () => assert.doesNotThrow(() => keys.assertDataKeys()));
});

test('a document with no scanner stays quarantined in every environment', async () => {
  const saved = { h: process.env.CLAMAV_HOST, r: process.env.HMS_REQUIRE_SCANNER };
  delete process.env.CLAMAV_HOST;
  try {
    const { scan } = require('../services/documentScan.cts');
    process.env.HMS_REQUIRE_SCANNER = 'true';
    assert.equal((await scan(Buffer.from('x'))).result, 'unavailable');
    delete process.env.HMS_REQUIRE_SCANNER;
    assert.equal((await scan(Buffer.from('x'))).result, 'unavailable');
  } finally {
    if (saved.h !== undefined) process.env.CLAMAV_HOST = saved.h;
    if (saved.r !== undefined) process.env.HMS_REQUIRE_SCANNER = saved.r; else delete process.env.HMS_REQUIRE_SCANNER;
  }
});
