// Downtime kit and reconciliation (Phase 6I, migration 0095).
//
// Emergency summaries: on a schedule (DOWNTIME_REFRESH_MINUTES, default 15)
// every admitted patient's identifiers, location, allergies and allergy
// review state, active medicines with doses due, active problems and open
// critical results are written as one printable HTML document, encrypted
// with AES-256-GCM (DOWNTIME_KIT_KEY, 64 hex characters) into
// DOWNTIME_KIT_DIR for wards to keep on a local machine. scripts/downtime-open.js
// opens it without the application and stamps it STALE when it is old.
//
// Downtime episodes: paper records made while the system was unavailable are
// logged with their actual time, entered afterwards through the normal
// screens, linked to what was entered, and checked by a second person.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const W = require('./worklist');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const REFRESH_MIN = () => Number(process.env.DOWNTIME_REFRESH_MINUTES || 15);

function kitKey() {
  const hex = process.env.DOWNTIME_KIT_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(hex)) fail(503, 'DOWNTIME_KIT_KEY (64 hex characters) is not set; the downtime kit is off.', 'KIT_NOT_CONFIGURED');
  const key = Buffer.from(hex, 'hex');
  return { key, id: crypto.createHash('sha256').update(key).digest('hex').slice(0, 12) };
}

// What a clinician needs when the system is down, for every admitted patient.
async function summaries(t, facilityId) {
  const patients = await rows(`SELECT p.id, p.name, p.uhid, p.age, p.gender, p.dob, p.identity_status, a.id AS admission_id, a.admission_date,
      w.name AS ward, b.bed_number, b.room_number, u.name AS doctor
    FROM hms_admissions a JOIN hms_patients p ON p.id = a.patient_id
    LEFT JOIN hms_beds b ON b.id = a.bed_id LEFT JOIN hms_wards w ON w.id = b.ward_id LEFT JOIN hms_users u ON u.id = a.admitting_doctor_id
    WHERE a.status = 'Active' AND a.facility_id = CAST(:f AS uuid) ORDER BY w.name NULLS LAST, b.room_number, b.bed_number, p.name`, { f: facilityId }, t);
  const out = [];
  for (const p of patients) {
    const review = await one('SELECT state, reviewed_at FROM hms_med_allergy_reviews WHERE patient_id = :p', { p: p.id }, t);
    const allergies = await rows(`SELECT COALESCE(a.clinical_text, i.name) AS substance, a.reaction, a.verification_status FROM hms_med_allergies a
      LEFT JOIN hms_med_ingredients i ON i.id = a.ingredient_id WHERE a.patient_id = :p AND a.clinical_status = 'ACTIVE' AND a.verification_status <> 'REFUTED' AND a.verification_status <> 'ENTERED_IN_ERROR'`, { p: p.id }, t);
    const meds = await rows(`SELECT o.state, v.product_snapshot->>'name' AS product, v.dose, v.dose_unit, v.route, v.frequency, v.prn, v.indication, v.ends_at,
        (SELECT min(s.scheduled_at) FROM hms_med_schedules s WHERE s.version_id = v.id AND s.state = 'PENDING' AND s.scheduled_at >= now() - interval '2 hours') AS next_due,
        (SELECT max(ad.actual_at) FROM hms_med_administrations ad WHERE ad.version_id = v.id AND ad.outcome = 'GIVEN') AS last_given
      FROM hms_med_orders o JOIN hms_med_order_versions v ON v.order_id = o.id AND v.version = o.current_version
      WHERE o.patient_id = :p AND o.state IN ('SIGNED', 'HELD') AND v.ends_at > now() ORDER BY o.state, product`, { p: p.id }, t);
    const problems = await rows(`SELECT DISTINCT d.icd10_code, d.icd10_description FROM hms_diagnoses d JOIN hms_encounters e ON e.id = d.encounter_id
      WHERE e.patient_id = :p ORDER BY 1 LIMIT 20`, { p: p.id }, t);
    const critical = await rows(`SELECT tv.name AS test, rv.normalized_value, rv.normalized_unit, ct.state, ct.created_at FROM hms_lab_critical_tasks ct
      JOIN hms_lab_result_versions rv ON rv.id = ct.result_version_id JOIN hms_investigation_order_items i ON i.id = rv.item_id
      JOIN hms_lab_test_versions tv ON tv.id = i.lab_test_version_id WHERE ct.patient_id = :p AND ct.state <> 'CLOSED' ORDER BY ct.created_at DESC`, { p: p.id }, t);
    out.push({ ...p, allergyReview: review?.state || 'UNKNOWN', allergies, meds, problems, critical });
  }
  return out;
}

const REVIEW_TEXT = { UNKNOWN: 'ALLERGY STATUS UNKNOWN', NOT_REVIEWED: 'ALLERGIES NOT REVIEWED', NONE_KNOWN: 'Reviewed: no known allergies', ALLERGIES_RECORDED: 'Allergies recorded' };
function render(list, generatedAt, staleAfter) {
  const t = (d) => (d ? new Date(d).toLocaleString('en-IN', { timeZone: process.env.FACILITY_TZ || 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : '');
  const freq = (f) => (f ? Object.entries(f).map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(', ') : '');
  const patient = (p) => `<section class="pt">
<h2>${esc(p.name)} <small>${esc(p.uhid || '')} · ${esc(p.gender || '')} · ${p.age ?? ''}y${p.identity_status === 'temporary' ? ' · <b>TEMPORARY IDENTITY</b>' : ''}</small></h2>
<p class="loc">${esc(p.ward || 'Ward ?')} · room ${esc(p.room_number || '?')} · bed ${esc(p.bed_number || '?')} · admitted ${t(p.admission_date)} · ${esc(p.doctor || '')}</p>
<p class="alg ${['UNKNOWN', 'NOT_REVIEWED'].includes(p.allergyReview) ? 'warn' : ''}"><b>${REVIEW_TEXT[p.allergyReview] || esc(p.allergyReview)}</b>${p.allergies.length ? `: ${p.allergies.map((a) => `${esc(a.substance)} (${esc(a.reaction)}${a.verification_status === 'UNCONFIRMED' ? ', unconfirmed' : ''})`).join('; ')}` : ''}</p>
${p.critical.length ? `<p class="crit"><b>OPEN CRITICAL RESULTS:</b> ${p.critical.map((c) => `${esc(c.test)} ${esc(c.normalized_value)} ${esc(c.normalized_unit)} (${esc(c.state.toLowerCase())}, ${t(c.created_at)})`).join('; ')}</p>` : ''}
<table><thead><tr><th>Medicine</th><th>Dose</th><th>Route</th><th>How often</th><th>Last given</th><th>Next due</th></tr></thead><tbody>
${p.meds.map((m) => `<tr${m.state === 'HELD' ? ' class="held"' : ''}><td>${esc(m.product)}${m.state === 'HELD' ? ' <b>(HELD)</b>' : ''}${m.prn ? ` <i>PRN: ${esc(m.indication)}</i>` : ''}</td><td>${esc(m.dose)} ${esc(m.dose_unit)}</td><td>${esc(m.route)}</td><td>${esc(freq(m.frequency))}</td><td>${t(m.last_given)}</td><td>${t(m.next_due)}</td></tr>`).join('') || '<tr><td colspan="6">No active medicine orders</td></tr>'}
</tbody></table>
${p.problems.length ? `<p>Problems: ${p.problems.map((d) => esc([d.icd10_code, d.icd10_description].filter(Boolean).join(' '))).join('; ')}</p>` : ''}
</section>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Downtime summary ${esc(generatedAt.toISOString())}</title>
<meta name="hms-generated-at" content="${generatedAt.toISOString()}"><meta name="hms-stale-after" content="${staleAfter.toISOString()}">
<style>body{font:12px/1.4 system-ui,sans-serif;margin:16px;color:#000;background:#fff}h1{font-size:18px}.asof{font-size:16px;border:3px solid #000;padding:8px}
.pt{page-break-inside:avoid;border-top:2px solid #000;margin-top:12px;padding-top:6px}h2{font-size:15px;margin:0}small{font-weight:normal}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #444;padding:2px 4px;text-align:left}.warn,.crit{border:2px solid #000;padding:4px}
.held td{text-decoration:line-through}@media print{.pt{page-break-before:auto}}</style></head><body>
<h1>DOWNTIME SUMMARY — READ ONLY</h1>
<p class="asof">As of <b>${t(generatedAt)}</b>. Anything ordered, given or changed after this time is NOT shown. After ${t(staleAfter)} treat this as <b>STALE</b> and confirm with the ward record.</p>
<p>${list.length} admitted patient(s). Record everything done during downtime on the paper forms; it is entered and checked afterwards.</p>
${list.map(patient).join('\n')}</body></html>`;
}

function encrypt(html, key, keyId, generatedAt, staleAfter) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const meta = { format: 'hms-downtime-1', key_id: keyId, generated_at: generatedAt.toISOString(), stale_after: staleAfter.toISOString() };
  c.setAAD(Buffer.from(JSON.stringify(meta)));
  const ciphertext = Buffer.concat([c.update(html, 'utf8'), c.final()]);
  return { ...meta, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
}
function decryptKit(file, keyHex) {
  const { iv, tag, ciphertext, ...meta } = file;
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(JSON.stringify(meta)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return { meta, html: Buffer.concat([d.update(Buffer.from(ciphertext, 'base64')), d.final()]).toString('utf8') };
}

// One kit per facility (A2): it holds that facility's admitted patients only.
async function snapshot(user = null, facilityId = null) {
  const dir = process.env.DOWNTIME_KIT_DIR;
  if (!dir) fail(503, 'DOWNTIME_KIT_DIR is not set; the downtime kit is off.', 'KIT_NOT_CONFIGURED');
  const { key, id } = kitKey();
  const generatedAt = new Date();
  const staleAfter = new Date(generatedAt.getTime() + 2 * REFRESH_MIN() * 60000);
  const facility = await one('SELECT id, (id = hms_initial_facility()) AS initial FROM hms_facilities WHERE id = CAST(:f AS uuid) AND status = \'ACTIVE\'', { f: facilityId || user?.facilityId || null })
    || await one('SELECT id, true AS initial FROM hms_facilities WHERE id = hms_initial_facility()', {});
  const list = await sequelize.transaction({ isolationLevel: 'REPEATABLE READ' }, (t) => summaries(t, facility.id));
  const sealed = JSON.stringify(encrypt(render(list, generatedAt, staleAfter), key, id, generatedAt, staleAfter));
  const base = `downtime-${generatedAt.toISOString().replace(/[:.]/g, '-')}.hmskit.json`;
  const name = path.join(facility.id, base);
  fs.mkdirSync(path.join(dir, facility.id), { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `${name}.tmp`);
  fs.writeFileSync(tmp, sealed, { mode: 0o600 }); fs.renameSync(tmp, path.join(dir, name));
  // A stable name for wards to open: always the newest kit.
  fs.copyFileSync(path.join(dir, name), path.join(dir, facility.id, 'downtime-latest.hmskit.json'));
  // Single-hospital installs and existing tools open the root copy (the initial facility).
  if (facility.initial) fs.copyFileSync(path.join(dir, name), path.join(dir, 'downtime-latest.hmskit.json'));
  const keep = Number(process.env.DOWNTIME_KEEP || 96);
  const old = fs.readdirSync(path.join(dir, facility.id)).filter((f) => /^downtime-\d.*\.hmskit\.json$/.test(f)).sort().slice(0, -keep);
  old.forEach((f) => fs.rmSync(path.join(dir, facility.id, f), { force: true }));
  return one(`INSERT INTO hms_downtime_snapshots (facility_id, generated_at, stale_after, patient_count, file_name, sha256, key_id, requested_by)
    VALUES (:fac, :g, :s, :n, :f, :sha, :k, :u) RETURNING *`, { fac: facility.id, g: generatedAt, s: staleAfter, n: list.length, f: name, sha: crypto.createHash('sha256').update(sealed).digest('hex'), k: id, u: user?.id || null });
}

async function status(t, facilityId = null) {
  const last = await one('SELECT * FROM hms_downtime_snapshots WHERE facility_id = COALESCE(CAST(:f AS uuid), hms_initial_facility()) ORDER BY generated_at DESC LIMIT 1', { f: facilityId }, t);
  const episode = await one('SELECT * FROM hms_downtime_episodes WHERE closed_at IS NULL ORDER BY started_at DESC LIMIT 1', {}, t);
  return { configured: Boolean(process.env.DOWNTIME_KIT_DIR && /^[0-9a-f]{64}$/i.test(process.env.DOWNTIME_KIT_KEY || '')), refresh_minutes: REFRESH_MIN(), last, stale: !last || new Date(last.stale_after) < new Date(), episode };
}

function startDowntimeKit() {
  if (!process.env.DOWNTIME_KIT_DIR || !/^[0-9a-f]{64}$/i.test(process.env.DOWNTIME_KIT_KEY || '')) return () => {};
  // After each kit, ward machines that hold no current kit go on the worklist (C6).
  // A kit for every active facility, then the ward-machine check.
  // Each facility's kit is made in that facility's context (services/workerContext.cts).
  const tick = () => require('./workerContext.cts').forEachFacility('downtime-kit', (facilityId) => snapshot(null, facilityId))
    .then(() => require('./downtimeStations.cts').checkBehind()
    .catch((err) => console.error('Ward machine check failed:', err.message)), async (err) => {
    console.error('Downtime kit failed:', err.message);
    await W.report({ kind: 'downtime.kit_failed', key: new Date().toISOString().slice(0, 13), title: `The downtime kit could not be refreshed: ${err.message}`, ownerRole: 'super_admin' }).catch(() => {});
  });
  const timer = setInterval(tick, REFRESH_MIN() * 60000);
  timer.unref(); setTimeout(tick, 5000).unref();
  return () => clearInterval(timer);
}

// ── Episodes and paper records ──────────────────────────────
async function declare({ reason, startedAt }, user, t) {
  const at = startedAt ? new Date(startedAt) : new Date();
  if (Number.isNaN(at.getTime()) || at > new Date()) fail(400, 'The start time must be now or in the past.');
  if (await one('SELECT 1 FROM hms_downtime_episodes WHERE ended_at IS NULL', {}, t)) fail(409, 'A downtime is already in progress.', 'ALREADY_OPEN');
  return one('INSERT INTO hms_downtime_episodes (started_at, declared_by, reason) VALUES (:at, :u, :r) RETURNING *', { at, u: user.id, r: reason }, t);
}

async function end(id, user, t) {
  const e = await one('UPDATE hms_downtime_episodes SET ended_at = now(), ended_by = :u WHERE id = :id AND ended_at IS NULL RETURNING *', { id, u: user.id }, t);
  if (!e) fail(409, 'This downtime has already ended.', 'NOT_OPEN');
  await W.report({ kind: 'downtime.reconcile', key: id, title: 'Downtime ended: enter every paper record into the system and have a second person check it, then close the downtime.', ownerRole: 'admin' }, t);
  return e;
}

const KINDS = ['order', 'administration', 'specimen', 'receipt', 'temporary_identity', 'other'];
async function logEntry(episodeId, { kind, patientId, paperReference, occurredAt, summary }, user, t) {
  const e = await one('SELECT * FROM hms_downtime_episodes WHERE id = :id', { id: episodeId }, t);
  if (!e) fail(404, 'Downtime not found.');
  if (e.closed_at) fail(409, 'This downtime is closed.', 'CLOSED');
  if (!KINDS.includes(kind)) fail(400, `kind must be one of ${KINDS.join(', ')}.`);
  const at = new Date(occurredAt);
  if (Number.isNaN(at.getTime()) || at < new Date(e.started_at) - 60000 || (e.ended_at && at > new Date(e.ended_at).getTime() + 60000) || at > new Date()) fail(400, 'The time on the paper record must fall within the downtime.');
  return one(`INSERT INTO hms_downtime_entries (episode_id, kind, patient_id, paper_reference, occurred_at, summary, logged_by)
    VALUES (:e, :k, :p, :ref, :at, :s, :u) RETURNING *`, { e: episodeId, k: kind, p: patientId || null, ref: paperReference, at, s: summary, u: user.id }, t);
}

// The paper record has been entered through the normal screens: link what was
// entered. Where the system can check it, it must match patient and time.
const TARGETS = {
  administration: ['hms_med_administrations', 'actual_at'],
  order: ['hms_med_orders', 'created_at'],
  specimen: ['hms_lab_specimens', 'collected_at'],
  temporary_identity: ['hms_patients', null],
};
async function markEntered(id, { enteredAs }, user, t) {
  const en = await one('SELECT * FROM hms_downtime_entries WHERE id = :id FOR UPDATE', { id }, t);
  if (!en) fail(404, 'Entry not found.');
  if (en.status !== 'Logged') fail(409, `This entry is already ${en.status.toLowerCase()}.`, 'NOT_LOGGED');
  if (!enteredAs || String(enteredAs).trim().length < 1) fail(400, 'Give the identifier of the record that was entered.');
  const target = TARGETS[en.kind];
  if (target) {
    const [table, timeCol] = target;
    const rec = await one(`SELECT * FROM ${table} WHERE id::text = :id`, { id: String(enteredAs) }, t);
    if (!rec) fail(422, `No ${en.kind.replace('_', ' ')} ${enteredAs} in the system.`, 'NOT_FOUND');
    const pid = table === 'hms_patients' ? rec.id : rec.patient_id;
    if (en.patient_id && pid !== en.patient_id) fail(422, 'The entered record belongs to another patient.', 'WRONG_PATIENT');
    // Doses given on paper must be documented with the time they were given.
    if (en.kind === 'administration' && Math.abs(new Date(rec[timeCol]) - new Date(en.occurred_at)) > 5 * 60000) fail(422, 'The administration was not entered with the time on the paper record.', 'WRONG_TIME');
  }
  return one("UPDATE hms_downtime_entries SET status = 'Entered', entered_as = :as, entered_by = :u, entered_at = now() WHERE id = :id RETURNING *", { id, as: String(enteredAs), u: user.id }, t);
}

async function reconcile(id, { note }, user, t) {
  const en = await one('SELECT * FROM hms_downtime_entries WHERE id = :id FOR UPDATE', { id }, t);
  if (!en) fail(404, 'Entry not found.');
  if (en.status !== 'Entered') fail(409, 'Only an entered record can be checked.', 'NOT_ENTERED');
  if ([en.logged_by, en.entered_by].includes(user.id)) fail(403, 'A second person must check what was entered.', 'SAME_PERSON');
  return one("UPDATE hms_downtime_entries SET status = 'Reconciled', reconciled_by = :u, reconciled_at = now(), note = COALESCE(:n, note) WHERE id = :id RETURNING *", { id, u: user.id, n: note || null }, t);
}

async function voidEntry(id, { note }, user, t) {
  if (!note || String(note).trim().length < 5) fail(400, 'Say why the paper record is void.');
  const en = await one("UPDATE hms_downtime_entries SET status = 'Void', note = :n WHERE id = :id AND status IN ('Logged', 'Entered') RETURNING *", { id, n: note }, t);
  if (!en) fail(409, 'This entry cannot be voided.');
  return en;
}

async function close(id, user, t) {
  const e = await one('SELECT * FROM hms_downtime_episodes WHERE id = :id FOR UPDATE', { id }, t);
  if (!e) fail(404, 'Downtime not found.');
  if (!e.ended_at) fail(409, 'End the downtime first.', 'NOT_ENDED');
  if (e.closed_at) fail(409, 'Already closed.', 'CLOSED');
  const [{ n }] = await rows("SELECT count(*)::int AS n FROM hms_downtime_entries WHERE episode_id = :id AND status NOT IN ('Reconciled', 'Void')", { id }, t);
  if (n) fail(409, `${n} paper record(s) are not yet entered and checked.`, 'UNRECONCILED');
  await rows(`UPDATE hms_worklist_items SET status = 'Resolved', resolved_at = now(), resolved_by_user_id = :u, resolution = 'Downtime closed: every paper record entered and checked.'
    WHERE kind = 'downtime.reconcile' AND dedupe_key = :id AND status = 'Open'`, { id, u: user.id }, t);
  return one('UPDATE hms_downtime_episodes SET closed_at = now(), closed_by = :u WHERE id = :id RETURNING *', { id, u: user.id }, t);
}

const episodes = (t) => rows(`SELECT e.*, d.name AS declared_by_name, (SELECT json_agg(x ORDER BY x.occurred_at) FROM (
    SELECT en.*, p.name AS patient_name, lu.name AS logged_by_name, eu.name AS entered_by_name, ru.name AS reconciled_by_name FROM hms_downtime_entries en
    LEFT JOIN hms_patients p ON p.id = en.patient_id JOIN hms_users lu ON lu.id = en.logged_by LEFT JOIN hms_users eu ON eu.id = en.entered_by LEFT JOIN hms_users ru ON ru.id = en.reconciled_by
    WHERE en.episode_id = e.id) x) AS entries
  FROM hms_downtime_episodes e JOIN hms_users d ON d.id = e.declared_by ORDER BY e.started_at DESC LIMIT 50`, {}, t);

module.exports = { summaries, render, encrypt, decryptKit, snapshot, status, startDowntimeKit, declare, end, logEntry, markEntered, reconcile, voidEntry, close, episodes, KINDS };
