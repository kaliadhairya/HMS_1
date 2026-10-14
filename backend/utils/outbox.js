const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { storage } = require('./auditContext');
const { validateSocketSessions } = require('./socketSessions');
const { patientInCare } = require('./careTeam');
const scope = require('../domain/eventScope.cts');
const DISPATCH_EVERY_MS = Number(process.env.OUTBOX_DISPATCH_INTERVAL_MS || 500);
const NO_RETRY = { max: 0 };
const BATCH_SIZE = 200;
// An event names what changed by identifier (completion A8): the payload is
// checked for patient details, and the patient it concerns (explicit, or
// patient_id/patientId in the payload) scopes who receives it.
async function publish(eventType, audience, payload, { transaction, patientId, aggregate, schemaVersion = 1, facilityId } = {}) {
  if (!transaction && !storage.getStore()?.command?.active) throw new Error('Outbox publication requires a domain transaction');
  const body = scope.assertMinimal(eventType, payload);
  await sequelize.query(`INSERT INTO hms_outbox (event_type, audience, payload, request_id, patient_id, schema_version, aggregate_type, aggregate_id, facility_id)
    VALUES (:eventType, :audience, CAST(:payload AS jsonb), :requestId, :patientId, :schemaVersion, :aggregateType, :aggregateId, CAST(:facilityId AS uuid))`, {
    replacements: { eventType, audience, payload: JSON.stringify(body), requestId: storage.getStore()?.requestId ?? null,
      patientId: scope.patientOf(body, patientId), schemaVersion, aggregateType: aggregate?.type ?? null, aggregateId: aggregate ? String(aggregate.id) : null,
      facilityId: facilityId ?? storage.getStore()?.facilityId ?? null }, transaction,
  });
}
const toClientEvent = scope.toClientEvent;
const COLUMNS = 'id, event_type, payload, created_at, delivery_sequence, patient_id, schema_version, aggregate_type, aggregate_id, request_id, facility_id';
// Replay applies the live delivery rule: a doctor sees a patient's events only
// while the patient is in their care.
const IN_SCOPE = "(patient_id IS NULL OR :role <> 'doctor' OR patient_in_care(:userId, patient_id)) AND (facility_id IS NULL OR facility_id = CAST(NULLIF(:facilityId, '') AS uuid))";
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
  const rows = await sequelize.query(`SELECT audience, ${COLUMNS} FROM hms_outbox WHERE delivery_sequence > :cursor ORDER BY delivery_sequence LIMIT :limit`, {
    replacements: { cursor: state.cursor, limit: BATCH_SIZE }, type: QueryTypes.SELECT, retry: NO_RETRY,
  });
  await validateSocketSessions(io);
  const care = new Map();
  for (const row of rows) {
    if (row.patient_id == null && row.facility_id == null) (row.audience === 'all' ? io : io.to(row.audience)).emit(row.event_type, toClientEvent(row));
    else await emitScoped(io, row, care);
    // A changed clinical grant (Codex A2) re-checks that user's live connections at once.
    if (row.event_type === 'clinical.authorization.changed') await recheckSockets(io, row.audience);
    state.cursor = Number(row.delivery_sequence);
  }
  if (rows.length) await sequelize.query('UPDATE hms_outbox SET delivered_at = now() WHERE id IN (:ids) AND delivered_at IS NULL', { replacements: { ids: rows.map((row) => row.id) }, retry: NO_RETRY });
  return rows.length;
}
// A patient's event goes to each recipient socket that may see the patient now
// (care is checked at delivery, so ended care stops delivery at once).
async function emitScoped(io, row, care) {
  const ids = row.audience === 'all' ? [...io.sockets.sockets.keys()] : [...(io.sockets.adapter.rooms.get(row.audience) || [])];
  const event = toClientEvent(row);
  for (const id of ids) {
    const socket = io.sockets.sockets.get(id);
    if (!socket?.user) continue;
    // Facility scope (A2 contract): an event of one facility reaches only sessions bound to it.
    if (row.facility_id && socket.user.facilityId !== row.facility_id) continue;
    if (row.patient_id != null && scope.needsCare(socket.user.role)) {
      const key = `${socket.user.id}:${row.patient_id}`;
      // Checked as that user in their own facility, so database row policies
      // apply exactly as for their API reads (no worker-wide context needed).
      if (!care.has(key)) care.set(key, await storage.run({ requestId: `event-${row.id}`, userId: socket.user.id, sessionId: socket.user.sessionId || null,
        facilityId: socket.user.facilityId || null, facilityTimezone: socket.user.facilityTimezone }, () => patientInCare(socket.user.id, Number(row.patient_id))));
      if (!care.get(key)) continue;
    }
    socket.emit(row.event_type, event);
  }
}
// Sessions of the user named by an authorization change: still a member of
// their session's facility? Otherwise the connection ends (the screen signs
// in again and gets only what it may now see).
async function recheckSockets(io, audience) {
  if (!String(audience).startsWith('user:')) return;
  const { sessionFacility } = require('../services/facilities.cts');
  for (const id of [...(io.sockets.adapter.rooms.get(audience) || [])]) {
    const socket = io.sockets.sockets.get(id);
    if (!socket?.user) continue;
    try { Object.assign(socket.user, await sessionFacility(socket.user)); }
    catch { socket.disconnect(true); }
  }
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
  const rows = await sequelize.query(`SELECT ${COLUMNS} FROM hms_outbox
    WHERE delivery_sequence > :after AND delivery_sequence <= :latest
      AND audience IN (:role, :userRoom, 'all') AND ${IN_SCOPE} ORDER BY delivery_sequence LIMIT :limit`, {
    replacements: { after: afterSequence, latest, role: user.role, userId: user.id, facilityId: user.facilityId || '', userRoom: `user:${user.id}`, limit: limit + 1 }, type: QueryTypes.SELECT,
  });
  const more = rows.length > limit;
  const page = rows.slice(0, limit);
  return { data: page.map((row) => ({ type: row.event_type, data: toClientEvent(row) })),
    next_sequence: more ? Number(page[page.length - 1].delivery_sequence) : latest, latest_sequence: latest, has_more: more };
}
// Compatibility for earlier API clients; new clients use delivery sequences.
async function eventsSince(user, afterId, limit = BATCH_SIZE) {
  const rows = await sequelize.query(`SELECT ${COLUMNS} FROM hms_outbox WHERE id > :afterId AND delivery_sequence IS NOT NULL AND audience IN (:role, :userRoom, 'all') AND ${IN_SCOPE} ORDER BY id LIMIT :limit`, {
    replacements: { afterId, role: user.role, userId: user.id, facilityId: user.facilityId || '', userRoom: `user:${user.id}`, limit }, type: QueryTypes.SELECT,
  });
  return rows.map((row) => ({ type: row.event_type, data: toClientEvent(row) }));
}
async function latestEventId() {
  const [row] = await sequelize.query('SELECT COALESCE(max(id), 0) AS id FROM hms_outbox WHERE delivery_sequence IS NOT NULL', { type: QueryTypes.SELECT });
  return Number(row.id);
}
module.exports = { publish, dispatchOnce, startOutboxDispatcher, eventsSince, latestEventId, latestSequence, eventsPage, allocateSequences };
