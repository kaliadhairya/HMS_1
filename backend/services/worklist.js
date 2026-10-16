// Accountable worklist (migration 0091): problems the system could not finish
// by itself, each with an owner, kept open until someone resolves it with a
// note. Reporting the same open problem again counts an occurrence instead of
// opening a duplicate.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const F = require('./facilities.cts');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };

async function report({ kind, key, title, detail = {}, ownerRole = 'super_admin', patientId = null }, t) {
  const [item] = await rows(`INSERT INTO hms_worklist_items (kind, dedupe_key, title, detail, owner_role, patient_id, facility_id)
    VALUES (:kind, :key, :title, CAST(:detail AS jsonb), :ownerRole, :patientId, :facility)
    ON CONFLICT (facility_id, kind, dedupe_key) WHERE status = 'Open'
    DO UPDATE SET occurrences = hms_worklist_items.occurrences + 1, last_seen_at = now(), detail = EXCLUDED.detail
    RETURNING *`, { kind, key: String(key), title, detail: JSON.stringify(detail), ownerRole, patientId, facility: F.currentFacilityId() }, t);
  return item;
}

const list = ({ status = 'Open', kind = null, role = null, limit = 101, offset = 0 } = {}, t) => rows(`SELECT w.*, a.name AS assigned_to, r.name AS resolved_by
  FROM hms_worklist_items w LEFT JOIN hms_users a ON a.id = w.assigned_user_id LEFT JOIN hms_users r ON r.id = w.resolved_by_user_id
  WHERE w.facility_id=:facility AND (:status::text IS NULL OR w.status = :status) AND (:kind::text IS NULL OR w.kind LIKE :kind)
    AND (:role::text IS NULL OR w.owner_role = :role)
  ORDER BY w.status, w.opened_at,w.id LIMIT :limit OFFSET :offset`, { status: status || null, kind: kind ? `${kind.replace(/[\\_%]/g, '\\$&')}%` : null, role, facility: F.currentFacilityId(), limit, offset }, t);

async function assign(id, userId, actor, t) {
  const [item] = await rows("UPDATE hms_worklist_items SET assigned_user_id = :u WHERE id = :id AND facility_id=:facility AND status = 'Open' RETURNING *", { id, u: userId || actor.id, facility: F.currentFacilityId() }, t);
  if (!item) fail(409, 'This item is not open.', 'NOT_OPEN');
  return item;
}

async function resolve(id, resolution, actor, t) {
  if (!resolution || String(resolution).trim().length < 5) fail(400, 'Say what was done (at least 5 characters).');
  const [item] = await rows(`UPDATE hms_worklist_items SET status = 'Resolved', resolved_at = now(), resolved_by_user_id = :u, resolution = :r
    WHERE id = :id AND facility_id=:facility AND status = 'Open' RETURNING *`, { id, u: actor.id, r: String(resolution).trim(), facility: F.currentFacilityId() }, t);
  if (!item) fail(409, 'This item is not open.', 'NOT_OPEN');
  return item;
}

module.exports = { report, list, assign, resolve };
