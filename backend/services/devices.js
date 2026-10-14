// Departmental device interfaces (Phase 6F, migration 0094). A device sends
// HL7 v2 or ASTM under an approved, versioned contract. Every message is kept
// exactly as received and accepted once (services/interfaces.js). Analyzer
// results are handed one by one to the Phase 4 analyzer contract (version 1,
// services/laboratoryAnalyzer.js), which keeps them provisional until
// technical review and reconciles anything it cannot match. Codes are mapped
// only through the contract; an unmapped code or a patient that does not
// match the specimen is not guessed: it waits on the worklist.
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const M = require('../utils/deviceMessages');
const I = require('./interfaces');
const W = require('./worklist');
const Analyzer = require('./laboratoryAnalyzer');
const { storage } = require('../utils/auditContext');

// Device messages run as a command of the device's account, like a staff
// command: nested transactions (Phase 4's result write) become savepoints of
// this one, on the same connection, and row changes are attributed to it.
function asDevice(t, userId, fn) {
  const store = storage.getStore() || {};
  const command = { active: true, transaction: t };
  return storage.run({ ...store, requestId: store.requestId || crypto.randomUUID(), userId: userId ?? store.userId ?? null, command }, async () => {
    try { return await fn(); } finally { command.active = false; }
  });
}

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const keyHash = (key) => crypto.createHash('sha256').update(String(key)).digest('hex');

// ── Contracts ───────────────────────────────────────────────
async function draft(body, user, t) {
  const { system, kind, protocol, description, provenance, codeMap = {}, serviceUserId = null, ownerRole, mllpPort = null, allowedHosts = [] } = body;
  if (!/^(analyzer|pacs|bloodbank|theatre|bedside):[a-z0-9._-]{2,60}$/.test(system || '')) fail(400, 'Name the device as kind:name, for example analyzer:sysmex-xn1.');
  for (const [code, m] of Object.entries(codeMap)) {
    if (!m || !m.lab_code_system || !m.lab_code || !m.method) fail(400, `Code ${code}: give lab_code_system, lab_code and method.`);
    const known = await one('SELECT 1 FROM hms_lab_tests WHERE code_system = :s AND code = :c', { s: m.lab_code_system, c: m.lab_code }, t);
    if (!known) fail(422, `Code ${code} maps to ${m.lab_code_system}|${m.lab_code}, which is not in the laboratory catalogue.`, 'UNKNOWN_TEST');
  }
  const [{ v }] = await rows('SELECT COALESCE(max(version), 0) + 1 AS v FROM hms_device_contracts WHERE system = :s', { s: system }, t);
  return one(`INSERT INTO hms_device_contracts (system, version, kind, protocol, description, provenance, code_map, service_user_id, owner_role, mllp_port, allowed_hosts, created_by)
    VALUES (:system, :v, :kind, :protocol, :description, :provenance, CAST(:map AS jsonb), :svc, :owner, :port, CAST(:hosts AS text[]), :u) RETURNING *`,
  { system, v, kind: kind || system.split(':')[0], protocol, description, provenance, map: JSON.stringify(codeMap), svc: serviceUserId, owner: ownerRole || (system.startsWith('analyzer') ? 'lab_technician' : 'super_admin'), port: mllpPort, hosts: `{${allowedHosts.join(',')}}`, u: user.id }, t);
}

// A second person approves; the device key is shown once.
async function approve(id, user, t) {
  const c = await one('SELECT * FROM hms_device_contracts WHERE id = :id FOR UPDATE', { id }, t);
  if (!c) fail(404, 'Contract not found.');
  if (c.status !== 'Draft') fail(409, 'Only a draft can be approved.', 'NOT_DRAFT');
  if (c.created_by === user.id) fail(403, 'A device contract must be approved by someone other than its author.', 'SAME_PERSON');
  if (c.kind === 'analyzer') {
    const svc = await one(`SELECT 1 FROM hms_users u JOIN hms_lab_privileges p ON p.user_id = u.id WHERE u.id = :u AND u.is_active = 1 AND u.role = 'lab_technician'
      AND p.privilege = 'ANALYZER' AND p.revoked_at IS NULL AND p.valid_from <= now() AND p.valid_until > now()`, { u: c.service_user_id }, t);
    if (!svc) fail(422, 'The analyzer account needs a current ANALYZER grant in the laboratory before the contract can go live.', 'NO_ANALYZER_GRANT');
  }
  await rows("UPDATE hms_device_contracts SET status = 'Retired', retired_at = now(), retired_by = :u WHERE system = :s AND status = 'Active'", { s: c.system, u: user.id }, t);
  const key = `dev_${crypto.randomBytes(24).toString('base64url')}`;
  const row = await one("UPDATE hms_device_contracts SET status = 'Active', approved_by = :u, approved_at = now(), api_key_hash = :h WHERE id = :id RETURNING *", { id, u: user.id, h: keyHash(key) }, t);
  return { ...row, api_key_hash: undefined, device_key: key };
}
const retire = (id, user, t) => one("UPDATE hms_device_contracts SET status = 'Retired', retired_at = now(), retired_by = :u WHERE id = :id AND status = 'Active' RETURNING *", { id, u: user.id }, t);
const list = (t) => rows(`SELECT c.id, c.system, c.version, c.kind, c.protocol, c.description, c.provenance, c.code_map, c.owner_role, c.mllp_port, c.allowed_hosts, c.status,
    c.created_at, cu.name AS created_by, au.name AS approved_by, c.approved_at, c.retired_at
  FROM hms_device_contracts c JOIN hms_users cu ON cu.id = c.created_by LEFT JOIN hms_users au ON au.id = c.approved_by ORDER BY c.system, c.version DESC`, {}, t);

// ── Receiving ───────────────────────────────────────────────
async function contractFor(system, { key, host } = {}, t) {
  const c = await one("SELECT * FROM hms_device_contracts WHERE system = :s AND status = 'Active'", { s: system }, t);
  if (!c) fail(404, `No active contract for ${system}.`, 'NO_CONTRACT');
  if (key !== undefined) {
    const a = Buffer.from(keyHash(key)); const b = Buffer.from(c.api_key_hash);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) fail(401, 'Device key refused.', 'BAD_KEY');
  }
  if (host !== undefined && c.allowed_hosts.length && !c.allowed_hosts.includes(host)) fail(401, `Host ${host} is not allowed for ${system}.`, 'HOST_REFUSED');
  return c;
}

// One analyzer result -> the Phase 4 contract body, or a reason it cannot be.
async function toAnalyzerBody(c, msgId, r, t) {
  const map = c.code_map[r.code];
  if (!map) return { problem: `test code ${r.code} is not in contract ${c.system} v${c.version}` };
  if (!r.specimen) return { problem: `result ${r.code} has no specimen identifier` };
  const s = await one('SELECT * FROM hms_lab_specimens WHERE accession = :a', { a: r.specimen }, t);
  if (!s) return { problem: `specimen ${r.specimen} is not known` };
  if (r.patientIdentifier) {
    const p = await one('SELECT id, uhid FROM hms_patients WHERE id = :id', { id: s.patient_id }, t);
    if (p.uhid !== r.patientIdentifier && String(p.id) !== r.patientIdentifier) return { problem: `patient ${r.patientIdentifier} in the message is not the specimen's patient` };
  }
  const items = await rows(`SELECT i.id FROM hms_lab_specimen_links l JOIN hms_investigation_order_items i ON i.id = l.item_id
    JOIN hms_lab_test_versions tv ON tv.id = i.lab_test_version_id JOIN hms_lab_tests tt ON tt.id = tv.test_id
    WHERE l.specimen_id = :s AND tt.code_system = :cs AND tt.code = :code`, { s: s.id, cs: map.lab_code_system, code: map.lab_code }, t);
  if (items.length !== 1) return { problem: `specimen ${r.specimen} has ${items.length ? 'more than one' : 'no'} ordered ${map.lab_code} test` };
  return { body: { contract_version: 1, source: c.system, message_id: `${msgId}:${r.setId || r.code}`, accession: r.specimen, patient_id: s.patient_id, item_id: items[0].id,
    instrument: r.instrument || c.system, run_id: msgId, result: { raw_value: r.value, unit: r.unit, method: map.method } } };
}

// Receives one message. Returns { ack, status } with the device's own
// acknowledgement format. Re-sending the same message gets the same answer.
async function receive(system, raw, auth, t) {
  const c = await contractFor(system, auth, t);
  let parsed; let results;
  try {
    parsed = c.protocol === 'hl7v2' ? M.parseHl7(raw) : M.parseAstm(raw);
    results = c.protocol === 'hl7v2' ? M.hl7Results(parsed) : M.astmResults(parsed);
  } catch (err) {
    const id = `unparsed:${crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 32)}`;
    const { message } = await I.receive({ system, type: 'unparsed', version: `${c.protocol}/v${c.version}`, externalId: id, raw }, t);
    await I.settle(message.id, 'Rejected', { error: err.message }, t);
    return { status: 'Rejected', ack: c.protocol === 'hl7v2' ? M.hl7Ack(null, 'AR', err.message) : { ack: 'NAK', reason: err.message } };
  }
  const msgId = parsed.controlId || `sha:${crypto.createHash('sha256').update(String(raw)).digest('hex').slice(0, 32)}`;
  const { message, duplicate } = await I.receive({ system, type: parsed.type || 'astm', version: `${c.protocol}/v${c.version}`, externalId: msgId, raw }, t);
  if (duplicate) return { status: message.status, duplicate: true, ack: c.protocol === 'hl7v2' ? M.hl7Ack(parsed, message.status === 'Rejected' ? 'AR' : message.status === 'Unmatched' ? 'AE' : 'AA', 'Already received') : { ack: 'ACK', duplicate: true } };

  const problems = [];
  if (c.kind !== 'analyzer') {
    problems.push(`${c.kind} messages are kept for a person to act on`);
  } else {
    const svc = await one('SELECT * FROM hms_users WHERE id = :id', { id: c.service_user_id }, t);
    await asDevice(t, svc.id, async () => {
      for (const r of results) {
        const { body, problem } = await toAnalyzerBody(c, msgId, r, t);
        if (problem) { problems.push(problem); continue; }
        // A savepoint per result: a refused result rolls back alone.
        await sequelize.transaction((sp) => Analyzer.ingest(body, svc, sp)).catch((err) => problems.push(`${r.code}: ${err.message}`));
      }
    });
    if (!results.length) problems.push('the message has no results');
  }
  if (problems.length) {
    await I.settle(message.id, 'Unmatched', { error: problems.join('; ').slice(0, 1000) }, t);
    await W.report({ kind: c.kind === 'analyzer' ? 'interface.unmatched' : 'interface.manual_review', key: `${system}:${msgId}`, title: `${system}: ${problems[0]}${problems.length > 1 ? ` (+${problems.length - 1} more)` : ''}.`, detail: { message_id: message.id, problems }, ownerRole: c.owner_role }, t);
  } else {
    await I.settle(message.id, 'Processed', {}, t);
  }
  const code = problems.length && c.kind === 'analyzer' ? 'AE' : 'AA';
  return { status: problems.length ? 'Unmatched' : 'Processed', problems, ack: c.protocol === 'hl7v2' ? M.hl7Ack(parsed, code, problems[0] || '') : { ack: 'ACK', status: problems.length ? 'held for review' : 'accepted', problems } };
}

// MLLP listeners for active HL7 contracts with a port (DEVICE_MLLP=on).
const net = require('net');
const listeners = new Map();
async function startMllp() {
  if (process.env.DEVICE_MLLP !== 'on') return;
  const active = await rows("SELECT system, mllp_port FROM hms_device_contracts WHERE status = 'Active' AND protocol = 'hl7v2' AND mllp_port IS NOT NULL", {});
  for (const { system, mllp_port: port } of active) {
    if (listeners.has(port)) continue;
    const server = net.createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on('data', async (chunk) => {
        const [messages, rest] = M.unframe(Buffer.concat([buf, chunk])); buf = rest;
        for (const text of messages) {
          try {
            const host = socket.remoteAddress?.replace(/^::ffff:/, '');
            const r = await sequelize.transaction((t) => receive(system, text, { host }, t));
            socket.write(M.frame(r.ack));
          } catch (err) { socket.write(M.frame(M.hl7Ack(null, 'AR', err.message))); }
        }
      });
      socket.on('error', () => {});
    });
    server.listen(port, process.env.DEVICE_MLLP_HOST || '0.0.0.0');
    listeners.set(port, server);
  }
}

module.exports = { draft, approve, retire, list, receive, contractFor, startMllp, keyHash };
