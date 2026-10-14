// Encryption of stored personal data (completion A4).
//
// One keyring for every encrypted value: AES-256-GCM (authenticated: a
// changed value fails to decrypt instead of decrypting to garbage), a key ID
// in every value so keys can rotate, and a purpose bound into each value as
// associated data so a value cannot be moved to another field or record.
//
//   HMS_DATA_KEYS="2026b:<64 hex>,2026a:<64 hex>"  (the first is used for new values)
//   HMS_DATA_KEY_ACTIVE=2026b                       (optional: name the active key)
//
// Values written before this are AES-CBC without a key ID: ENCRYPTION_KEY
// (utils/encryption.js) and AADHAAR_ENCRYPTION_KEY (models/Patient.js).
// They still decrypt, are reported as legacy, and scripts/rekey-data.js
// re-encrypts them. In production HMS refuses to start without HMS_DATA_KEYS.
const crypto = require('node:crypto');

type Key = { id: string; key: Buffer };
type Opened = { plain: Buffer; keyId: string; legacy: boolean };
const PREFIX = 'hk2';
const DEV_ID = 'dev-only';
let warned = false;

function parseKeys(): Key[] {
  const raw = (process.env.HMS_DATA_KEYS || '').trim();
  if (!raw) return [];
  return raw.split(',').map((part) => {
    const m = /^([A-Za-z0-9_-]{1,32}):([0-9a-fA-F]{64})$/.exec(part.trim());
    if (!m) throw new Error('HMS_DATA_KEYS must be a comma-separated list of id:64-hex-character keys');
    return { id: m[1], key: Buffer.from(m[2], 'hex') };
  });
}

function production(): boolean { return process.env.NODE_ENV === 'production' || process.env.HMS_REQUIRE_DATA_KEYS === 'true'; }

// Called at start-up: no keys in production is refused, not tolerated.
function assertDataKeys(): void {
  const keys = parseKeys();
  const ids = new Set(keys.map((k) => k.id));
  if (ids.size !== keys.length) throw new Error('HMS_DATA_KEYS lists the same key ID twice');
  const active = process.env.HMS_DATA_KEY_ACTIVE;
  if (active && !ids.has(active)) throw new Error(`HMS_DATA_KEY_ACTIVE names ${active}, which is not in HMS_DATA_KEYS`);
  if (!keys.length && production()) throw new Error('HMS_DATA_KEYS is not set; personal data cannot be encrypted with a published development key in production');
}

function ring(): { active: Key; byId: Map<string, Key> } {
  const keys = parseKeys();
  if (!keys.length) {
    if (production()) throw new Error('HMS_DATA_KEYS is not set');
    if (!warned) { warned = true; console.warn('⚠️  HMS_DATA_KEYS is not set: using a development-only data key. Never use this with real patients.'); }
    const dev = { id: DEV_ID, key: crypto.createHash('sha256').update('hms development data key - not for patients').digest() };
    return { active: dev, byId: new Map([[DEV_ID, dev]]) };
  }
  const byId = new Map(keys.map((k) => [k.id, k]));
  return { active: byId.get(process.env.HMS_DATA_KEY_ACTIVE || '') || keys[0], byId };
}

const b64 = (b: Buffer): string => b.toString('base64url');
const unb64 = (s: string): Buffer => Buffer.from(s, 'base64url');

function seal(plain: Buffer, purpose: string): { keyId: string; iv: Buffer; tag: Buffer; ct: Buffer } {
  if (!purpose) throw new Error('An encryption purpose is required');
  const { active } = ring();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', active.key, iv);
  c.setAAD(Buffer.from(`${PREFIX}|${active.id}|${purpose}`));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return { keyId: active.id, iv, tag: c.getAuthTag(), ct };
}

function unseal(keyId: string, iv: Buffer, tag: Buffer, ct: Buffer, purpose: string): Buffer {
  const k = ring().byId.get(keyId);
  if (!k) throw Object.assign(new Error(`Data key ${keyId} is not loaded; add it to HMS_DATA_KEYS to read this value`), { code: 'DATA_KEY_MISSING' });
  const d = crypto.createDecipheriv('aes-256-gcm', k.key, iv);
  d.setAAD(Buffer.from(`${PREFIX}|${keyId}|${purpose}`));
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(ct), d.final()]); }
  catch { throw Object.assign(new Error('The stored value failed its integrity check (changed, moved or wrong key)'), { code: 'DATA_INTEGRITY' }); }
}

// Text values: "hk2:<key id>:<iv>:<tag>:<ciphertext>".
function encryptText(text: string | null | undefined, purpose: string): string | null {
  if (text === null || text === undefined || text === '') return null;
  const s = seal(Buffer.from(String(text), 'utf8'), purpose);
  return [PREFIX, s.keyId, b64(s.iv), b64(s.tag), b64(s.ct)].join(':');
}

// Old AES-CBC "iv:ciphertext" (hex) values, from either earlier key.
function legacyKeys(): Buffer[] {
  const out: Buffer[] = [];
  const general = process.env.ENCRYPTION_KEY || 'default_dev_key_32chars_replace!';
  out.push(Buffer.from(general.padEnd(32, '0').slice(0, 32), 'utf8'));
  const aadhaar = process.env.AADHAAR_ENCRYPTION_KEY || '0'.repeat(64);
  if (/^[0-9a-fA-F]{64}$/.test(aadhaar)) out.push(Buffer.from(aadhaar, 'hex'));
  return out;
}
function openLegacy(value: string): Buffer {
  const [ivHex, ctHex] = value.split(':');
  for (const key of legacyKeys()) {
    try {
      const d = crypto.createDecipheriv('aes-256-cbc', key, Buffer.from(ivHex, 'hex'));
      return Buffer.concat([d.update(Buffer.from(ctHex, 'hex')), d.final()]);
    } catch { /* try the next legacy key */ }
  }
  throw Object.assign(new Error('A legacy encrypted value could not be decrypted with ENCRYPTION_KEY or AADHAAR_ENCRYPTION_KEY'), { code: 'DATA_KEY_MISSING' });
}

function openText(value: string | null | undefined, purpose: string): Opened | null {
  if (value === null || value === undefined || value === '') return null;
  const v = String(value);
  if (v.startsWith(`${PREFIX}:`)) {
    const [, keyId, iv, tag, ct] = v.split(':');
    return { plain: unseal(keyId, unb64(iv), unb64(tag), unb64(ct), purpose), keyId, legacy: false };
  }
  if (/^[0-9a-f]{32}:[0-9a-f]+$/i.test(v)) return { plain: openLegacy(v), keyId: 'legacy-cbc', legacy: true };
  throw Object.assign(new Error('Not an encrypted value'), { code: 'DATA_FORMAT' });
}
function decryptText(value: string | null | undefined, purpose: string): string | null {
  const o = openText(value, purpose);
  return o ? o.plain.toString('utf8') : null;
}

// True when a value should be re-encrypted: legacy format or not the active key.
function needsRekey(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = String(value);
  if (!v.startsWith(`${PREFIX}:`)) return true;
  return v.split(':')[1] !== ring().active.id;
}

// Binary (documents): a self-describing header line, then the ciphertext.
function encryptBlob(plain: Buffer, purpose: string): Buffer {
  const s = seal(plain, purpose);
  const header = JSON.stringify({ format: 'hms-blob-2', key_id: s.keyId, iv: b64(s.iv), tag: b64(s.tag) });
  return Buffer.concat([Buffer.from(`${header}\n`, 'utf8'), s.ct]);
}
function decryptBlob(stored: Buffer, purpose: string): { plain: Buffer; keyId: string } {
  const nl = stored.indexOf(0x0a);
  if (nl < 0) throw Object.assign(new Error('Not an encrypted document'), { code: 'DATA_FORMAT' });
  const h = JSON.parse(stored.subarray(0, nl).toString('utf8'));
  if (h.format !== 'hms-blob-2') throw Object.assign(new Error('Unknown document format'), { code: 'DATA_FORMAT' });
  return { plain: unseal(h.key_id, unb64(h.iv), unb64(h.tag), stored.subarray(nl + 1), purpose), keyId: h.key_id };
}

const activeKeyId = (): string => ring().active.id;

module.exports = { assertDataKeys, encryptText, decryptText, openText, needsRekey, encryptBlob, decryptBlob, activeKeyId, DEV_ID };
