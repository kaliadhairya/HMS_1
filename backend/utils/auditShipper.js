const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { S3Client, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
const { CHAINS } = require('./auditSealer');
const { validateCheckpoint, lockProblems } = require('./auditCheckpoint');
const { loadKeyMaterial, scopeForDatabase } = require('../services/auditKeys.cts');
const W = require('../services/worklist');

// Ships signed audit checkpoints to write-once object storage (Phase 6H,
// migration 0091) and checks the remote record. The bucket must have Object
// Lock with a default retention set by its owner, who is not the database
// administrator; the credentials given here should only allow adding and
// reading objects. A checkpoint counts as shipped only when the store reports
// it back with its lock. Checks report problems on the accountable worklist.
//
//   AUDIT_WORM_BUCKET, AUDIT_WORM_ENDPOINT (S3-compatible, optional for AWS),
//   AUDIT_WORM_REGION, AUDIT_WORM_ACCESS_KEY, AUDIT_WORM_SECRET_KEY,
//   AUDIT_WORM_PREFIX (default: the database name)
const SHIP_EVERY_MS = Number(process.env.AUDIT_SHIP_INTERVAL_MS || 15000);
const CHECK_EVERY_MS = Number(process.env.AUDIT_WORM_CHECK_INTERVAL_MS || 600000);
const CHECKPOINT_EVERY_MS = Number(process.env.AUDIT_CHECKPOINT_INTERVAL_MS || 60000);
// A checkpoint not shipped within this time is reported.
const GRACE_MS = Number(process.env.AUDIT_SHIP_GRACE_MS || 5 * 60000);

const configured = () => Boolean(process.env.AUDIT_WORM_BUCKET);
const prefix = () => `${(process.env.AUDIT_WORM_PREFIX || process.env.DB_NAME || 'hms').replace(/[^A-Za-z0-9_.-]/g, '-')}/`;
let client;
function s3() {
  if (!client) {
    client = new S3Client({
      region: process.env.AUDIT_WORM_REGION || 'ap-south-1',
      endpoint: process.env.AUDIT_WORM_ENDPOINT || undefined,
      forcePathStyle: Boolean(process.env.AUDIT_WORM_ENDPOINT),
      credentials: process.env.AUDIT_WORM_ACCESS_KEY ? { accessKeyId: process.env.AUDIT_WORM_ACCESS_KEY, secretAccessKey: process.env.AUDIT_WORM_SECRET_KEY } : undefined,
    });
  }
  return client;
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const timeOf = (fileName) => {
  const m = fileName.match(/^audit-checkpoint-(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z-/);
  return m ? new Date(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) : null;
};

// Called right after a checkpoint file is written.
async function queue(sequelize, file) {
  const name = path.basename(file);
  await sequelize.query(`INSERT INTO hms_audit_checkpoint_shipments (file_name, checkpoint_at, sha256)
    VALUES (:name, :at, :sha) ON CONFLICT (file_name) DO NOTHING`, { replacements: { name, at: timeOf(name) || new Date(), sha: sha256(fs.readFileSync(file)) } });
}

// Uploads queued checkpoints, oldest first. Each upload is confirmed with a
// HEAD that must show the same checksum and an Object Lock retention.
async function shipPending(sequelize, dir, { limit = 50, transport = s3() } = {}) {
  if (!configured()) return { shipped: 0 };
  const scope = await scopeForDatabase(sequelize);
  const pending = await sequelize.query('SELECT * FROM hms_audit_checkpoint_shipments WHERE shipped_at IS NULL ORDER BY queued_at LIMIT :limit', { replacements: { limit }, type: QueryTypes.SELECT });
  let shipped = 0;
  for (const p of pending) {
    try {
      const file = path.join(dir, p.file_name);
      const body = fs.readFileSync(file);
      if (sha256(body) !== p.sha256) throw new Error('local checkpoint file changed since it was written');
      const invalid = validateCheckpoint(JSON.parse(body.toString('utf8')), loadKeyMaterial(), CHAINS, new Date(), scope);
      if (invalid.length) throw new Error(invalid.join('; '));
      const Key = prefix() + p.file_name;
      const checksum = crypto.createHash('sha256').update(body).digest('base64');
      const stored = await transport.send(new PutObjectCommand({ Bucket: process.env.AUDIT_WORM_BUCKET, Key, Body: body, ContentType: 'application/json', ChecksumSHA256: checksum, Metadata: { sha256: p.sha256 } }));
      if (!stored.VersionId || stored.VersionId === 'null') throw new Error('the stored checkpoint has no immutable version identifier');
      const head = await transport.send(new HeadObjectCommand({ Bucket: process.env.AUDIT_WORM_BUCKET, Key, VersionId: stored.VersionId }));
      if (head.VersionId !== stored.VersionId) throw new Error('the store returned a different checkpoint version');
      const retention = lockProblems(head);
      if (retention.length) throw new Error(retention.join('; '));
      if ((head.Metadata || {}).sha256 !== p.sha256 || Number(head.ContentLength) !== body.length) throw new Error('the stored object does not match the checkpoint');
      const retrieved = await transport.send(new GetObjectCommand({ Bucket: process.env.AUDIT_WORM_BUCKET, Key, VersionId: stored.VersionId }));
      const retrievedBody = Buffer.from(await retrieved.Body.transformToByteArray());
      if (retrieved.VersionId !== stored.VersionId || sha256(retrievedBody) !== p.sha256 || lockProblems(retrieved, new Date(), head.ObjectLockRetainUntilDate).length) throw new Error('the pinned checkpoint could not be read back intact with retention');
      await sequelize.query(`UPDATE hms_audit_checkpoint_shipments SET shipped_at = now(), remote_key = :key, remote_version = :version,
        lock_mode = :mode, retain_until = :until, attempts = attempts + 1, last_error = NULL WHERE id = :id`,
      { replacements: { id: p.id, key: Key, version: stored.VersionId, mode: head.ObjectLockMode, until: head.ObjectLockRetainUntilDate } });
      shipped++;
    } catch (err) {
      await sequelize.query('UPDATE hms_audit_checkpoint_shipments SET attempts = attempts + 1, last_error = :e WHERE id = :id', { replacements: { id: p.id, e: String(err.message).slice(0, 500) } });
      break; // keep order; retry on the next round
    }
  }
  return { shipped };
}

async function remoteList(transport) {
  const out = [];
  let ContinuationToken;
  do {
    const page = await transport.send(new ListObjectsV2Command({ Bucket: process.env.AUDIT_WORM_BUCKET, Prefix: prefix(), ContinuationToken }));
    (page.Contents || []).forEach((o) => out.push(o.Key));
    if (page.IsTruncated && (!page.NextContinuationToken || page.NextContinuationToken === ContinuationToken)) throw new Error('Invalid checkpoint inventory continuation');
    ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return out.sort();
}

// Checks the remote record against the key, the database and the clock.
// Returns problems as { kind, key, title, detail }.
async function checkRemote(sequelize, { key = loadKeyMaterial(), now = new Date(), transport = s3() } = {}) {
  const problems = [];
  const add = (kind, k, title, detail = {}) => problems.push({ kind, key: k, title, detail });
  if (!configured()) return { problems: [{ kind: 'audit.worm_not_configured', key: 'config', title: 'Audit checkpoints are not shipped to write-once storage (AUDIT_WORM_BUCKET is not set).', detail: {} }], checked: 0 };
  let scope;
  try { scope = await scopeForDatabase(sequelize); }
  catch {
    return { problems: [{ kind: 'audit.scope_unavailable', key: 'scope', title: 'The hospital audit identity could not be verified.', detail: {} }], checked: 0 };
  }
  let keys;
  try { keys = await remoteList(transport); } catch (err) {
    add('audit.worm_unreachable', 'list', 'The write-once audit store could not be read.', { error: err.message });
    return { problems, checked: 0 };
  }
  const times = [];
  if (!keys.length) add('audit.checkpoint_missing', 'initial', 'No checkpoint exists in the protected audit store.');
  const queued = await sequelize.query(`SELECT file_name, shipped_at, remote_key, remote_version, sha256, retain_until, queued_at, last_error FROM hms_audit_checkpoint_shipments
    WHERE shipped_at IS NOT NULL OR queued_at < :cutoff`, { replacements: { cutoff: new Date(now - GRACE_MS) }, type: QueryTypes.SELECT });
  const tracked = new Map(queued.filter((q) => q.shipped_at).map((q) => [q.remote_key, q]));
  for (const k of keys) {
    const name = k.slice(prefix().length);
    try {
      const known = tracked.get(k);
      if (known && !known.remote_version) { add('audit.checkpoint_unversioned', name, `Checkpoint ${name} has no recorded immutable version.`); continue; }
      // Resolve an immutable version first, including objects whose queue row was
      // lost in a database restore. Never inspect an unpinned latest body.
      const head = await transport.send(new HeadObjectCommand({ Bucket: process.env.AUDIT_WORM_BUCKET, Key: k, ...(known ? { VersionId: known.remote_version } : {}) }));
      const version = known ? known.remote_version : head.VersionId;
      if (!version || version === 'null' || head.VersionId !== version) { add('audit.checkpoint_unversioned', name, `Checkpoint ${name} has no verifiable immutable version.`); continue; }
      const obj = await transport.send(new GetObjectCommand({ Bucket: process.env.AUDIT_WORM_BUCKET, Key: k, VersionId: version }));
      if (obj.VersionId !== version) { add('audit.checkpoint_invalid', name, `Checkpoint ${name} returned a different immutable version.`); continue; }
      const retention = [...lockProblems(head, now, known?.retain_until), ...lockProblems(obj, now, head.ObjectLockRetainUntilDate)];
      if (retention.length) { add('audit.checkpoint_unlocked', name, `Checkpoint ${name}: ${retention.join('; ')}.`); continue; }
      const raw = Buffer.from(await obj.Body.transformToByteArray());
      const text = raw.toString('utf8');
      const checksum = sha256(raw);
      if ((known && checksum !== known.sha256) || head.Metadata?.sha256 !== checksum || Number(head.ContentLength) !== raw.length || (obj.ChecksumSHA256 && obj.ChecksumSHA256 !== crypto.createHash('sha256').update(raw).digest('base64'))) { add('audit.checkpoint_invalid', name, `Checkpoint ${name} differs from its recorded checksum or length.`); continue; }
      const parsed = JSON.parse(text);
      const invalid = validateCheckpoint(parsed, key, CHAINS, now, scope);
      if (invalid.length) {
        add('audit.checkpoint_invalid', name, `Checkpoint ${name}: ${invalid.join('; ')}.`);
        continue;
      }
      const body = parsed;
      times.push(new Date(body.created_at));
      for (const head of body.heads) {
        if (!head.seq) continue;
        const [row] = await sequelize.query(`SELECT encode(row_hash, 'hex') AS hash FROM ${head.chain} WHERE chain_seq = :seq`, { replacements: { seq: head.seq }, type: QueryTypes.SELECT });
        if (row?.hash !== head.hash) add('audit.chain_mismatch', head.chain, `Audit ${head.chain} entry ${head.seq} ${row ? 'differs from' : 'is missing since'} remote checkpoint ${name}.`, { checkpoint: name });
      }
    } catch (err) {
      add('audit.checkpoint_invalid', name, `Checkpoint ${name} could not be read or parsed.`, { error: err.message });
    }
  }
  // Gaps: consecutive remote checkpoints more than two intervals apart, and
  // the newest one older than the grace period.
  times.sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    if (times[i] - times[i - 1] > 2 * CHECKPOINT_EVERY_MS) add('audit.checkpoint_gap', times[i - 1].toISOString(), `No audit checkpoint between ${times[i - 1].toISOString()} and ${times[i].toISOString()}.`, { from: times[i - 1], to: times[i] });
  }
  if (times.length && now - times[times.length - 1] > GRACE_MS) add('audit.checkpoint_gap', `${times[times.length - 1].toISOString()}+`, `No audit checkpoint has reached write-once storage since ${times[times.length - 1].toISOString()}.`);
  // Queue rows: shipped but missing remotely, or not shipped in time.
  const remote = new Set(keys);
  for (const q of queued) {
    if (q.shipped_at && !remote.has(q.remote_key)) add('audit.checkpoint_missing', q.file_name, `Checkpoint ${q.file_name} was shipped but is no longer in write-once storage.`);
    if (!q.shipped_at) add('audit.checkpoint_unshipped', q.file_name, `Checkpoint ${q.file_name} has not reached write-once storage.`, { last_error: q.last_error });
  }
  return { problems, checked: keys.length };
}

// Periodic check: every problem goes on the worklist for the security lead.
async function checkAndReport(sequelize, options = {}) {
  const { problems, checked } = await checkRemote(sequelize, options);
  if (problems.length) {
    await require('../services/workerContext.cts').forEachFacility('audit-protection', async () => {
      for (const p of problems) await W.report({ kind: p.kind, key: p.key, title: p.title, detail: p.detail, ownerRole: 'super_admin' });
    });
  }
  return { problems, checked };
}

function startAuditShipper(sequelize) {
  const dir = process.env.AUDIT_CHECKPOINT_DIR;
  if (!configured() || !dir || process.env.AUDIT_SEALER === 'off') return () => {};
  const ship = setInterval(() => shipPending(sequelize, dir).catch((err) => console.error('Audit shipping failed:', err.message)), SHIP_EVERY_MS);
  const check = setInterval(() => checkAndReport(sequelize).catch((err) => console.error('Audit store check failed:', err.message)), CHECK_EVERY_MS);
  ship.unref(); check.unref();
  return () => { clearInterval(ship); clearInterval(check); };
}

module.exports = { configured, prefix, queue, shipPending, checkRemote, checkAndReport, startAuditShipper, timeOf };
