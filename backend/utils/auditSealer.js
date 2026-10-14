const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');

// Seals committed audit entries into their hash chains (audit.seal, migration
// 0006) every few seconds, and writes a signed checkpoint of every chain head
// once a minute. Checkpoints only prove anything when AUDIT_CHECKPOINT_DIR is
// storage the database's administrators cannot rewrite (for example an
// object-locked bucket synced from that directory).
const CHAINS = ['audit.row_changes', 'audit.access_events', 'public.hms_audit_logs'];
const SEAL_LOCK = 727275; // only one instance seals at a time
// A retry inside a failed transaction can only fail again and hides the cause.
const NO_RETRY = { max: 1 };
const SEAL_EVERY_MS = Number(process.env.AUDIT_SEAL_INTERVAL_MS || 5000);
const CHECKPOINT_EVERY_MS = Number(process.env.AUDIT_CHECKPOINT_INTERVAL_MS || 60000);

async function sealOnce(sequelize) {
  return sequelize.transaction(async (transaction) => {
    const [{ locked }] = await sequelize.query('SELECT pg_try_advisory_xact_lock(:lock) AS locked', {
      replacements: { lock: SEAL_LOCK }, type: QueryTypes.SELECT, transaction, retry: NO_RETRY,
    });
    if (!locked) return 0;
    let sealed = 0;
    for (const chain of CHAINS) {
      const [row] = await sequelize.query('SELECT audit.seal(CAST(:chain AS regclass)) AS n', {
        replacements: { chain }, type: QueryTypes.SELECT, transaction, retry: NO_RETRY,
      });
      sealed += Number(row.n ?? row.N ?? 0);
    }
    return sealed;
  });
}

function signCheckpoint(heads, key) {
  const body = { created_at: new Date().toISOString(), heads };
  const signature = crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
  return { ...body, signature };
}

async function writeCheckpoint(sequelize, dir, key) {
  const rows = await sequelize.query("SELECT chain, seq, encode(head_hash, 'hex') AS hash FROM audit.chain_heads ORDER BY chain", { type: QueryTypes.SELECT });
  const heads = rows.map((r) => ({ chain: r.chain || r.CHAIN, seq: Number(r.seq ?? r.SEQ), hash: r.hash || r.HASH }));
  const checkpoint = signCheckpoint(heads, key);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `audit-checkpoint-${checkpoint.created_at.replace(/[:.]/g, '-')}-${crypto.randomUUID()}.json`);
  const temporary = `${file}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(checkpoint, null, 2)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
  const directory = fs.openSync(dir, 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return file;
}

function startAuditSealer(sequelize) {
  if (process.env.AUDIT_SEALER === 'off') return () => {};
  const dir = process.env.AUDIT_CHECKPOINT_DIR;
  const key = process.env.AUDIT_CHECKPOINT_KEY;
  if (dir && !key) console.warn('⚠️ AUDIT_CHECKPOINT_DIR is set without AUDIT_CHECKPOINT_KEY; checkpoints are disabled.');
  const sealTimer = setInterval(() => {
    sealOnce(sequelize).catch((err) => console.error('Audit sealing failed:', err.original?.message || err.message, err.original?.where || ''));
  }, SEAL_EVERY_MS);
  const checkpointTimer = dir && key ? setInterval(async () => {
    try {
      await sealOnce(sequelize);
      const file = await writeCheckpoint(sequelize, dir, key);
      // Queued for write-once storage (utils/auditShipper.js, Phase 6H).
      await require('./auditShipper').queue(sequelize, file);
    } catch (err) {
      console.error('Audit checkpoint failed:', err.message);
    }
  }, CHECKPOINT_EVERY_MS) : null;
  sealTimer.unref();
  if (checkpointTimer) checkpointTimer.unref();
  return () => { clearInterval(sealTimer); if (checkpointTimer) clearInterval(checkpointTimer); };
}

module.exports = { CHAINS, sealOnce, signCheckpoint, writeCheckpoint, startAuditSealer };
