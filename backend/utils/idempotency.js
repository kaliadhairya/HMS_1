const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { storage } = require('./auditContext');
const { beforeSend } = require('./responseGate');

const REQUIRED = [
  /^\/api\/laboratory(?:\/.*)?$/,
  /^\/api\/lab(?:\/.*)?$/,
  /^\/api\/reports(?:\/.*)?$/,
  /^\/api\/(pharmacy|pharmacist_lms|medicines|suppliers)(?:\/.*)?$/,
  /^\/api\/hms\/medicines(?:\/.*)?$/,
  /^\/api\/medication(?:\/.*)?$/,
  /^\/api\/patients(?:\/.*)?$/,
  /^\/api\/ipd(?:\/.*)?$/,
  /^\/api\/doctor\/(prescriptions|referrals)(?:\/.*)?$/,
  /^\/api\/hms\/rest-forms(?:\/.*)?$/,
  /^\/api\/billing\/(advance|opd|payment)$/,
  /^\/api\/billing\/\d+\/(payment|discount)$/,
  /^\/api\/pharmacy\/(grn|dispense|otc|return)$/,
  /^\/api\/ipd\/admissions$/,
  /^\/api\/ipd\/admissions\/\d+\/(discharge|charges|generate-bill)$/,
  /^\/api\/ipd\/mar(?:\/\d+\/status)?$/,
  /^\/api\/lab\/(samples|results\/[\w-]+)$/,
  /^\/api\/pharmacist_lms\/(dispense|returns|purchase-orders)$/,
  /^\/api\/hms\/(encounters|diagnoses|prescriptions|investigation-orders|appointments|tokens|vitals)(?:\/.*)?$/,
  /^\/api\/clinical-documents(?:\/.*)?$/,
  /^\/api\/triage(?:\/.*)?$/,
  /^\/api\/adt(?:\/.*)?$/,
  /^\/api\/referrals(?:\/.*)?$/,
  /^\/api\/finance(?:\/.*)?$/,
  /^\/api\/terminology(?:\/.*)?$/,
  /^\/api\/worklist(?:\/.*)?$/,
  /^\/api\/abdm(?:\/.*)?$/,
  /^\/api\/devices(?:\/.*)?$/,
];
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const KEY_FORMAT = /^[\w.:-]{8,200}$/;
const NO_RETRY = { max: 0 };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}
function commandPath(req) {
  const url = new URL(req.originalUrl, 'http://hms.invalid');
  url.searchParams.delete('token');
  url.searchParams.sort();
  return url.pathname + (url.searchParams.size ? `?${url.searchParams}` : '');
}
function requestHash(req) {
  return crypto.createHash('sha256').update(JSON.stringify({ method: req.method, path: commandPath(req), body: canonical(req.body ?? null), file: req.file ? { checksum: crypto.createHash('sha256').update(require('fs').readFileSync(req.file.path)).digest('hex'), type: req.file.mimetype } : null })).digest('hex');
}

// Claim, all domain queries, audit, outbox and exact response commit together.
// An uncommitted claim is a database lock, not a timed lease. A dead process
// rolls back everything; a committed command always has its original result.
async function idempotencyGuard(req, res, next) {
  if (req.idempotencyChecked || !MUTATING.has(req.method) || !req.user?.id) return next();
  req.idempotencyChecked = true;
  const path = req.originalUrl.split('?')[0];
  if (String(req.headers['content-type'] || '').startsWith('multipart/form-data') && !req.multipartParsed) { req.idempotencyChecked = false; return next(); }
  const key = req.headers['idempotency-key'];
  if (!key) {
    if (REQUIRED.some((pattern) => pattern.test(path))) return res.status(428).json({ success: false, code: 'IDEMPOTENCY_KEY_REQUIRED', message: 'This command requires an Idempotency-Key header.' });
    return next();
  }
  if (typeof key !== 'string' || !KEY_FORMAT.test(key)) return res.status(400).json({ success: false, message: 'Idempotency-Key must be 8 to 200 letters, digits, ".", ":", "_" or "-".' });
  const transaction = await sequelize.transaction();
  const store = storage.getStore();
  if (!store) { await transaction.rollback(); throw new Error('Command requires request context'); }
  const replacements = { userId: req.user.id, key, method: req.method, path: commandPath(req), hash: requestHash(req), requestId: req.id };
  const query = (sql, extra = {}) => sequelize.query(sql, { replacements, transaction, retry: NO_RETRY, ...extra });
  try {
    await query("SET LOCAL lock_timeout = '150ms'");
    const claimed = await query(`INSERT INTO hms_idempotency_keys (user_id, idempotency_key, method, path, request_hash, request_id, state)
      VALUES (:userId, :key, :method, :path, :hash, :requestId, 'in_progress')
      ON CONFLICT (user_id, idempotency_key) DO NOTHING RETURNING 1 AS claimed`, { type: QueryTypes.SELECT });
    if (!claimed.length) {
      const [prior] = await query('SELECT request_hash, state, response_status, response_body FROM hms_idempotency_keys WHERE user_id = :userId AND idempotency_key = :key', { type: QueryTypes.SELECT });
      await transaction.rollback();
      if (prior.request_hash !== replacements.hash) return res.status(409).json({ success: false, code: 'IDEMPOTENCY_KEY_CONFLICT', message: 'This key was used for a different request.' });
      if (prior.state !== 'completed') return res.status(409).json({ success: false, code: 'IDEMPOTENCY_OUTCOME_UNKNOWN', message: 'This legacy request needs reconciliation. It will not be executed again automatically.' });
      res.setHeader('Idempotent-Replay', 'true');
      return res.status(prior.response_status).json(prior.response_body);
    }
    await query("SET LOCAL lock_timeout = '500ms'");
    await query("SET LOCAL statement_timeout = '10s'");
    await query('SAVEPOINT clinical_command');
    store.command = { transaction, active: true };
    res.locals.abortCommand = async () => {
      try { if (!transaction.finished) await transaction.rollback(); } finally { store.command.active = false; }
    };
    res.on('close', () => {
      if (store.command.active) res.locals.abortCommand().catch((error) => console.error('Command rollback failed:', error.code || error.name));
    });
    beforeSend(res, 10, async () => {
      const status = res.statusCode;
      if (status >= 500) { await res.locals.abortCommand(); return; }
      if (status >= 400) await query('ROLLBACK TO SAVEPOINT clinical_command');
      if (res.locals.responseBody === undefined) throw new Error('Idempotent commands must return a JSON response');
      const secretIssued = path === '/api/security/api-keys' && req.method === 'POST' && status < 400;
      const receiptBody = secretIssued ? { success: false, code: 'ONE_TIME_SECRET_ALREADY_ISSUED', message: 'This key was already issued. Its secret is shown once; revoke it and create a replacement if the response was lost.', data: { ...res.locals.responseBody.data, key: undefined } } : res.locals.responseBody;
      await query(`UPDATE hms_idempotency_keys SET state = 'completed', response_status = :status,
        response_body = CAST(:body AS jsonb), finished_at = now() WHERE user_id = :userId AND idempotency_key = :key`, {
        replacements: { ...replacements, status: secretIssued ? 409 : status, body: JSON.stringify(receiptBody) },
      });
      await transaction.commit();
      store.command.active = false;
    });
    return next();
  } catch (error) {
    if (!transaction.finished) await transaction.rollback().catch(() => {});
    if (error.original?.code === '55P03' || error.parent?.code === '55P03') return res.status(409).json({ success: false, code: 'IDEMPOTENCY_IN_PROGRESS', message: 'The original request is still processing. Retry with this same key.' });
    throw error;
  }
}
module.exports = { idempotencyGuard, REQUIRED, requestHash };
