// Durable messages to and from outside systems (Phase 6, migration 0092).
// Outgoing messages are written inside the business transaction and delivered
// by a worker: retried with growing waits, and after the last attempt marked
// Failed and put on the accountable worklist. Incoming messages are kept
// exactly as received and accepted once per sender and message ID; the same
// ID with different content is refused.
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const W = require('./worklist');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };

const handlers = new Map(); // system prefix -> async (message) => response
// Who answers for a system's failed messages.
const owners = new Map();
function register(systemPrefix, send, { ownerRole = 'super_admin' } = {}) { handlers.set(systemPrefix, send); owners.set(systemPrefix, ownerRole); }
const handlerFor = (system) => [...handlers.keys()].filter((k) => system === k || system.startsWith(`${k}:`)).sort((a, b) => b.length - a.length)[0];

// sentByCaller: the caller sends it itself and settles it; the worker never does.
async function enqueue({ system, type, version, externalId = crypto.randomUUID(), correlationId = null, endpoint = null, payload, patientId = null, maxAttempts = 8, sentByCaller = false }, t) {
  return one(`INSERT INTO hms_interface_messages (direction, system, message_type, contract_version, external_id, correlation_id, endpoint, payload, status, patient_id, max_attempts, next_attempt_at)
    VALUES ('out', :system, :type, :version, :externalId, :correlationId, :endpoint, CAST(:payload AS jsonb), 'Pending', :patientId, :maxAttempts, CASE WHEN :sentByCaller THEN 'infinity'::timestamptz ELSE now() END)
    ON CONFLICT (system, direction, external_id) DO NOTHING RETURNING *`,
  { system, type, version: String(version), externalId, correlationId, endpoint, payload: JSON.stringify(payload ?? null), patientId, maxAttempts, sentByCaller }, t)
    || one("SELECT * FROM hms_interface_messages WHERE system = :system AND direction = 'out' AND external_id = :externalId", { system, externalId }, t);
}

// Records an incoming message once. Returns { message, duplicate }.
async function receive({ system, type, version, externalId, raw, payload = null, correlationId = null, patientId = null }, t) {
  const context=require('../utils/auditContext').storage.getStore()||{};
  const inserted = await one(`INSERT INTO hms_interface_messages (direction, system, message_type, contract_version, external_id, correlation_id, raw, payload, status, patient_id,accepted_by_user_id,device_contract_id)
    VALUES ('in', :system, :type, :version, :externalId, :correlationId, :raw, CAST(:payload AS jsonb), 'Received', :patientId,:acceptedBy,:deviceContract)
    ON CONFLICT (system, direction, external_id) DO NOTHING RETURNING *`,
  { system, type, version: String(version), externalId: String(externalId), correlationId, raw: String(raw), payload: JSON.stringify(payload), patientId,acceptedBy:context.userId||null,deviceContract:context.deviceContractId||null }, t);
  if (inserted) return { message: inserted, duplicate: false };
  const existing = await one("SELECT * FROM hms_interface_messages WHERE system = :system AND direction = 'in' AND external_id = :externalId", { system, externalId: String(externalId) }, t);
  if (existing.raw !== String(raw)) fail(409, `Message ${externalId} from ${system} was already received with different content.`, 'DUPLICATE_ID_DIFFERENT_CONTENT');
  return { message: existing, duplicate: true };
}

const settle = (id, status, extra = {}, t) => one(`UPDATE hms_interface_messages SET status = :status, finished_at = CASE WHEN :status IN ('Unmatched', 'Received') THEN NULL ELSE now() END,
  last_error = COALESCE(:error, last_error), response = COALESCE(CAST(:response AS jsonb), response), patient_id = COALESCE(:patientId, patient_id)
  WHERE id = :id RETURNING *`, { id, status, error: extra.error || null, response: extra.response ? JSON.stringify(extra.response) : null, patientId: extra.patientId || null }, t);

// Backoff: 5 s, 10 s, 20 s ... capped at an hour.
const backoffSeconds = (attempt) => Math.min(3600, 5 * 2 ** Math.max(0, attempt - 1));

async function deliverDue({ limit = 10 } = {}) {
  // Claim with a lease so a crashed worker's messages come back.
  const due = await sequelize.query(`UPDATE hms_interface_messages SET attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
    WHERE id IN (SELECT id FROM hms_interface_messages WHERE status = 'Pending' AND next_attempt_at <= now() ORDER BY next_attempt_at LIMIT :limit FOR UPDATE SKIP LOCKED)
    RETURNING *`, { replacements: { limit }, type: QueryTypes.SELECT });
  let delivered = 0;
  for (const m of due) {
    const key = handlerFor(m.system);
    try {
      if (!key) throw new Error(`No sender is configured for ${m.system}.`);
      const response = await handlers.get(key)(m);
      await settle(m.id, 'Delivered', { response: response ?? { ok: true } });
      delivered++;
    } catch (err) {
      const message = String(err.message || err).slice(0, 1000);
      if (m.attempts >= m.max_attempts || err.permanent) {
        await settle(m.id, 'Failed', { error: message });
        await W.report({ kind: 'interface.delivery_failed', key: m.id, title: `${m.system}: ${m.message_type} could not be delivered after ${m.attempts} attempt(s).`, detail: { message_id: m.id, error: message }, ownerRole: owners.get(key) || 'super_admin', patientId: m.patient_id });
      } else {
        await sequelize.query("UPDATE hms_interface_messages SET last_error = :e, next_attempt_at = now() + make_interval(secs => :s) WHERE id = :id", { replacements: { id: m.id, e: message, s: backoffSeconds(m.attempts) } });
      }
    }
  }
  return { claimed: due.length, delivered };
}

function startInterfaceWorker() {
  if (process.env.INTERFACE_WORKER === 'off') return () => {};
  const timer = setInterval(() => deliverDue().catch((err) => console.error('Interface delivery failed:', err.message)), Number(process.env.INTERFACE_POLL_MS || 2000));
  timer.unref();
  return () => clearInterval(timer);
}

const list = ({ system = null, status = null, direction = null, limit = 200 } = {}, t) => rows(`SELECT id, direction, system, message_type, contract_version, external_id, correlation_id,
    status, attempts, max_attempts, next_attempt_at, last_error, patient_id, created_at, finished_at
  FROM hms_interface_messages WHERE (:system::text IS NULL OR system LIKE :system) AND (:status::text IS NULL OR status = :status)
    AND (:direction::text IS NULL OR direction = :direction) ORDER BY created_at DESC LIMIT :limit`,
{ system: system ? `${system}%` : null, status, direction, limit: Math.min(Number(limit) || 200, 1000) }, t);

// A person sends a Failed message again (same content, same ID): it becomes a
// new attempt series; the earlier failure stays on the worklist record.
async function retry(id, actor, t) {
  const m = await one("SELECT * FROM hms_interface_messages WHERE id = :id AND direction = 'out'", { id }, t);
  if (!m) fail(404, 'Message not found.');
  if (m.status !== 'Failed') fail(409, 'Only a failed message can be sent again.', 'NOT_FAILED');
  return one(`INSERT INTO hms_interface_messages (direction, system, message_type, contract_version, external_id, correlation_id, endpoint, payload, status, patient_id, max_attempts)
    VALUES ('out', :system, :type, :version, :externalId, :correlationId, :endpoint, CAST(:payload AS jsonb), 'Pending', :patientId, :max) RETURNING *`,
  { system: m.system, type: m.message_type, version: m.contract_version, externalId: `${m.external_id}#retry-${crypto.randomUUID().slice(0, 8)}`, correlationId: m.correlation_id || m.external_id,
    endpoint: m.endpoint, payload: JSON.stringify(m.payload), patientId: m.patient_id, max: m.max_attempts }, t);
}

module.exports = { register, enqueue, receive, settle, deliverDue, startInterfaceWorker, list, retry, backoffSeconds };
