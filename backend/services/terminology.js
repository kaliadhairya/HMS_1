// Terminology releases, concept search and reviewed mappings (Phase 6A,
// migration 0090). Every function runs inside the caller's transaction `t`.
// Releases are loaded from the licensed file as published; nothing here
// invents or edits a code.
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');

const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const run = (sql, replacements, t) => sequelize.query(sql, { replacements, transaction: t });

const FORMATS = ['tsv', 'loinc-csv', 'snomed-rf2'];
const RELATIONSHIPS = ['equivalent', 'source-is-broader-than-target', 'source-is-narrower-than-target', 'related-to'];
const SNOMED_FSN = '900000000000003001';
const BATCH = 5000;

// RFC 4180 CSV (quoted fields, doubled quotes, newlines inside quotes).
function parseCsv(text) {
  const out = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') quoted = false; else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  return out;
}

// The file as concepts: [{ code, display, active }]. A file with a repeated
// code, an empty code or display, or none at all is refused as a whole.
function parseRelease(format, buffer) {
  if (!FORMATS.includes(format)) fail(400, `Unknown file format (use ${FORMATS.join(', ')}).`);
  const text = buffer.toString('utf8').replace(/^﻿/, '');
  let concepts = [];
  if (format === 'tsv') {
    // code <TAB> display [<TAB> active|inactive]; '#' starts a comment line.
    text.split(/\r?\n/).forEach((line, n) => {
      if (!line.trim() || line.startsWith('#')) return;
      const [code, display, state] = line.split('\t').map((s) => (s ?? '').trim());
      if (n === 0 && code.toLowerCase() === 'code') return;
      if (state && !['active', 'inactive'].includes(state)) fail(422, `Line ${n + 1}: third column must be active or inactive.`);
      concepts.push({ code, display, active: state !== 'inactive', line: n + 1 });
    });
  } else if (format === 'loinc-csv') {
    // Loinc.csv as distributed by Regenstrief.
    const [header, ...data] = parseCsv(text);
    const col = (name) => header?.indexOf(name);
    const [num, name, status] = [col('LOINC_NUM'), col('LONG_COMMON_NAME'), col('STATUS')];
    if (num < 0 || name < 0 || status < 0) fail(422, 'Not a Loinc.csv file (needs LOINC_NUM, LONG_COMMON_NAME and STATUS columns).');
    data.forEach((r, n) => concepts.push({ code: (r[num] || '').trim(), display: (r[name] || '').trim(), active: r[status] !== 'DEPRECATED', line: n + 2 }));
  } else {
    // RF2 description snapshot: the active fully specified name of each concept.
    const lines = text.split(/\r?\n/);
    const head = lines[0].split('\t');
    const at = (k) => head.indexOf(k);
    const [active, conceptId, typeId, term] = [at('active'), at('conceptId'), at('typeId'), at('term')];
    if (active < 0 || conceptId < 0 || typeId < 0 || term < 0) fail(422, 'Not an RF2 description file (needs active, conceptId, typeId and term columns).');
    lines.slice(1).forEach((line, n) => {
      if (!line) return;
      const f = line.split('\t');
      if (f[active] === '1' && f[typeId] === SNOMED_FSN) concepts.push({ code: f[conceptId], display: f[term], active: true, line: n + 2 });
    });
  }
  if (!concepts.length) fail(422, 'The file has no concepts.');
  const seen = new Set();
  for (const c of concepts) {
    if (!c.code || !c.display) fail(422, `Line ${c.line}: code and name are both required.`);
    if (c.code.length > 64) fail(422, `Line ${c.line}: code longer than 64 characters.`);
    if (seen.has(c.code)) fail(422, `Line ${c.line}: code ${c.code} appears twice.`);
    seen.add(c.code);
  }
  concepts = concepts.map(({ code, display, active: a }) => ({ code, display, active: a }));
  return concepts;
}

async function systemByCode(code, t) {
  const s = await one('SELECT * FROM hms_term_systems WHERE code = :code', { code }, t);
  if (!s) fail(404, `Unknown code system ${code}.`);
  return s;
}

// Load one release file. The release and all its concepts commit together.
async function loadRelease({ system, version, releasedOn, source, licenceAck, fileName, format, buffer, user }, t) {
  const sys = await systemByCode(system, t);
  if (!version || !String(version).trim()) fail(400, 'Give the release version or edition.');
  if (!source || String(source).trim().length < 5) fail(400, 'Say where the file comes from.');
  if (!licenceAck || String(licenceAck).trim().length < 5) fail(400, 'Record who accepted which licence.');
  const concepts = parseRelease(format, buffer);
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const dup = await one('SELECT version FROM hms_term_releases WHERE system_id = :s AND (version = :v OR file_sha256 = :sha)', { s: sys.id, v: version, sha }, t);
  if (dup) fail(409, `${sys.name} release ${dup.version} is already loaded (same version or same file).`, 'RELEASE_EXISTS');
  const release = await one(`INSERT INTO hms_term_releases (system_id, version, released_on, source, licence_ack, file_name, file_sha256, format, loaded_by_user_id)
    VALUES (:s, :v, :d, :source, :licence, :file, :sha, :format, :u) RETURNING *`,
  { s: sys.id, v: String(version).trim(), d: releasedOn || null, source, licence: licenceAck, file: fileName, sha, format, u: user.id }, t);
  for (let i = 0; i < concepts.length; i += BATCH) {
    const part = concepts.slice(i, i + BATCH);
    await run(`INSERT INTO hms_term_concepts (release_id, code, display, active)
      SELECT :r, * FROM unnest(ARRAY[:codes]::text[], ARRAY[:displays]::text[], ARRAY[:actives]::boolean[])`,
    { r: release.id, codes: part.map((c) => c.code), displays: part.map((c) => c.display), actives: part.map((c) => c.active) }, t);
  }
  return one('UPDATE hms_term_releases SET concept_count = :n WHERE id = :id RETURNING *', { n: concepts.length, id: release.id }, t);
}

// Make a loaded release the active one; the previous active release retires.
async function activateRelease(releaseId, user, t) {
  const release = await one('SELECT * FROM hms_term_releases WHERE id = :id', { id: releaseId }, t);
  if (!release) fail(404, 'Release not found.');
  // One activation per system at a time.
  await rows('SELECT id FROM hms_term_releases WHERE system_id = :s ORDER BY id FOR UPDATE', { s: release.system_id }, t);
  const current = await one('SELECT * FROM hms_term_releases WHERE id = :id', { id: releaseId }, t);
  if (current.status === 'Active') return current;
  if (current.status !== 'Loaded') fail(409, 'A retired release cannot be made active again; load it as a new release.', 'RELEASE_RETIRED');
  await run(`UPDATE hms_term_releases SET status = 'Retired', retired_at = now(), retired_by_user_id = :u
    WHERE system_id = :s AND status = 'Active'`, { s: release.system_id, u: user.id }, t);
  return one(`UPDATE hms_term_releases SET status = 'Active', activated_at = now(), activated_by_user_id = :u
    WHERE id = :id RETURNING *`, { id: releaseId, u: user.id }, t);
}

const activeRelease = (system, t) => one(`SELECT r.*, s.code AS system_code, s.uri AS system_uri, s.name AS system_name
  FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE s.code = :system AND r.status = 'Active'`, { system }, t);

async function listSystems(t) {
  const systems = await rows('SELECT * FROM hms_term_systems ORDER BY code', {}, t);
  const releases = await rows(`SELECT r.*, lu.name AS loaded_by, au.name AS activated_by FROM hms_term_releases r
    JOIN hms_users lu ON lu.id = r.loaded_by_user_id LEFT JOIN hms_users au ON au.id = r.activated_by_user_id
    ORDER BY r.loaded_at DESC`, {}, t);
  return systems.map((s) => ({ ...s, releases: releases.filter((r) => r.system_id === s.id) }));
}

// Search one release (the active one unless named): exact code, code prefix,
// then name similarity. Inactive concepts are found but flagged.
async function search({ system, releaseId, q, limit = 20 }, t) {
  const term = String(q || '').trim();
  if (term.length < 2) return { release: null, concepts: [] };
  const release = releaseId
    ? await one(`SELECT r.*, s.code AS system_code, s.uri AS system_uri FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE r.id = :id`, { id: releaseId }, t)
    : await activeRelease(system, t);
  if (!release) return { release: null, concepts: [] };
  const concepts = await rows(`SELECT code, display, active FROM hms_term_concepts
    WHERE release_id = :r AND (code ILIKE :prefix OR display ILIKE :contains)
    ORDER BY (upper(code) = upper(:q)) DESC, (code ILIKE :prefix) DESC, similarity(display, :q) DESC, code
    LIMIT :limit`,
  { r: release.id, q: term, prefix: `${term.replace(/[\\%_]/g, '\\$&')}%`, contains: `%${term.replace(/[\\%_]/g, '\\$&')}%`, limit: Math.min(Number(limit) || 20, 50) }, t);
  return { release: { id: release.id, system: release.system_code, uri: release.system_uri, version: release.version }, concepts };
}

const concept = (releaseId, code, t) => one('SELECT * FROM hms_term_concepts WHERE release_id = :r AND code = :c', { r: releaseId, c: code }, t);

// ── Mappings ────────────────────────────────────────────────
async function proposeMapping({ sourceSystem, sourceCode, sourceDisplay, targetSystem, targetCode, relationship, provenance }, user, t) {
  if (!/^LOCAL-[A-Z0-9-]{2,40}$/.test(sourceSystem || '')) fail(400, 'Local code systems are named LOCAL-<NAME>, for example LOCAL-LAB.');
  if (!sourceCode || !sourceDisplay) fail(400, 'Give the local code and its name.');
  if (!RELATIONSHIPS.includes(relationship)) fail(400, `Relationship must be one of ${RELATIONSHIPS.join(', ')}.`);
  if (!provenance || String(provenance).trim().length < 5) fail(400, 'Say what the mapping is based on.');
  const release = await activeRelease(targetSystem, t);
  if (!release) fail(409, `${targetSystem} has no active release to map to.`, 'NO_ACTIVE_RELEASE');
  const target = await concept(release.id, targetCode, t);
  if (!target) fail(422, `${targetCode} is not in ${release.system_name} ${release.version}.`, 'UNKNOWN_CONCEPT');
  if (!target.active) fail(422, `${targetCode} is inactive in ${release.system_name} ${release.version}.`, 'INACTIVE_CONCEPT');
  const open = await one(`SELECT id FROM hms_term_mappings WHERE source_system = :ss AND source_code = :sc AND target_system_id = :ts
    AND target_code = :tc AND status = 'Proposed'`, { ss: sourceSystem, sc: sourceCode, ts: release.system_id, tc: targetCode }, t);
  if (open) fail(409, 'The same mapping is already waiting for review.', 'MAPPING_PENDING');
  return one(`INSERT INTO hms_term_mappings (source_system, source_code, source_display, target_system_id, target_release_id, target_code, relationship, provenance, proposed_by_user_id)
    VALUES (:ss, :sc, :sd, :ts, :tr, :tc, :rel, :prov, :u) RETURNING *`,
  { ss: sourceSystem, sc: sourceCode, sd: sourceDisplay, ts: release.system_id, tr: release.id, tc: targetCode, rel: relationship, prov: provenance, u: user.id }, t);
}

async function reviewMapping(id, { decision, reason }, user, t) {
  const m = await one('SELECT * FROM hms_term_mappings WHERE id = :id FOR UPDATE', { id }, t);
  if (!m) fail(404, 'Mapping not found.');
  if (decision === 'Retired') {
    if (m.status !== 'Approved') fail(409, 'Only an approved mapping can be retired.', 'NOT_APPROVED');
    return one(`UPDATE hms_term_mappings SET status = 'Retired', retired_at = now(), retired_by_user_id = :u WHERE id = :id RETURNING *`, { id, u: user.id }, t);
  }
  if (!['Approved', 'Rejected'].includes(decision)) fail(400, 'Decision must be Approved, Rejected or Retired.');
  if (m.status !== 'Proposed') fail(409, `This mapping was already ${m.status.toLowerCase()}.`, 'ALREADY_REVIEWED');
  if (m.proposed_by_user_id === user.id) fail(403, 'A mapping must be reviewed by someone other than the person who proposed it.', 'SAME_PERSON');
  if (!reason || String(reason).trim().length < 3) fail(400, 'Give a reason for the decision.');
  if (decision === 'Approved') {
    // An approved mapping for the same local code and target system retires first.
    await run(`UPDATE hms_term_mappings SET status = 'Retired', retired_at = now(), retired_by_user_id = :u
      WHERE source_system = :ss AND source_code = :sc AND target_system_id = :ts AND status = 'Approved'`,
    { ss: m.source_system, sc: m.source_code, ts: m.target_system_id, u: user.id }, t);
  }
  return one(`UPDATE hms_term_mappings SET status = :d, reviewed_at = now(), reviewed_by_user_id = :u, review_reason = :reason
    WHERE id = :id RETURNING *`, { id, d: decision, u: user.id, reason }, t);
}

const listMappings = ({ status } = {}, t) => rows(`SELECT m.*, s.code AS target_system, s.uri AS target_uri, r.version AS target_version, c.display AS target_display,
    pu.name AS proposed_by, ru.name AS reviewed_by
  FROM hms_term_mappings m JOIN hms_term_systems s ON s.id = m.target_system_id JOIN hms_term_releases r ON r.id = m.target_release_id
  JOIN hms_term_concepts c ON c.release_id = m.target_release_id AND c.code = m.target_code
  JOIN hms_users pu ON pu.id = m.proposed_by_user_id LEFT JOIN hms_users ru ON ru.id = m.reviewed_by_user_id
  WHERE (:status::text IS NULL OR m.status = :status) ORDER BY m.proposed_at DESC LIMIT 500`, { status: status || null }, t);

// The approved standard coding of a local code, for exchange (6B).
const approvedMapping = (sourceSystem, sourceCode, targetSystem, t) => one(`SELECT m.target_code AS code, c.display, s.uri AS system, r.version
  FROM hms_term_mappings m JOIN hms_term_systems s ON s.id = m.target_system_id JOIN hms_term_releases r ON r.id = m.target_release_id
  JOIN hms_term_concepts c ON c.release_id = m.target_release_id AND c.code = m.target_code
  WHERE m.source_system = :ss AND m.source_code = :sc AND s.code = :ts AND m.status = 'Approved'`, { ss: sourceSystem, sc: sourceCode, ts: targetSystem }, t);

module.exports = {
  fail, FORMATS, RELATIONSHIPS, parseCsv, parseRelease, loadRelease, activateRelease, activeRelease, listSystems, search, concept,
  proposeMapping, reviewMapping, listMappings, approvedMapping,
};
