// Parsers and acknowledgements for device messages (Phase 6F): HL7 v2 (ORU^R01
// results, as most analyzers send over MLLP) and ASTM E1394 / LIS2-A2 records.
// They only read structure; what a code means comes from the device's
// approved contract (migration 0094), never from guessing.

// ── HL7 v2 ──────────────────────────────────────────────────
function parseHl7(raw) {
  const text = String(raw).replace(/^\x0b|\x1c\r?$/g, '').replace(/\r\n|\n/g, '\r');
  const lines = text.split('\r').filter(Boolean);
  if (!lines[0] || !lines[0].startsWith('MSH')) throw Object.assign(new Error('Not an HL7 v2 message (no MSH segment).'), { code: 'PARSE' });
  const fieldSep = lines[0][3];
  const [comp, rep, esc, sub] = lines[0].slice(4, 8).split('');
  const unescape = (s) => s.replace(new RegExp(`\\${esc}([FSTRE])\\${esc}`, 'g'), (_, c) => ({ F: fieldSep, S: comp, T: sub, R: rep, E: esc })[c]);
  const segments = lines.map((line) => {
    const f = line.split(fieldSep);
    // MSH-1 is the field separator itself, so MSH fields are shifted by one.
    const fields = f[0] === 'MSH' ? ['MSH', fieldSep, ...f.slice(1)] : f;
    return { id: f[0], field: (n) => unescape(fields[n] || ''), comp: (n, c) => unescape((fields[n] || '').split(rep)[0].split(comp)[c - 1] || '') };
  });
  const msh = segments[0];
  return {
    segments, sendingApp: msh.comp(3, 1), sendingFacility: msh.comp(4, 1), type: `${msh.comp(9, 1)}^${msh.comp(9, 2)}`,
    controlId: msh.field(10), version: msh.field(12), fieldSep, comp,
    msh: { sendingApp: msh.field(3), sendingFacility: msh.field(4), receivingApp: msh.field(5), receivingFacility: msh.field(6) },
  };
}

// Results of an ORU^R01: one entry per OBX, with the OBR and PID it belongs to.
function hl7Results(msg) {
  const out = [];
  let pid = null; let obr = null; let groupIndex = 0;
  for (const s of msg.segments) {
    if (s.id === 'PID') pid = { identifier: s.comp(3, 1), name: s.field(5) };
    if (s.id === 'OBR') { groupIndex++; obr = { placer: s.comp(2, 1), filler: s.comp(3, 1), test: s.comp(4, 1) }; }
    if (s.id === 'OBX') {
      out.push({
        groupIndex, setId: s.field(1), valueType: s.field(2), code: s.comp(3, 1), codeText: s.comp(3, 2), value: s.field(5), unit: s.comp(6, 1),
        flag: s.field(8), status: s.field(11), observedAt: s.field(14), instrument: s.comp(18, 1) || msg.sendingApp,
        patientIdentifier: pid?.identifier || null, specimen: obr?.filler || obr?.placer || null, orderTest: obr?.test || null,
      });
    }
  }
  return out;
}

const ts = () => new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
// Application acknowledgement: AA accepted, AE error, AR rejected.
function hl7Ack(msg, code, text = '') {
  const sep = msg?.fieldSep || '|'; const c = msg?.comp || '^';
  const clean = (s) => String(s || '').replace(/[|^~\\&\r\n]/g, ' ').slice(0, 80);
  return [
    ['MSH', `${c}~\\&`, msg?.msh?.receivingApp || 'HMS', msg?.msh?.receivingFacility || 'HMS', msg?.msh?.sendingApp || '', msg?.msh?.sendingFacility || '', ts(), '', `ACK${c}R01${c}ACK`, `ACK${Date.now()}`, 'P', msg?.version || '2.5.1'].join(sep),
    ['MSA', code, msg?.controlId || '', clean(text)].join(sep),
  ].join('\r') + '\r';
}

// MLLP framing for HL7 over TCP.
const MLLP_START = 0x0b; const MLLP_END = Buffer.from([0x1c, 0x0d]);
const frame = (text) => Buffer.concat([Buffer.from([MLLP_START]), Buffer.from(text, 'utf8'), MLLP_END]);
// Splits a TCP stream into complete MLLP messages; returns [messages, rest].
function unframe(buffer) {
  const messages = [];
  let rest = buffer;
  for (;;) {
    const start = rest.indexOf(MLLP_START);
    const end = rest.indexOf(MLLP_END, start + 1);
    if (start < 0 || end < 0) break;
    messages.push(rest.subarray(start + 1, end).toString('utf8'));
    rest = rest.subarray(end + 2);
  }
  return [messages, rest];
}

// ── ASTM E1394 / LIS2-A2 records (after transport framing is removed) ──
function parseAstm(raw) {
  const lines = String(raw).replace(/\r\n|\n/g, '\r').split('\r').map((l) => l.replace(/^\d(?=[HPOR CLMQ])/, '')).filter(Boolean);
  if (!lines[0] || lines[0][0] !== 'H') throw Object.assign(new Error('Not an ASTM message (no header record).'), { code: 'PARSE' });
  const fieldSep = lines[0][1]; const rep = lines[0][2]; const comp = lines[0][3];
  const records = lines.map((l) => { const f = l.split(fieldSep); return { type: f[0][0], field: (n) => (f[n - 1] || ''), comp: (n, c) => ((f[n - 1] || '').split(rep)[0].split(comp)[c - 1] || '') }; });
  const h = records[0];
  return { records, sender: h.comp(5, 1) || h.field(5), controlId: h.field(3) || null, fieldSep, comp };
}
function astmResults(msg) {
  const out = [];
  let patient = null; let order = null; let groupIndex = 0;
  for (const r of msg.records) {
    if (r.type === 'P') patient = { identifier: r.field(3) || r.field(4) || r.field(5) };
    if (r.type === 'O') { groupIndex++; order = { specimen: r.comp(3, 1), test: r.comp(5, 4) || r.comp(5, 1) }; }
    if (r.type === 'R') {
      out.push({ groupIndex, setId: r.field(2), code: r.comp(3, 4) || r.comp(3, 1), codeText: r.comp(3, 5), value: r.field(4), unit: r.comp(5, 1), flag: r.field(7), status: r.field(9), observedAt: r.field(13),
        instrument: r.field(14) || msg.sender, patientIdentifier: patient?.identifier || null, specimen: order?.specimen || null, orderTest: order?.test || null });
    }
  }
  return out;
}

module.exports = { parseHl7, hl7Results, hl7Ack, frame, unframe, parseAstm, astmResults };
