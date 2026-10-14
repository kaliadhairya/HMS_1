// Terminology releases and mappings (Phase 6A). Every code here is a
// synthetic fixture (prefix ZZ), not licensed content. Run after the clinical
// suites: it activates an ICD-10 release, after which diagnoses must use it.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { API, api, apiLogin, sql, runner, assert, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
const tsv = (lines) => Buffer.from(lines.join('\n') + '\n');

async function uploadRelease(token, fields, buffer, key = crypto.randomUUID()) {
  const body = new FormData();
  Object.entries(fields).forEach(([k, v]) => body.append(k, v));
  body.append('file', new Blob([buffer]), `${fields.version}.tsv`);
  const res = await fetch(`${API}/terminology/releases`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': key }, body });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const release = (version, extra = {}) => ({ system: 'ICD10', version, format: 'tsv', source: 'Synthetic e2e fixture, not an ICD-10 edition', licenceAck: 'e2e runner, synthetic content only', ...extra });
const refused = async (text, params = []) => { try { await sql(text, params); return false; } catch { return true; } };

(async () => {
  const { step, done } = runner('Terminology');
  const admin = await apiLogin('admin');
  const sa = await apiLogin('super_admin');
  const doctor = await apiLogin('doctor');
  const lab = await apiLogin('lab_technician');
  const desk = await apiLogin('receptionist');
  const v1File = tsv(['code\tdisplay', `ZZ${tag}.1\tSynthetic condition one`, `ZZ${tag}.2\tSynthetic condition two`, `ZZ${tag}.9\tSynthetic retired condition\tinactive`]);
  let v1, v2, encounterId, legacyDx, codedDx;

  await step('Only administrators load or activate releases; commands need an Idempotency-Key', async () => {
    const asDoctor = await uploadRelease(doctor, release(`E2E-${tag}-x`), v1File);
    const asDesk = await api('GET', '/terminology/systems', { token: desk });
    assert(asDoctor.status === 403 && asDesk.status === 403, `doctor upload ${asDoctor.status}, reception read ${asDesk.status}`);
    const res = await fetch(`${API}/terminology/mappings`, { method: 'POST', headers: { authorization: `Bearer ${lab}`, 'content-type': 'application/json' }, body: '{}' });
    assert(res.status === 428, `missing key gave ${res.status}`);
  });

  await step('A broken file is refused as a whole; nothing is stored', async () => {
    const dup = await uploadRelease(admin, release(`E2E-${tag}-bad`), tsv([`ZZ${tag}.1\tOne`, `ZZ${tag}.1\tOne again`]));
    assert(dup.status === 422 && /appears twice/.test(dup.data.message), `duplicate code: ${dup.status} ${JSON.stringify(dup.data)}`);
    const rows = await sql('SELECT 1 FROM hms_term_releases WHERE version = $1', [`E2E-${tag}-bad`]);
    assert(!rows.length, 'a refused release was stored');
  });

  await step('A release is stored with its checksum and count; the same file or version again is refused', async () => {
    const key = crypto.randomUUID();
    const r = await uploadRelease(admin, release(`E2E-${tag}-1`), v1File, key);
    assert(r.status === 201, `load ${r.status} ${JSON.stringify(r.data)}`);
    v1 = r.data.data;
    assert(v1.status === 'Loaded' && v1.concept_count === 3, `release ${JSON.stringify(v1)}`);
    assert(v1.file_sha256 === crypto.createHash('sha256').update(v1File).digest('hex'), 'checksum is not the file\'s');
    const replay = await uploadRelease(admin, release(`E2E-${tag}-1`), v1File, key);
    assert(replay.status === 201 && replay.data.data.id === v1.id, 'a retried upload did not return the first answer');
    const again = await uploadRelease(admin, release(`E2E-${tag}-1b`), v1File);
    assert(again.status === 409 && again.data.code === 'RELEASE_EXISTS', `same file twice: ${again.status}`);
  });

  await step('Concepts and release identity cannot be changed, added to or deleted', async () => {
    assert(await refused('UPDATE hms_term_concepts SET display = $2 WHERE release_id = $1', [v1.id, 'changed']), 'concept edited');
    assert(await refused('DELETE FROM hms_term_concepts WHERE release_id = $1', [v1.id]), 'concept deleted');
    assert(await refused("INSERT INTO hms_term_concepts (release_id, code, display) VALUES ($1, 'ZZ-LATE', 'Late')", [v1.id]), 'concept added after loading');
    assert(await refused('UPDATE hms_term_releases SET source = $2 WHERE id = $1', [v1.id, 'rewritten source']), 'release source edited');
    assert(await refused('DELETE FROM hms_term_releases WHERE id = $1', [v1.id]), 'release deleted');
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_term_concepts WHERE release_id = $1', [v1.id]);
    assert(n === 3, `${n} concepts`);
  });

  await step('Without an active ICD-10 release, diagnoses are marked as coded against an unknown edition', async () => {
    const active = await sql("SELECT 1 FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE s.code = 'ICD10' AND r.status = 'Active'");
    assert(!active.length, 'this suite needs a database without an active ICD-10 release');
    const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [p] = await sql(`INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate)
      VALUES ($1, $2, 'other', 40, 'Female', 'OPD', CURRENT_DATE) RETURNING id`, [`Synthetic terminology ${tag}`, `TRM-${tag}`]);
    await inCare(p.id);
    const enc = await api('POST', '/hms/encounters', { token: doctor, body: { patient_id: p.id } });
    encounterId = enc.data.id ?? enc.data.data?.id;
    assert(encounterId && doc, `encounter ${enc.status}`);
    const search = await api('GET', '/hms/icd10/search?q=fever', { token: doctor });
    assert(search.status === 200 && search.data.every((r) => r.legacy === true), 'legacy search results not marked');
    const dx = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: encounterId, icd10_code: 'A01.0', icd10_description: 'Typhoid fever' } });
    assert(dx.status === 201 && dx.data.coding_status === 'LEGACY_UNVERSIONED' && !dx.data.term_release_id, `legacy diagnosis ${dx.status} ${JSON.stringify(dx.data)}`);
    legacyDx = dx.data.id;
  });

  await step('Activation is one at a time; replay returns the same answer', async () => {
    const [loaded2] = [await uploadRelease(admin, release(`E2E-${tag}-2`), tsv([`ZZ${tag}.1\tSynthetic condition one`, `ZZ${tag}.3\tSynthetic condition three`]))];
    assert(loaded2.status === 201, `v2 load ${loaded2.status}`);
    v2 = loaded2.data.data;
    const key = crypto.randomUUID();
    const first = await api('POST', `/terminology/releases/${v1.id}/activate`, { token: admin, headers: { 'idempotency-key': key } });
    const replay = await api('POST', `/terminology/releases/${v1.id}/activate`, { token: admin, headers: { 'idempotency-key': key } });
    assert(first.status === 200 && first.data.data.status === 'Active' && replay.status === 200 && replay.data.data.activated_at === first.data.data.activated_at, 'activation replay differs');
    const asDoctor = await api('POST', `/terminology/releases/${v2.id}/activate`, { token: doctor });
    assert(asDoctor.status === 403, `doctor activated: ${asDoctor.status}`);
  });

  await step('With an active release, a diagnosis must use one of its active codes and keeps the release', async () => {
    const search = await api('GET', `/hms/icd10/search?q=ZZ${tag}`, { token: doctor });
    assert(search.data.length === 2 && search.data.every((r) => r.release === `E2E-${tag}-1` && !r.legacy), `search ${JSON.stringify(search.data)}`);
    const unknown = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: encounterId, icd10_code: 'A01.0', icd10_description: 'Typhoid fever' } });
    assert(unknown.status === 422 && unknown.data.code === 'UNKNOWN_CONCEPT', `code outside the release: ${unknown.status}`);
    const inactive = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: encounterId, icd10_code: `ZZ${tag}.9` } });
    assert(inactive.status === 422 && inactive.data.code === 'INACTIVE_CONCEPT', `inactive code: ${inactive.status}`);
    const dx = await api('POST', '/hms/diagnoses', { token: doctor, body: { encounter_id: encounterId, icd10_code: `ZZ${tag}.1`, icd10_description: 'typed by hand', original_text: 'clinician wording' } });
    assert(dx.status === 201 && dx.data.coding_status === 'CODED' && dx.data.term_release_id === v1.id, `coded ${dx.status} ${JSON.stringify(dx.data)}`);
    assert(dx.data.icd10_description === 'Synthetic condition one' && dx.data.original_text === 'clinician wording', 'the release name or the clinician text was lost');
    codedDx = dx.data.id;
    assert(await refused("UPDATE hms_diagnoses SET coding_status = 'CODED' WHERE id = $1", [legacyDx]), 'a legacy diagnosis was marked coded without a release');
  });

  await step('Two simultaneous activations leave exactly one active release; earlier records keep theirs', async () => {
    const [v3] = [await uploadRelease(admin, release(`E2E-${tag}-3`), tsv([`ZZ${tag}.1\tSynthetic condition one`]))];
    const results = await Promise.all([
      api('POST', `/terminology/releases/${v2.id}/activate`, { token: admin }),
      api('POST', `/terminology/releases/${v3.data.data.id}/activate`, { token: sa }),
    ]);
    assert(results.every((r) => r.status === 200), `statuses ${results.map((r) => r.status)}`);
    const active = await sql("SELECT r.id FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE s.code = 'ICD10' AND r.status = 'Active'");
    assert(active.length === 1, `${active.length} active releases`);
    const [old] = await sql('SELECT status FROM hms_term_releases WHERE id = $1', [v1.id]);
    assert(old.status === 'Retired', `v1 is ${old.status}`);
    const back = await api('POST', `/terminology/releases/${v1.id}/activate`, { token: admin });
    assert(back.status === 409 && back.data.code === 'RELEASE_RETIRED', `retired release re-activated: ${back.status}`);
    const [dx] = await sql('SELECT term_release_id, icd10_code FROM hms_diagnoses WHERE id = $1', [codedDx]);
    assert(dx.term_release_id === v1.id, 'the diagnosis lost the release it was coded with');
  });

  await step('A mapping needs a second person; only one approved mapping per local code and system', async () => {
    const proposal = (code, extra = {}) => ({ sourceSystem: 'LOCAL-LAB', sourceCode: `HB-${tag}`, sourceDisplay: 'Haemoglobin (local)', targetSystem: 'ICD10', targetCode: code, relationship: 'related-to', provenance: 'Synthetic e2e mapping fixture', ...extra });
    const bad = await api('POST', '/terminology/mappings', { token: lab, body: proposal('NOT-A-CODE') });
    assert(bad.status === 422 && bad.data.code === 'UNKNOWN_CONCEPT', `unknown target: ${bad.status}`);
    const p1 = await api('POST', '/terminology/mappings', { token: lab, body: proposal(`ZZ${tag}.1`) });
    assert(p1.status === 201 && p1.data.data.status === 'Proposed', `propose ${p1.status} ${JSON.stringify(p1.data)}`);
    const twice = await api('POST', '/terminology/mappings', { token: lab, body: proposal(`ZZ${tag}.1`) });
    assert(twice.status === 409, `same proposal twice: ${twice.status}`);
    const self = await api('POST', `/terminology/mappings/${p1.data.data.id}/review`, { token: lab, body: { decision: 'Approved', reason: 'looks right' } });
    assert(self.status === 403 && self.data.code === 'SAME_PERSON', `self-approval: ${self.status}`);
    const ok = await api('POST', `/terminology/mappings/${p1.data.data.id}/review`, { token: doctor, body: { decision: 'Approved', reason: 'Checked against the lab method sheet' } });
    assert(ok.status === 200 && ok.data.data.status === 'Approved', `approve ${ok.status}`);
    assert(await refused("UPDATE hms_term_mappings SET target_code = 'X' WHERE id = $1", [p1.data.data.id]), 'approved mapping edited');
    assert(await refused('UPDATE hms_term_mappings SET reviewed_by_user_id = proposed_by_user_id WHERE id = $1', [p1.data.data.id]), 'reviewer changed to the proposer');
    // A replacement (to the active release) retires the first on approval.
    const [active] = await sql("SELECT r.id FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE s.code = 'ICD10' AND r.status = 'Active'");
    const [code] = await sql('SELECT code FROM hms_term_concepts WHERE release_id = $1 LIMIT 1', [active.id]);
    const p2 = await api('POST', '/terminology/mappings', { token: doctor, body: proposal(code.code, { relationship: 'equivalent' }) });
    assert(p2.status === 201, `second proposal ${p2.status} ${JSON.stringify(p2.data)}`);
    const ok2 = await api('POST', `/terminology/mappings/${p2.data.data.id}/review`, { token: lab, body: { decision: 'Approved', reason: 'Replaces the earlier mapping' } });
    assert(ok2.status === 200, `second approval ${ok2.status}`);
    const approved = await sql("SELECT id FROM hms_term_mappings WHERE source_system = 'LOCAL-LAB' AND source_code = $1 AND status = 'Approved'", [`HB-${tag}`]);
    assert(approved.length === 1 && approved[0].id === p2.data.data.id, `${approved.length} approved mappings`);
    const list = await api('GET', '/terminology/mappings?status=Retired', { token: doctor });
    assert(list.data.data.some((m) => m.id === p1.data.data.id), 'the replaced mapping is not listed as retired');
  });

  await step('The command-line loader records the named administrator and the file checksum', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-term-'));
    const file = path.join(dir, 'loinc-fixture.csv');
    const content = `"LOINC_NUM","COMPONENT","LONG_COMMON_NAME","STATUS"\n"ZZ${tag}-1","X","Synthetic, quoted ""name"" one","ACTIVE"\n"ZZ${tag}-2","Y","Synthetic two","DEPRECATED"\n`;
    fs.writeFileSync(file, content);
    const r = spawnSync(process.execPath, ['scripts/terminology-load.js', '--system', 'LOINC', '--version', `E2E-${tag}`, '--format', 'loinc-csv', '--file', file,
      '--source', 'Synthetic e2e fixture', '--licence', 'e2e runner, synthetic content only', '--user', 'admin'], { cwd: path.join(__dirname, '../backend'), env: process.env, encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    assert(r.status === 0, `loader failed: ${r.stderr || r.stdout}`);
    const [rel] = await sql("SELECT r.*, u.username FROM hms_term_releases r JOIN hms_users u ON u.id = r.loaded_by_user_id WHERE r.version = $1", [`E2E-${tag}`]);
    assert(rel && rel.username === 'admin' && rel.concept_count === 2 && rel.file_sha256 === crypto.createHash('sha256').update(content).digest('hex'), `loader release ${JSON.stringify(rel)}`);
    const concepts = await sql('SELECT code, display, active FROM hms_term_concepts WHERE release_id = $1 ORDER BY code', [rel.id]);
    assert(concepts[0].display === 'Synthetic, quoted "name" one' && concepts[1].active === false, `parsed ${JSON.stringify(concepts)}`);
    const [audit] = await sql("SELECT actor_user_id FROM audit.row_changes WHERE table_name = 'hms_term_releases' AND row_id = $1 AND operation = 'INSERT'", [rel.id]);
    const [adminUser] = await sql("SELECT id FROM hms_users WHERE username = 'admin'");
    assert(audit && audit.actor_user_id === adminUser.id, 'the load is not attributed to the administrator in the audit log');
  });

  done();
  process.exit();
})();
