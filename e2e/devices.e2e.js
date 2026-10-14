// Device interfaces (Phase 6F): approved contracts, HL7 v2 over HTTP and
// MLLP, acknowledgements, once-only acceptance, and nothing guessed. Analyzer
// results reach the Phase 4 analyzer contract and stay provisional. All codes,
// devices and values are synthetic.
const crypto = require('crypto');
const net = require('net');
const { API, api, apiLogin, sql, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 6);
const tokens = {};
const req = (method, path, role, body, revision) => api(method, path, { token: tokens[role], body, headers: revision !== undefined ? { 'if-match': String(revision) } : {} });
const ok = (r, n = 200) => { assert(r.status === n, `${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`); return r.data.data; };
async function device(system, key, text) {
  const r = await fetch(`${API}/device-messages/${system}`, { method: 'POST', headers: { 'content-type': 'x-application/hl7-v2+er7', 'x-device-key': key }, body: text });
  return { status: r.status, text: await r.text() };
}
const msa = (ack) => ack.split('\r').find((l) => l.startsWith('MSA'))?.split('|') || [];
const oru = ({ control, accession, code = `GLU${tag}`, value = '5.4', patient = '' }) => [
  `MSH|^~\\&|SYNTH-ANALYZER|LAB|HMS|HOSP|20261014120000||ORU^R01|${control}|P|2.5.1`,
  `PID|1||${patient}`, `OBR|1||${accession}|${code}`, `OBX|1|NM|${code}^Synthetic||${value}|TEST-U||N|||F|||20261014115500||||SN-${tag}`].join('\r');

(async () => {
  const { step, done } = runner('Device interfaces');
  let pid, test, spec, key, system, labId;

  await step('Set up a coded test, an order and a received specimen; the analyzer account has an ANALYZER grant', async () => {
    for (const role of ['doctor', 'lab_technician', 'super_admin', 'admin']) tokens[role] = await apiLogin(role);
    const [{ id: uid }] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    [{ id: labId }] = await sql("SELECT id FROM hms_users WHERE username = 'labtech'");
    [{ id: pid }] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 30, 'Male', 'OPD', CURRENT_DATE) RETURNING id", [`Synthetic device ${tag}`, `DEV-${tag}`]);
    await inCare(pid);
    const [{ id: eid }] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Draft') RETURNING id", [pid, uid]);
    for (const p of ['CONTENT', 'ANALYZER']) ok(await req('POST', '/laboratory/privileges', 'super_admin', { user_id: labId, privilege: p, reason: 'Synthetic device fixture', valid_from: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 864e5).toISOString() }), 201);
    test = ok(await req('POST', '/laboratory/catalogue', 'lab_technician', { code_system: 'TEST-DEV', code: `GLU-${tag}`, kind: 'TEST', name: `Synthetic glucose ${tag}`, section: 'TEST', unit: 'TEST-U', method: 'TEST-METHOD',
      provenance: 'Synthetic device fixture only', effective_at: new Date(Date.now() - 1000).toISOString(), requirements: [{ specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE' }] }), 201);
    const order = ok(await req('POST', '/laboratory/orders', 'doctor', { patient_id: pid, encounter_id: eid, test_version_ids: [test.id] }), 201);
    const [rq] = await sql('SELECT id FROM hms_lab_requirements WHERE test_version_id = $1', [test.id]);
    spec = ok(await req('POST', '/laboratory/specimens', 'lab_technician', { patient_id: pid, specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE', location: 'TEST', links: [{ item_id: order.items[0].id, requirement_id: rq.id }] }), 201);
    for (const state of ['COLLECTED', 'RECEIVED']) spec = ok(await req('POST', `/laboratory/specimens/${spec.id}/transition`, 'lab_technician', { patient_id: pid, accession: spec.accession, state, location: 'TEST', reason: 'Synthetic custody' }, spec.revision));
  });

  await step('A contract maps device codes only to catalogue tests and needs a second person to approve; the key is shown once', async () => {
    system = `analyzer:synth-${tag}`;
    const bad = await req('POST', '/devices', 'lab_technician', { system, protocol: 'hl7v2', description: 'Synthetic analyzer', provenance: 'Synthetic interface manual v1', codeMap: { X: { lab_code_system: 'TEST-DEV', lab_code: 'NOPE', method: 'M' } }, serviceUserId: labId });
    assert(bad.status === 422, `unknown catalogue code accepted: ${bad.status}`);
    const draft = ok(await req('POST', '/devices', 'lab_technician', { system, protocol: 'hl7v2', description: 'Synthetic analyzer', provenance: 'Synthetic interface manual v1', serviceUserId: labId, mllpPort: 25000 + (parseInt(tag, 16) % 1000),
      codeMap: { [`GLU${tag}`]: { lab_code_system: 'TEST-DEV', lab_code: `GLU-${tag}`, method: 'TEST-METHOD' } } }), 201);
    assert((await req('POST', `/devices/${draft.id}/approve`, 'lab_technician')).status === 403, 'author approved their own contract');
    const approved = ok(await req('POST', `/devices/${draft.id}/approve`, 'admin'));
    key = approved.device_key;
    assert(key && approved.status === 'Active', 'no device key');
    const listed = ok(await req('GET', '/devices', 'admin'));
    assert(!JSON.stringify(listed).includes(key) && !JSON.stringify(listed).includes('api_key_hash'), 'the key or its hash is listed');
    let edited = false;
    try { await sql("UPDATE hms_device_contracts SET code_map = '{}' WHERE id = $1", [draft.id]); } catch { edited = true; }
    assert(edited, 'an approved contract was changed');
  });

  await step('A result reaches the laboratory as a provisional analyzer result and is acknowledged AA', async () => {
    assert((await device(system, 'wrong-key', oru({ control: `C1-${tag}`, accession: spec.accession }))).status === 401, 'wrong device key accepted');
    assert((await device(`analyzer:nobody-${tag}`, key, 'MSH|x')).status === 404, 'device without a contract accepted');
    const r = await device(system, key, oru({ control: `C1-${tag}`, accession: spec.accession, patient: `DEV-${tag}` }));
    assert(r.status === 200 && msa(r.text)[1] === 'AA' && msa(r.text)[2] === `C1-${tag}`, `ack ${r.status} ${r.text}`);
    const results = await sql("SELECT rv.source, rv.raw_value FROM hms_lab_result_versions rv JOIN hms_lab_specimens s ON s.id = rv.specimen_id WHERE s.id = $1", [spec.id]);
    assert(results.length === 1 && results[0].source === 'ANALYZER' && results[0].raw_value === '5.4', `results ${JSON.stringify(results)}`);
    const [m] = await sql("SELECT status, contract_version FROM hms_interface_messages WHERE system = $1 AND external_id = $2", [system, `C1-${tag}`]);
    assert(m.status === 'Processed' && m.contract_version === 'hl7v2/v1', `message ${JSON.stringify(m)}`);
  });

  await step('The same message again gets the same answer and no second result; the same ID with other content is refused', async () => {
    const again = await device(system, key, oru({ control: `C1-${tag}`, accession: spec.accession, patient: `DEV-${tag}` }));
    assert(msa(again.text)[1] === 'AA', `repeat ack ${again.text}`);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_lab_result_versions WHERE specimen_id = $1', [spec.id]);
    assert(n === 1, `${n} results after a repeat`);
    const changed = await device(system, key, oru({ control: `C1-${tag}`, accession: spec.accession, value: '9.9' }));
    assert(changed.status === 409, `same ID, other content: ${changed.status}`);
  });

  await step('Unmapped codes, unknown specimens and a different patient are held for a person, never guessed', async () => {
    const cases = [oru({ control: `C2-${tag}`, accession: spec.accession, code: 'UNMAPPED' }), oru({ control: `C3-${tag}`, accession: `NOSUCH-${tag}` }), oru({ control: `C4-${tag}`, accession: spec.accession, patient: 'SOMEONE-ELSE' })];
    for (const text of cases) {
      const r = await device(system, key, text);
      assert(msa(r.text)[1] === 'AE', `held message acknowledged ${msa(r.text)[1]}`);
    }
    const held = await sql("SELECT external_id, status FROM hms_interface_messages WHERE system = $1 AND status = 'Unmatched'", [system]);
    assert(held.length === 3, `${held.length} held messages`);
    const items = await sql("SELECT owner_role FROM hms_worklist_items WHERE kind = 'interface.unmatched' AND status = 'Open' AND dedupe_key LIKE $1", [`${system}:%`]);
    assert(items.length === 3 && items.every((i) => i.owner_role === 'lab_technician'), `worklist ${JSON.stringify(items)}`);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_lab_result_versions WHERE specimen_id = $1', [spec.id]);
    assert(n === 1, 'a held message wrote a result');
    const garbage = await device(system, key, 'this is not HL7');
    assert(msa(garbage.text)[1] === 'AR', `garbage acknowledged ${garbage.text}`);
  });

  await step('MLLP: framed HL7 over TCP is acknowledged in the same frame format', async () => {
    const [{ mllp_port: port }] = await sql("SELECT mllp_port FROM hms_device_contracts WHERE system = $1 AND status = 'Active'", [system]);
    await sleep(500);
    const ack = await new Promise((resolve, reject) => {
      const s = net.connect(port, '127.0.0.1', () => s.write(Buffer.concat([Buffer.from([0x0b]), Buffer.from(oru({ control: `M1-${tag}`, accession: spec.accession, code: 'UNMAPPED' })), Buffer.from([0x1c, 0x0d])])));
      let buf = Buffer.alloc(0);
      s.on('data', (d) => { buf = Buffer.concat([buf, d]); if (buf.includes(Buffer.from([0x1c, 0x0d]))) { s.end(); resolve(buf); } });
      s.on('error', reject); setTimeout(() => reject(new Error('no MLLP answer')), 8000);
    });
    assert(ack[0] === 0x0b && msa(ack.subarray(1, ack.length - 2).toString())[2] === `M1-${tag}`, `MLLP ack ${ack.toString()}`);
  });

  await step('Other device kinds are kept for a person to act on; a retired contract receives nothing', async () => {
    const bedside = `bedside:monitor-${tag}`;
    const d = ok(await req('POST', '/devices', 'admin', { system: bedside, protocol: 'hl7v2', description: 'Synthetic bedside monitor', provenance: 'Synthetic manual v2', ownerRole: 'nurse' }), 201);
    const b = ok(await req('POST', `/devices/${d.id}/approve`, 'super_admin'));
    const r = await device(bedside, b.device_key, oru({ control: `B1-${tag}`, accession: 'NA' }));
    assert(msa(r.text)[1] === 'AA', `bedside ack ${r.text}`);
    assert((await sql("SELECT 1 FROM hms_worklist_items WHERE kind = 'interface.manual_review' AND owner_role = 'nurse' AND dedupe_key = $1", [`${bedside}:B1-${tag}`])).length === 1, 'bedside message not on the nursing worklist');
    ok(await req('POST', `/devices/${d.id}/retire`, 'admin'));
    assert((await device(bedside, b.device_key, oru({ control: `B2-${tag}`, accession: 'NA' }))).status === 404, 'a retired contract received a message');
  });

  done();
  process.exit();
})();
