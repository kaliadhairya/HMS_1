// Audit checkpoints in write-once storage (Phase 6H). Needs the backend
// started with AUDIT_CHECKPOINT_DIR/KEY and AUDIT_WORM_* pointing at an
// S3-compatible bucket with Object Lock (the harness uses a throwaway MinIO).
// The test's own credentials are the shipper's: add and read only.
const crypto = require('crypto');
const path = require('path');
const { spawnSync } = require('child_process');
const { api, apiLogin, sql, runner, assert, sleep, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const backend = path.join(__dirname, '../backend');
const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand, ListObjectVersionsCommand } = require(path.join(backend, 'node_modules/@aws-sdk/client-s3'));
for (const k of ['AUDIT_WORM_BUCKET', 'AUDIT_WORM_ENDPOINT', 'AUDIT_WORM_ACCESS_KEY', 'HMS_WORKER_USER_ID']) assert(process.env[k], `${k} is required for this suite`);
const { loadKeyMaterial, signManifest } = require(path.join(backend, 'services/auditKeys.cts'));
assert(loadKeyMaterial(), 'An audit signing key or keyring is required');
const s3 = new S3Client({ region: process.env.AUDIT_WORM_REGION || 'us-east-1', endpoint: process.env.AUDIT_WORM_ENDPOINT, forcePathStyle: true,
  credentials: { accessKeyId: process.env.AUDIT_WORM_ACCESS_KEY, secretAccessKey: process.env.AUDIT_WORM_SECRET_KEY } });
const Bucket = process.env.AUDIT_WORM_BUCKET;
const prefix = require(path.join(backend, 'utils/auditShipper')).prefix();
const put = (Key, body) => {
  const Body = JSON.stringify(body);
  return s3.send(new PutObjectCommand({ Bucket, Key, Body, Metadata: { sha256: crypto.createHash('sha256').update(Body).digest('hex') } }));
};
// Runs the remote check in a separate process, as the periodic job does,
// optionally as if it ran later (to see what silence looks like).
function check(laterMs = 0) {
  const r = spawnSync(process.execPath, ['-e', `
    const { sequelize } = require('./models/db'); require('./utils/auditContext').bindAuditActor(sequelize); const { checkAndReport } = require('./utils/auditShipper');
    checkAndReport(sequelize, { now: new Date(Date.now() + ${Number(laterMs)}) }).then((x) => { console.log(JSON.stringify(x.problems.map((p) => p.kind + ' ' + p.key))); }).finally(() => sequelize.close());`],
  { cwd: backend, env: process.env, encoding: 'utf8' });
  assert(r.status === 0, `check failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

(async () => {
  const { step, done } = runner('Write-once audit checkpoints');
  let shipped;
  let mismatchKey;

  await step('Signed checkpoints reach write-once storage with a COMPLIANCE lock and the same checksum', async () => {
    for (let i = 0; i < 40 && !shipped; i++) {
      [shipped] = await sql('SELECT * FROM hms_audit_checkpoint_shipments WHERE shipped_at IS NOT NULL ORDER BY shipped_at LIMIT 1');
      if (!shipped) await sleep(1000);
    }
    assert(shipped, 'no checkpoint was shipped within 40 seconds');
    assert(shipped.lock_mode === 'COMPLIANCE' && new Date(shipped.retain_until) > new Date(), `lock ${shipped.lock_mode} until ${shipped.retain_until}`);
    const obj = await s3.send(new GetObjectCommand({ Bucket, Key: shipped.remote_key, VersionId: shipped.remote_version }));
    const body = await obj.Body.transformToString();
    assert(crypto.createHash('sha256').update(body).digest('hex') === shipped.sha256, 'remote copy differs from the checkpoint');
  });

  await step('Nobody can delete or overwrite a shipped checkpoint, not even the storage owner during retention', async () => {
    let refused = false;
    try { await s3.send(new DeleteObjectCommand({ Bucket, Key: shipped.remote_key, VersionId: shipped.remote_version || undefined })); } catch { refused = true; }
    assert(refused, 'the shipper deleted a checkpoint');
    const versions = await s3.send(new ListObjectVersionsCommand({ Bucket, Prefix: shipped.remote_key }));
    assert((versions.Versions || []).length >= 1, 'checkpoint version gone');
    if (process.env.P6_MINIO_ROOT_PW) {
      const root = new S3Client({ region: 'us-east-1', endpoint: process.env.AUDIT_WORM_ENDPOINT, forcePathStyle: true, credentials: { accessKeyId: 'p6root', secretAccessKey: process.env.P6_MINIO_ROOT_PW } });
      let rootRefused = false;
      try { await root.send(new DeleteObjectCommand({ Bucket, Key: shipped.remote_key, VersionId: versions.Versions[0].VersionId })); } catch { rootRefused = true; }
      assert(rootRefused, 'the storage owner deleted a locked checkpoint version');
    }
    // An overwrite only adds a version; the original stays retrievable.
    const original = shipped.remote_version;
    await s3.send(new PutObjectCommand({ Bucket, Key: shipped.remote_key, Body: '{"forged":true}' })).catch(() => {});
    const again = await s3.send(new GetObjectCommand({ Bucket, Key: shipped.remote_key, VersionId: original }));
    assert(crypto.createHash('sha256').update(await again.Body.transformToString()).digest('hex') === shipped.sha256, 'the original version was lost');
  });

  await step('The remote check reports a forged, a mismatching and a missing checkpoint on the worklist', async () => {
    const heads = await sql("SELECT chain, seq::integer AS seq, encode(head_hash, 'hex') AS hash FROM audit.chain_heads ORDER BY chain");
    const rowHead = heads.find((head) => head.chain === 'audit.row_changes');
    assert(rowHead && rowHead.seq > 0, 'row chain is unsealed');
    rowHead.hash = '0'.repeat(64);
    mismatchKey = `${rowHead.chain}#${rowHead.seq}`;
    const [{ scope_id: scope }] = await sql('SELECT scope_id FROM audit.checkpoint_identity WHERE singleton');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await put(`${prefix}audit-checkpoint-${stamp}-forged.json`, { created_at: new Date().toISOString(), heads: [], signature: 'f'.repeat(64) });
    await put(`${prefix}audit-checkpoint-${stamp}-wrong.json`, signManifest(heads, loadKeyMaterial(), new Date(), scope));
    const [dbUser] = await sql("SELECT id FROM hms_users WHERE username = 'admin'");
    await sql(`INSERT INTO hms_audit_checkpoint_shipments (file_name, checkpoint_at, sha256, shipped_at, remote_key, lock_mode, retain_until)
      VALUES ($1, now(), $2, now(), $3, 'COMPLIANCE', now() + interval '1 day')`, [`audit-checkpoint-${stamp}-gone.json`, '1'.repeat(64), `${prefix}audit-checkpoint-${stamp}-gone.json`]);
    assert(dbUser, 'admin user');
    const found = check();
    for (const kind of ['audit.checkpoint_invalid', 'audit.chain_mismatch', 'audit.checkpoint_missing']) assert(found.some((p) => p.startsWith(kind)), `${kind} not reported: ${JSON.stringify(found)}`);
    const items = await sql("SELECT kind, owner_role, occurrences FROM hms_worklist_items WHERE status = 'Open' AND kind IN ('audit.checkpoint_invalid', 'audit.chain_mismatch', 'audit.checkpoint_missing')");
    assert(items.length >= 3 && items.every((i) => i.owner_role === 'super_admin'), `worklist ${JSON.stringify(items)}`);
    check();
    const [again] = await sql("SELECT count(*)::int AS n, max(occurrences) AS most FROM hms_worklist_items WHERE status = 'Open' AND kind = 'audit.chain_mismatch' AND dedupe_key=$1 AND facility_id=hms_initial_facility()", [mismatchKey]);
    assert(again.n === 1 && again.most >= 2, 'a repeated problem opened a duplicate item');
  });

  await step('A checkpoint that never ships, and silence from the store, are reported as gaps', async () => {
    await sql(`INSERT INTO hms_audit_checkpoint_shipments (file_name, checkpoint_at, sha256, queued_at) VALUES ($1, now() - interval '1 hour', $2, now() - interval '1 hour')`,
      [`audit-checkpoint-${new Date(Date.now() - 3600e3).toISOString().replace(/[:.]/g, '-')}-stuck.json`, '2'.repeat(64)]);
    // As if checked ten minutes from now: the newest remote checkpoint is old.
    const found = check(10 * 60000);
    assert(found.some((p) => p.startsWith('audit.checkpoint_unshipped')), `unshipped not reported: ${JSON.stringify(found)}`);
    assert(found.some((p) => p.startsWith('audit.checkpoint_gap')), `gap not reported: ${JSON.stringify(found)}`);
  });

  await step('Worklist items are resolved by their owner with a note and then stay closed', async () => {
    const sa = await apiLogin('super_admin');
    const doctor = await apiLogin('doctor');
    const firstPage = await api('GET', '/worklist?kind=audit.&limit=1', { token: sa });
    assert(firstPage.status===200 && firstPage.data.data.length===1 && firstPage.data.pagination.next_offset===1,'Audit backlog was silently truncated');
    const secondPage = await api('GET','/worklist?kind=audit.&limit=1&offset=1',{token:sa});
    assert(secondPage.status===200&&secondPage.data.data[0]?.id!==firstPage.data.data[0].id,'Worklist page repeated its first row');
    assert((await api('GET','/worklist?offset=-1',{token:sa})).status===400,'Invalid page accepted');
    const list = await api('GET', '/worklist?kind=audit.chain_mismatch', { token: sa });
    assert(list.status === 200 && list.data.data.length >= 1, `list ${list.status}`);
    const item = list.data.data.find((w) => w.kind === 'audit.chain_mismatch' && w.dedupe_key === mismatchKey);
    assert(item, 'Current mismatch was not visible to its facility owner');
    const notMine = await api('POST', `/worklist/${item.id}/resolve`, { token: doctor, body: { resolution: 'not my item' } });
    assert(notMine.status === 403, `doctor resolved a security item: ${notMine.status}`);
    const theirs = await api('GET', '/worklist', { token: doctor });
    assert(theirs.status === 200 && !theirs.data.data.some((w) => w.kind.startsWith('audit.')), 'doctor sees security items');
    const empty = await api('POST', `/worklist/${item.id}/resolve`, { token: sa, body: { resolution: '' } });
    assert(empty.status === 400, `resolved without a note: ${empty.status}`);
    const ok = await api('POST', `/worklist/${item.id}/resolve`, { token: sa, body: { resolution: 'Forged test checkpoint, uploaded by the e2e suite' } });
    assert(ok.status === 200 && ok.data.data.status === 'Resolved', `resolve ${ok.status}`);
    let reopened = false;
    try { await sql("UPDATE hms_worklist_items SET status = 'Open', resolved_at = NULL, resolved_by_user_id = NULL WHERE id = $1", [item.id]); } catch { reopened = true; }
    assert(reopened, 'a resolved item was reopened');
    let deleted = false;
    try { await sql('DELETE FROM hms_worklist_items WHERE id = $1', [item.id]); } catch { deleted = true; }
    assert(deleted, 'a worklist item was deleted');
  });

  done();
  process.exit();
})();
