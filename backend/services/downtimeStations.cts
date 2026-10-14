// Downtime kit distribution (completion C6, migration 0152).
//
// A ward machine is registered by an administrator and receives a token once
// (HMS keeps only its SHA-256). scripts/downtime-sync.js on the machine pulls
// the newest kit with it and confirms each kit it stored. A machine is
// current while the newest kit it confirmed is not yet stale; one that falls
// behind is put on the worklist. Worklist items close only with a person's
// note, so when the machine catches up its item says so and an administrator
// closes it.
import type { Transaction } from 'sequelize';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { sequelize } = require('../models/db');
const W = require('./worklist');

type Actor = { id: number; role: string };
type Station = { id: string; name: string; location: string; revoked_at: string | null };
type Snapshot = { id: string; file_name: string; sha256: string; generated_at: string; stale_after: string };
const rows = (sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<any[]> =>
  sequelize.query(sql, { replacements, transaction, type: 'SELECT' });
const one = async (sql: string, replacements: Record<string, unknown>, transaction?: Transaction): Promise<any> => (await rows(sql, replacements, transaction))[0] ?? null;
function fail(status: number, message: string, code?: string): never { throw Object.assign(new Error(message), { status, code }); }
const sha256 = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');
const refreshMinutes = (): number => Number(process.env.DOWNTIME_REFRESH_MINUTES || 15);
const BEHIND = 'downtime.station_behind';

function text(v: unknown, label: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < 1 || s.length > 80) fail(400, `Give the machine's ${label} (1 to 80 characters).`, 'INVALID');
  return s;
}

async function register(body: { name?: unknown; location?: unknown }, actor: Actor, t: Transaction) {
  const name = text(body.name, 'name');
  const location = text(body.location, 'ward or department');
  if (await one('SELECT 1 FROM hms_downtime_stations WHERE lower(btrim(name)) = lower(:name) AND revoked_at IS NULL', { name }, t)) {
    fail(409, `A machine named "${name}" is already registered. Revoke it first, or use another name.`, 'DUPLICATE');
  }
  const token = `hdk_${crypto.randomBytes(32).toString('base64url')}`;
  const station = await one(`INSERT INTO hms_downtime_stations (name, location, token_sha256, registered_by)
    VALUES (:name, :location, :hash, :u) RETURNING id, name, location, registered_at`, { name, location, hash: sha256(token), u: actor.id }, t);
  // The token is shown this once; HMS cannot show it again.
  return { station, token };
}

async function revoke(id: string, body: { reason?: unknown }, actor: Actor, t: Transaction) {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length < 5) fail(400, 'Say why the machine is revoked.', 'INVALID');
  const s = await one(`UPDATE hms_downtime_stations SET revoked_at = now(), revoked_by = :u, revoked_reason = :reason
    WHERE id = :id AND revoked_at IS NULL RETURNING id, name, revoked_at`, { id, u: actor.id, reason }, t);
  if (!s) fail(409, 'This machine is already revoked or does not exist.', 'NOT_ACTIVE');
  await rows(`UPDATE hms_worklist_items SET status = 'Resolved', resolved_at = now(), resolved_by_user_id = :u, resolution = 'Machine revoked.'
    WHERE kind = :kind AND dedupe_key = :id AND status = 'Open'`, { kind: BEHIND, id, u: actor.id }, t);
  return s;
}

// Current: holds a kit that is not stale. Waiting: newly registered, inside
// its first two refresh periods. Behind: anything else that is not revoked.
async function list(t?: Transaction) {
  return rows(`SELECT s.id, s.name, s.location, s.registered_at, s.revoked_at, s.revoked_reason, s.last_pull_at,
      r.stored_at AS last_stored_at, r.opened AS last_opened, k.generated_at AS kit_generated_at, k.stale_after AS kit_stale_after,
      CASE WHEN s.revoked_at IS NOT NULL THEN 'Revoked'
           WHEN k.stale_after > now() THEN 'Current'
           WHEN r.id IS NULL AND s.registered_at > now() - make_interval(mins => 2 * :refresh) THEN 'Waiting'
           ELSE 'Behind' END AS state
    FROM hms_downtime_stations s
    LEFT JOIN LATERAL (SELECT * FROM hms_downtime_station_receipts x WHERE x.station_id = s.id ORDER BY x.stored_at DESC LIMIT 1) r ON true
    LEFT JOIN hms_downtime_snapshots k ON k.id = r.snapshot_id
    ORDER BY s.revoked_at IS NOT NULL, s.location, s.name`, { refresh: refreshMinutes() }, t);
}

// Opens or resolves the worklist item for each machine; returns the behind ones.
async function checkBehind(t?: Transaction) {
  const stations = await list(t);
  const behind = stations.filter((s) => s.state === 'Behind');
  for (const s of behind) {
    await W.report({ kind: BEHIND, key: s.id, ownerRole: 'admin',
      title: `Ward machine "${s.name}" (${s.location}) has no current downtime kit${s.last_stored_at ? ` since ${new Date(s.last_stored_at).toISOString()}` : ''}. Check the machine and its scheduled sync.`,
      detail: { station_id: s.id, last_stored_at: s.last_stored_at, last_pull_at: s.last_pull_at } }, t);
  }
  const fine = stations.filter((s) => s.state === 'Current').map((s) => s.id);
  if (fine.length) await markCaughtUp(fine, t);
  return behind;
}

async function markCaughtUp(ids: string[], t?: Transaction) {
  await rows(`UPDATE hms_worklist_items SET detail = detail || jsonb_build_object('caught_up_at', now()), last_seen_at = now()
    WHERE kind = :kind AND dedupe_key IN (:ids) AND status = 'Open' AND detail->>'caught_up_at' IS NULL`, { kind: BEHIND, ids }, t);
}

// The machine presenting this token, if it is registered and not revoked.
async function authenticate(header: unknown): Promise<Station | null> {
  const m = /^Station (hdk_[A-Za-z0-9_-]{43})$/.exec(String(header || ''));
  if (!m) return null;
  return one('SELECT id, name, location, revoked_at FROM hms_downtime_stations WHERE token_sha256 = :h AND revoked_at IS NULL', { h: sha256(m[1]) });
}

// The newest kit, checked against the fingerprint recorded when it was made.
async function latestKit(station: Station) {
  const snap: Snapshot | null = await one('SELECT id, file_name, sha256, generated_at, stale_after FROM hms_downtime_snapshots ORDER BY generated_at DESC LIMIT 1', {});
  await rows('UPDATE hms_downtime_stations SET last_pull_at = now() WHERE id = :id', { id: station.id });
  if (!snap) fail(404, 'No downtime kit has been made yet.', 'NO_KIT');
  const dir = process.env.DOWNTIME_KIT_DIR;
  if (!dir) fail(503, 'The downtime kit is off on this server.', 'KIT_NOT_CONFIGURED');
  let content: string;
  try { content = fs.readFileSync(path.join(dir, snap.file_name), 'utf8'); } catch { fail(503, 'The newest kit file is missing on the server.', 'KIT_MISSING'); }
  if (sha256(content) !== snap.sha256) fail(503, 'The newest kit file does not match its recorded fingerprint; it is not served.', 'KIT_MISMATCH');
  return { snapshot: snap, content };
}

async function acknowledge(station: Station, body: { snapshot_id?: unknown; sha256?: unknown; opened?: unknown }, t: Transaction) {
  const snap = await one('SELECT id, sha256, stale_after FROM hms_downtime_snapshots WHERE id::text = :id', { id: String(body.snapshot_id ?? '') }, t);
  if (!snap) fail(404, 'Unknown kit.', 'NO_KIT');
  if (body.sha256 !== snap.sha256) fail(409, 'The stored kit does not match the kit HMS made.', 'KIT_MISMATCH');
  await rows(`INSERT INTO hms_downtime_station_receipts (station_id, snapshot_id, sha256, opened)
    VALUES (:s, :k, :sha, :opened) ON CONFLICT (station_id, snapshot_id) DO NOTHING`, { s: station.id, k: snap.id, sha: snap.sha256, opened: body.opened === true }, t);
  if (new Date(snap.stale_after) > new Date()) await markCaughtUp([station.id], t);
  return { stored: true, stale_after: snap.stale_after };
}

module.exports = { register, revoke, list, checkBehind, authenticate, latestKit, acknowledge, BEHIND };
