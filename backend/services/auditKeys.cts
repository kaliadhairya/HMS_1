const fs: typeof import('node:fs') = require('node:fs');
const crypto: typeof import('node:crypto') = require('node:crypto');

type AuditKey = Readonly<{ id: string; secret: string; not_before: string; sign_until: string | null }>;
type AuditKeyring = Readonly<{ version: 1; active_key_id: string; legacy_key_id: string | null; keys: readonly AuditKey[] }>;
type KeyMaterial = string | Buffer | AuditKeyring;
const instant = (value: unknown): value is string => typeof value === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(value);

function parseKeyring(value: unknown): AuditKeyring {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid audit keyring');
  const ring = value as AuditKeyring;
  if (ring.version !== 1 || !id(ring.active_key_id) || !(ring.legacy_key_id === null || id(ring.legacy_key_id)) || !Array.isArray(ring.keys) || !ring.keys.length) throw new Error('Invalid audit keyring');
  const seen = new Set<string>();
  for (const key of ring.keys) {
    if (!key || !id(key.id) || seen.has(key.id) || typeof key.secret !== 'string' || Buffer.byteLength(key.secret) < 32 || !instant(key.not_before) || !(key.sign_until === null || instant(key.sign_until)) || (key.sign_until !== null && Date.parse(key.sign_until) <= Date.parse(key.not_before))) throw new Error('Invalid audit keyring entry');
    seen.add(key.id);
  }
  if (!seen.has(ring.active_key_id) || (ring.legacy_key_id !== null && !seen.has(ring.legacy_key_id))) throw new Error('Audit keyring references an unavailable key');
  return ring;
}

function loadKeyMaterial(env: NodeJS.ProcessEnv = process.env): KeyMaterial | undefined {
  if (!env.AUDIT_CHECKPOINT_KEYRING_FILE) {
    if (env.AUDIT_CHECKPOINT_KEY && Buffer.byteLength(env.AUDIT_CHECKPOINT_KEY) < 32) {
      throw new Error('AUDIT_CHECKPOINT_KEY needs at least 32 private bytes');
    }
    return env.AUDIT_CHECKPOINT_KEY;
  }
  const file = fs.openSync(env.AUDIT_CHECKPOINT_KEYRING_FILE, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(file);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0) throw new Error('Audit keyring must be a private regular file (0600 or 0400)');
    return parseKeyring(JSON.parse(fs.readFileSync(file, 'utf8')));
  } finally { fs.closeSync(file); }
}

function selected(material: KeyMaterial, keyId: string | undefined, at: Date, signing: boolean): { key: string | Buffer; id: string } {
  if (!Number.isFinite(at.getTime())) throw new Error('Invalid audit signing time');
  if (typeof material === 'string' || Buffer.isBuffer(material)) {
    const configuredId = process.env.AUDIT_CHECKPOINT_KEY_ID || 'legacy-current';
    if (keyId !== undefined && keyId !== configuredId) throw new Error('Checkpoint verification key is unavailable');
    return { key: material, id: configuredId };
  }
  const ring = parseKeyring(material);
  const wanted = signing ? ring.active_key_id : keyId ?? ring.legacy_key_id;
  const key = ring.keys.find(item => item.id === wanted);
  if (!key) throw new Error('Checkpoint verification key is unavailable');
  if (at.getTime() < Date.parse(key.not_before) || (key.sign_until !== null && at.getTime() > Date.parse(key.sign_until))) throw new Error('Checkpoint was signed outside the approved key interval');
  return { key: key.secret, id: key.id };
}

function signManifest(heads: unknown[], material: KeyMaterial, now = new Date(), scope = process.env.AUDIT_CHECKPOINT_SCOPE): Record<string, unknown> {
  if (!scope || !scope.trim()) throw new Error('A stable audit identity is required to bind new checkpoints');
  const identity = selected(material, undefined, now, true);
  const body = { schema_version: 2, key_id: identity.id, scope, created_at: now.toISOString(), heads };
  return { ...body, signature: crypto.createHmac('sha256', identity.key).update(JSON.stringify(body)).digest('hex') };
}

function verificationKey(body: Record<string, unknown>, material: KeyMaterial): string | Buffer {
  if (body.schema_version !== undefined && body.schema_version !== 2) throw new Error('Unsupported checkpoint schema');
  if (body.schema_version === 2 && (!id(body.key_id) || typeof body.scope !== 'string' || !body.scope.trim())) throw new Error('Checkpoint key or scope binding is invalid');
  if (body.schema_version === undefined && (body.key_id !== undefined || body.scope !== undefined)) throw new Error('Legacy checkpoint has unsupported key or scope fields');
  return selected(material, body.key_id as string | undefined, new Date(body.created_at as string), false).key;
}

async function scopeForDatabase(sequelize: {
  query: (sql: string, options: { type: string; retry: { max: number } }) => Promise<Array<{ scope_id?: string; SCOPE_ID?: string }>>;
}): Promise<string> {
  const [row] = await sequelize.query(
    'SELECT scope_id::text AS scope_id FROM audit.checkpoint_identity WHERE singleton',
    { type: 'SELECT', retry: { max: 0 } },
  );
  const scope = row?.scope_id ?? row?.SCOPE_ID;
  if (typeof scope !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(scope)) {
    throw new Error('The hospital audit identity is unavailable');
  }
  if (process.env.AUDIT_CHECKPOINT_SCOPE && process.env.AUDIT_CHECKPOINT_SCOPE !== scope) {
    throw new Error('Configured audit identity does not match this database');
  }
  return scope;
}
module.exports = { parseKeyring, loadKeyMaterial, signManifest, verificationKey, scopeForDatabase };
