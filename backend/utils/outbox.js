const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { storage } = require('./auditContext');
const { validateSocketSessions } = require('./socketSessions');
const DISPATCH_EVERY_MS = Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS || 500);
const NO_RETRY = { max: 0 };
const BATCH_SIZE = 200;
async function publish(eventType, audience, payload, { transaction } = {}) {
  if (!transaction && !storage.getStore()?.command?.active) throw new Error('Outbox publication requires a domain transaction');
  await sequelize.query('INSERT INTO hms_outbox (event_type, audience, payload, request_id) VALUES (:eventType, :audience, CAST(:payload AS jsonb), :requestId)', {
    replacements: { eventType, audience, payload: JSON.stringify(payload ?? {}), requestId: storage.getStore()?.requestId ?? null }, transaction,
  });
}
function toClientEvent(row) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
  return { ...payload, event_id: Number(row.id), delivery_sequence: Number(row.delivery_sequence), occurred_at: row.created_at };
}
async function latestSequence() {
  const [row] = await sequelize.query('SELECT COALESCE(max(delivery_sequence), 0) AS sequence FROM hms_outbox', { type: QueryTypes.SELECT });
  return Number(row.sequence);
}
// Serialization lasts through commit, so later sequences never become visible
// before earlier assignments. Late-committing domain transactions get new
// delivery sequences regardless of the order their event IDs were allocated.
async function allocateSequences() {
  return sequelize.transaction(async (transaction) => {
    const query = (sql, options = {}) => sequelize.query(sql, { transaction, retry: NO_RETRY, ...options });
    const [{ locked }] = await query('SELECT pg_try_advisory_xact_lock(727276) AS locked', { type: QueryTypes.SELECT });
    if (!locked) return;
    const rows = await query('SELECT id FROM hms_outbox WHERE delivery_sequence IS NULL ORDER BY id LIMIT :limit FOR UPDATE', { replacements: { limit: BATCH_SIZE }, type: QueryTypes.SELECT });
    if (!rows.length) return;
    const [{ first }] = await query("SELECT nextval('hms_outbox_delivery_seq') AS first", { type: QueryTypes.SELECT });
    const base = BigInt(first);
    await query("SELECT setval('hms_outbox_delivery_seq', :last, true)", { replacements: { last: String(base + BigInt(rows.length - 1)) } });
    const assignments = rows.map((row, i) => ({ id: String(row.id), sequence: String(base + BigInt(i)) }));
    await query(`UPDATE hms_outbox o SET delivery_sequence = assignment.sequence FROM jsonb_to_recordset(CAST(:assignments AS jsonb)) AS assignment(id bigint, sequence bigint) WHERE o.id = assignment.id`, { replacements: { assignments: JSON.stringify(assignments) } });
  });
}
async function dispatchOnce(io, state) {
  if (state.cursor === undefined) state.cursor = await latestSequence();
  await allocateSequences();
  const rows = await sequelize.query('SELECT id, event_type, audience, payload, created_at, delivery_sequence FROM hms_outbox WHERE delivery_sequence > :cursor ORDER BY delivery_sequence LIMIT :limit', {
    replacements: { cursor: state.cursor, limit: BATCH_SIZE }, type: QueryTypes.SELECT, retry: NO_RETRY,
  });
  await validateSocketSessions(io);
  for (const row of rows) {
    (row.audience === 'all' ? io : io.to(row.audience)).emit(row.event_type, toClientEvent(row));
    state.cursor = Number(row.delivery_sequence);
  }
  if (rows.length) await sequelize.query('UPDATE hms_outbox SET delivered_at = now() WHERE id IN (:ids) AND delivered_at IS NULL', { replacements: { ids: rows.map((row) => row.id) }, retry: NO_RETRY });
  return rows.length;
}
function startOutboxDispatcher(io) {
  if (process.env.OUTBOX_DISPATCH === 'off') return () => {};
  const state = {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await dispatchOnce(io, state); } catch (error) { console.error('Outbox dispatch failed:', error.original?.code || error.name); } finally { running = false; }
  }, DISPATCH_EVERY_MS);
  timer.unref();
  return () => clearInterval(timer);
}
async function eventsPage(user, afterSequence, limit = BATCH_SIZE) {
  const latest = await latestSequence();
  const rows = await sequelize.query(`SELECT id, event_type, payload, created_at, delivery_sequence FROM hms_outbox
    WHERE delivery_sequence > :after AND delivery_sequence <= :latest
      AND audience IN (:role, :userRoom, 'all') ORDER BY delivery_sequence LIMIT :limit`, {
    replacements: { after: afterSequence, latest, role: user.role, userRoom: `user:${user.id}`, limit: limit + 1 }, type: QueryTypes.SELECT,
  });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { data: page.map((row) => ({ type: row.event_type, data: toClientEvent(row) })),
    next_sequence: more ? Number(page[page.length - 1].delivery_sequence) : latest, latest_sequence: latest, has_more: more };
}
// Compatibility for earlier API clients; new clients use delivery sequences.
async function eventsSince(user, afterId, limit = BATCH_SIZE) {
  const rows = await sequelize.query(`SELECT id, event_type, payload, created_at, delivery_sequence FROM hms_outbox WHERE id > :afterId AND delivery_sequence IS NOT NULL AND audience IN (:role, :userRoom, 'all') ORDER BY id LIMIT :limit`, {
    replacements: { afterId, role: user.role, userRoom: `user:${user.id}`, limit }, type: QueryTypes.SELECT,
  });
  return rows.map((row) => ({ type: row.event_type, data: toClientEvent(row) }));
}
async function latestEventId() {
  const [row] = await sequelize.query('SELECT COALESCE(max(id), 0) AS id FROM hms_outbox WHERE delivery_sequence IS NOT NULL', { type: QueryTypes.SELECT });
  return Number(row.id);
}
module.exports = { publish, dispatchOnce, startOutboxDispatcher, eventsSince, latestEventId, latestSequence, eventsPage, allocateSequences };
