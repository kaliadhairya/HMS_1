// Private documents and data keys (completion A4): who may reach a
// patient's documents, malicious and wrong uploads, encryption at rest and
// integrity on download, quarantine when the scanner is down, legal hold and
// retention, Aadhaar written and read with one scheme, and key rotation with
// re-encryption. Needs HMS_DATA_KEYS and HMS_DOCUMENT_DIR on the API.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const SECOND_PORT = process.env.E2E_SECOND_PORT || '15103';
const DIR = process.env.HMS_DOCUMENT_DIR;
const tag = crypto.randomUUID().slice(0, 8);
const pdf = (body) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${body}\n%%EOF\n`, 'latin1');

async function upload(token, patientId, bytes, name, docType = 'Report', base = API) {
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  form.append('docType', docType);
  const res = await fetch(`${base}/patients/hms/${patientId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() }, body: form });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function download(token, patientId, docId, base = API) {
  const res = await fetch(`${base}/patients/hms/${patientId}/documents/${docId}/content`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) };
}
function startServer(extraEnv) {
  const child = spawn('node', ['server.js'], { cwd: BACKEND, env: { ...process.env, PORT: SECOND_PORT, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '', ...extraEnv } });
  const out = [];
  child.stdout.on('data', (d) => out.push(String(d))); child.stderr.on('data', (d) => out.push(String(d)));
  child.log = () => out.join('');
  child.exited = new Promise((r) => child.on('exit', r));
  return child;
}
async function ready(child) {
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) return false;
    if (await fetch(`http://127.0.0.1:${SECOND_PORT}/api/ready`).then((r) => r.ok).catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}
const rekey = (keys) => new Promise((resolve) => execFile('node', ['scripts/rekey-data.js'], { cwd: BACKEND, env: { ...process.env, HMS_DATA_KEYS: keys } }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr, json: stdout })));

(async () => {
  const { step, done } = runner('Private documents and data keys');
  assert(DIR && process.env.HMS_DATA_KEYS, 'run with HMS_DOCUMENT_DIR and HMS_DATA_KEYS set for the API');
  const desk = await apiLogin('receptionist');
  const doctor = await apiLogin('doctor');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');
  const reg = await api('POST', '/patients/hms', { token: desk, body: { patientType: 'other', name: `Document patient ${tag}`, age: 35, gender: 'Female', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `97${String(Date.now()).slice(-8)}`, aadhaar: '123456789012' } });
  assert(reg.status === 201, `patient ${reg.status} ${JSON.stringify(reg.data).slice(0, 160)}`);
  const patient = reg.data.data;
  const marker = `CONFIDENTIAL-${tag}`;
  let good;

  await step('Aadhaar is written and read with one scheme: stored encrypted under the active key, shown masked', async () => {
    const [row] = await sql('SELECT aadhaar FROM hms_patients WHERE id = $1', [patient.id]);
    assert(/^hk2:cfa:/.test(row.aadhaar) && !row.aadhaar.includes('123456789012'), `stored ${row.aadhaar.slice(0, 12)}`);
    const shown = await api('GET', `/patients/hms/${patient.id}`, { token: desk });
    const text = JSON.stringify(shown.data);
    assert(text.includes('XXXX-XXXX-9012') && !text.includes('123456789012') && !text.includes(row.aadhaar), `masked ${text.match(/aadhaar[^,]*/gi)}`);
  });

  await step('A PDF is stored encrypted, checked, and comes back byte for byte to staff who may see the patient', async () => {
    const r = await upload(desk, patient.id, pdf(marker), 'discharge summary.pdf', 'Discharge');
    assert(r.status === 201 && r.data.data.state === 'Available' && r.data.data.media_type === 'application/pdf', `upload ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    good = r.data.data;
    assert(good.scan.engine === 'clamav' && good.scan.result === 'clean', `scan ${JSON.stringify(good.scan)}`);
    assert(good.retain_until && new Date(good.retain_until) > new Date(Date.now() + 9 * 365 * 86400000), `retention ${good.retain_until}`);
    const [row] = await sql('SELECT storage_key, key_id FROM hms_patient_documents WHERE id = $1', [good.id]);
    const onDisk = fs.readFileSync(path.join(DIR, row.storage_key));
    assert(row.key_id === 'cfa' && !onDisk.includes(Buffer.from(marker)), 'the file is readable on disk');
    assert(!fs.readdirSync(path.join(DIR, 'incoming')).length, 'an upload was left in the incoming folder');
    await inCare(patient.id);
    const d = await download(doctor, patient.id, good.id);
    assert(d.status === 200 && d.bytes.equals(pdf(marker)), `download ${d.status}`);
    assert(d.headers.get('x-content-type-options') === 'nosniff' && /attachment/.test(d.headers.get('content-disposition')), 'unsafe download headers');
    const audit = await sql("SELECT 1 FROM hms_audit_logs WHERE module = 'patient_document' AND action = 'READ' AND record_id = $1", [good.id]);
    assert(audit.length === 1, `download audit rows ${audit.length}`);
  });

  await step('Only staff who may see the patient reach the documents', async () => {
    const [other] = await sql("SELECT id FROM hms_users WHERE role = 'doctor' AND username <> 'doctor' AND is_active = 1 ORDER BY id LIMIT 1");
    const pharmacist = await apiLogin('pharmacist');
    assert((await download(pharmacist, patient.id, good.id)).status === 403, 'a pharmacist opened a patient document');
    assert((await fetch(`${API}/patients/hms/${patient.id}/documents/${good.id}/content`)).status === 401, 'opened without signing in');
    assert((await api('GET', `/patients/hms/${patient.id}/documents`, { token: pharmacist })).status === 403, 'pharmacist listed documents');
    // A doctor without the patient in their care is refused (care team removed for the test).
    const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [assignment] = await sql('SELECT id FROM hms_care_team_assignments WHERE patient_id = $1 AND practitioner_user_id = $2 AND valid_to IS NULL', [patient.id, doctorUser.id]);
    assert((await api('POST', `/patients/hms/${patient.id}/care-team/${assignment.id}/end`, { token: admin, body: { reason: 'Documents test: care handed over' } })).status === 200, 'end care');
    assert((await download(doctor, patient.id, good.id)).status === 403, 'a doctor outside the care team opened a document');
    await inCare(patient.id);
    assert((await download(doctor, 999999999, good.id)).status >= 403, 'a document opened under another patient');
    void other;
  });

  await step('Documents of another facility stay inaccessible even when the patient identity is shared',async()=>{
    const [facility]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic foreign document facility','UTC') RETURNING id",['DOC-'+tag]);
    const [foreign]=await sql(`INSERT INTO hms_patient_documents(patient_id,file_name,doc_type,uploaded_by,uploaded_at,sha256,size_bytes,media_type,state,key_id,storage_key,retain_until,facility_id)
      SELECT patient_id,file_name,doc_type,uploaded_by,uploaded_at,sha256,size_bytes,media_type,state,key_id,NULL,retain_until,$2 FROM hms_patient_documents WHERE id=$1 RETURNING id,sha256`,[good.id,facility.id]);
    const objectKey=`${new Date().getUTCFullYear()}/${crypto.randomUUID()}.hmsdoc`,file=path.join(DIR,objectKey);
    fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});fs.writeFileSync(file,require('../backend/services/dataKeys.cts').encryptBlob(pdf(marker),`patient-document:${foreign.id}:${foreign.sha256}`),{mode:0o600});
    await sql('UPDATE hms_patient_documents SET storage_key=$1 WHERE id=$2',[objectKey,foreign.id]);
    const list=await api('GET',`/patients/hms/${patient.id}/documents`,{token:desk});
    assert(list.status===200&&!list.data.data.some(d=>d.id===foreign.id),'Foreign-facility document listed');
    assert((await download(desk,patient.id,foreign.id)).status===404,'Foreign-facility document opened');
    assert((await api('POST',`/patients/hms/${patient.id}/documents/${foreign.id}/withdraw`,{token:desk,body:{reason:'Must not affect foreign document'}})).status===404,'Foreign-facility document withdrawn');
    assert((await api('POST',`/patients/hms/${patient.id}/documents/${foreign.id}/legal-hold`,{token:admin,body:{hold:true,reason:'Must not affect foreign legal hold'}})).status===404,'Foreign-facility legal hold changed');
  });

  await step('Wrong and malicious files are refused: by content, active PDF content, and size', async () => {
    const exe = await upload(desk, patient.id, Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(200)]), 'scan.pdf');
    assert(exe.status === 415 && exe.data.code === 'UNSUPPORTED_TYPE', `renamed program ${exe.status}`);
    const js = await upload(desk, patient.id, pdf('/OpenAction << /S /JavaScript /JS (app.alert(1)) >>'), 'invoice.pdf');
    assert(js.status === 201 && js.data.data.state === 'Rejected' && /JavaScript/.test(js.data.data.scan.detail), `active PDF ${JSON.stringify(js.data).slice(0, 200)}`);
    assert((await download(desk, patient.id, js.data.data.id)).status === 409, 'a rejected document opened');
    const big = await upload(desk, patient.id, Buffer.concat([pdf('big'), Buffer.alloc(21 * 1024 * 1024)]), 'big.pdf');
    assert(big.status === 413, `oversized ${big.status}`);
    const png = await upload(desk, patient.id, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'), 'photo.jpg', 'Imaging');
    assert(png.status === 201 && png.data.data.media_type === 'image/png', `type by content ${JSON.stringify(png.data).slice(0, 160)}`);
  });

  await step('A stored file that was altered is not opened and is reported', async () => {
    const r = await upload(desk, patient.id, pdf(`tamper ${tag}`), 'lab.pdf');
    const [row] = await sql('SELECT storage_key FROM hms_patient_documents WHERE id = $1', [r.data.data.id]);
    const file = path.join(DIR, row.storage_key);
    const bytes = fs.readFileSync(file); bytes[bytes.length - 3] ^= 0xff; fs.writeFileSync(file, bytes);
    const d = await download(desk, patient.id, r.data.data.id);
    assert(d.status === 409 && JSON.parse(d.bytes.toString()).code === 'DOCUMENT_INTEGRITY', `tampered ${d.status}`);
    const [w] = await sql("SELECT status FROM hms_worklist_items WHERE kind = 'document.integrity' AND dedupe_key = $1", [String(r.data.data.id)]);
    assert(w && w.status === 'Open', 'the integrity failure was not reported');
  });

  await step('Legal hold: only administrators place it; a held document cannot be withdrawn or deleted', async () => {
    assert((await api('POST', `/patients/hms/${patient.id}/documents/${good.id}/legal-hold`, { token: nurse, body: { hold: true, reason: 'Court order 12/2026' } })).status === 403, 'a nurse placed a hold');
    assert((await api('POST', `/patients/hms/${patient.id}/documents/${good.id}/legal-hold`, { token: admin, body: { hold: true, reason: 'Court order 12/2026 (synthetic)' } })).status === 200, 'hold');
    const w = await api('POST', `/patients/hms/${patient.id}/documents/${good.id}/withdraw`, { token: desk, body: { reason: 'Uploaded to the wrong patient' } });
    assert(w.status === 409 && w.data.code === 'LEGAL_HOLD', `withdraw under hold ${w.status}`);
    let deleted = true;
    try { await sql('DELETE FROM hms_patient_documents WHERE id = $1', [good.id]); } catch { deleted = false; }
    assert(!deleted, 'the database deleted a held document');
    let changed = true;
    try { await sql("UPDATE hms_patient_documents SET sha256 = repeat('0', 64) WHERE id = $1", [good.id]); } catch { changed = false; }
    assert(!changed, 'a stored document fingerprint was changed');
    assert((await api('POST', `/patients/hms/${patient.id}/documents/${good.id}/legal-hold`, { token: admin, body: { hold: false, reason: 'Matter closed (synthetic)' } })).status === 200, 'lift');
    const w2 = await api('POST', `/patients/hms/${patient.id}/documents/${good.id}/withdraw`, { token: desk, body: { reason: 'Uploaded to the wrong patient' } });
    assert(w2.status === 200 && w2.data.data.state === 'Withdrawn', `withdraw ${w2.status}`);
    assert((await download(desk, patient.id, good.id)).status === 409, 'a withdrawn document opened');
    const rep = await api('GET', '/patients/documents/report', { token: admin });
    assert(rep.status === 200 && rep.data.data.withdrawn >= 1 && rep.data.data.rejected >= 1 && rep.data.data.by_key.cfa >= 1, `report ${JSON.stringify(rep.data).slice(0, 200)}`);
  });

  await step('When the virus scanner cannot be reached, a new document stays in quarantine and goes on the worklist', async () => {
    const second = startServer({ CLAMAV_HOST: '127.0.0.1', CLAMAV_PORT: '9', CLAMAV_TIMEOUT_MS: '2000' });
    try {
      assert(await ready(second), `second server: ${second.log().slice(-300)}`);
      const r = await upload(desk, patient.id, pdf(`scan ${tag}`), 'xray.pdf', 'Imaging', `http://127.0.0.1:${SECOND_PORT}/api`);
      assert(r.status === 201 && r.data.data.state === 'Quarantined' && r.data.data.scan.result === 'unavailable', `quarantine ${JSON.stringify(r.data).slice(0, 200)}`);
      assert((await download(desk, patient.id, r.data.data.id)).status === 409, 'a quarantined document opened');
      const [w] = await sql("SELECT status FROM hms_worklist_items WHERE kind = 'document.scan_unavailable' AND dedupe_key = $1", [String(r.data.data.id)]);
      assert(w && w.status === 'Open', 'quarantine not on the worklist');
    } finally { second.kill('SIGTERM'); await second.exited; }
  });

  await step('On the patient profile, staff upload a file, see its state and checks, and download it', async () => {
    const browser = await chromium.launch();
    try {
      const { page, errors } = await browserAs(browser, 'receptionist');
      await page.goto(`${BASE}/hms/patients/${patient.id}`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: 'Documents' }).click();
      const tmp = path.join(require('os').tmpdir(), `consent-${tag}.pdf`);
      fs.writeFileSync(tmp, pdf(`ui ${tag}`));
      await page.getByLabel('File (PDF, PNG or JPEG)').setInputFiles(tmp);
      await page.getByLabel('Document type').selectOption('Consent');
      await page.getByRole('button', { name: 'Upload' }).click();
      const row = page.locator('tbody tr', { hasText: `consent-${tag}.pdf` });
      await row.getByText('Available').waitFor();
      await row.getByText(/Antivirus scan completed successfully/).waitFor();
      const [dl] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: `Download consent-${tag}.pdf` }).click()]);
      const got = fs.readFileSync(await dl.path());
      assert(got.equals(pdf(`ui ${tag}`)), 'the downloaded file differs');
      fs.rmSync(tmp, { force: true });
      assert(!errors.length, `page errors: ${errors.join('; ')}`);
    } finally { await browser.close(); }
  });

  await step('Keys rotate: everything is re-encrypted to a new key, the old key can then be removed, and production will not start without keys', async () => {
    const newKey = crypto.randomBytes(32).toString('hex');
    const oldKeys = process.env.HMS_DATA_KEYS;
    try {
      const first = await rekey(`cfb:${newKey},${oldKeys}`);
      const report = JSON.parse(first.json);
      assert(report.active_key === 'cfb', `active ${report.active_key}`);
      // The file altered in an earlier step cannot be re-encrypted, and the run says so (exit 1).
      assert(first.code === 1 && /document \d+: The stored value failed its integrity check/.test(first.out), `the altered file was not reported: ${first.out.slice(-400)}`);
      const [mine] = await sql('SELECT aadhaar FROM hms_patients WHERE id = $1', [patient.id]);
      assert(/^hk2:cfb:/.test(mine.aadhaar), 'Aadhaar not on the new key');
      const docs = await sql("SELECT key_id FROM hms_patient_documents WHERE patient_id = $1 AND state IN ('Available', 'Withdrawn', 'Rejected', 'Quarantined')", [patient.id]);
      assert(docs.filter((d) => d.key_id === 'cfb').length >= docs.length - 1, `document keys ${JSON.stringify(docs)}`);
      const again = await rekey(`cfb:${newKey},${oldKeys}`);
      assert(Object.values(JSON.parse(again.json).report).every((r) => typeof r !== 'object' || r.rekeyed === 0), 'a second run re-encrypted again (not resumable)');
      // A server with only the new key reads everything.
      const second = startServer({ HMS_DATA_KEYS: `cfb:${newKey}` });
      try {
        assert(await ready(second), `new-key server: ${second.log().slice(-300)}`);
        // The newest available document: the altered file from the tamper step is older and must not be picked.
        const [avail] = await sql("SELECT id FROM hms_patient_documents WHERE patient_id = $1 AND facility_id=(SELECT facility_id FROM hms_patient_documents WHERE id=$2) AND state = 'Available' ORDER BY id DESC LIMIT 1", [patient.id,good.id]);
        const d = await download(desk, patient.id, avail.id, `http://127.0.0.1:${SECOND_PORT}/api`);
        assert(d.status === 200, `download with only the new key ${d.status} ${d.bytes.toString().slice(0, 200)}`);
        const shown = await fetch(`http://127.0.0.1:${SECOND_PORT}/api/patients/hms/${patient.id}`, { headers: { authorization: `Bearer ${desk}` } }).then((r) => r.text());
        assert(shown.includes('XXXX-XXXX-9012'), 'Aadhaar not readable with only the new key');
      } finally { second.kill('SIGTERM'); await second.exited; }
    } finally {
      // Back onto the stack's key for the suites that follow.
      await rekey(`${oldKeys},cfb:${newKey}`);
    }
    const prod = startServer({ NODE_ENV: 'production', HMS_DATA_KEYS: '', JWT_SECRET: process.env.JWT_SECRET });
    const code = await prod.exited;
    assert(code !== 0 && /HMS_DATA_KEYS is not set/.test(prod.log()), `production started without keys: ${prod.log().slice(-300)}`);
  });

  await step('The restore verifier checks every stored document version and fails on the altered and quarantined ones, revealing nothing', async () => {
    const r = await new Promise((resolve) => execFile('node', ['scripts/verify-documents.cts'], { cwd: BACKEND, env: { ...process.env, RESTORE_DB_NAME: process.env.DB_NAME, RESTORE_DB_HOST: process.env.DB_HOST, RESTORE_DB_PORT: process.env.DB_PORT, RESTORE_DB_USER: process.env.DB_USER, RESTORE_DB_PASSWORD: process.env.DB_PASSWORD } },
      (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr })));
    assert(r.code === 1, `exit ${r.code} ${r.stderr}`);
    const v = JSON.parse(r.stdout);
    assert(v.status === 'FAILED' && v.counts.verified >= 3 && v.counts.quarantined >= 1 && (v.counts.wrong_version + v.counts.corrupt) >= 1, `verifier ${JSON.stringify(v.counts)}`);
    assert(!r.stdout.includes(marker) && !r.stdout.includes('.hmsdoc') && !r.stdout.includes('Document patient'), 'the verifier output reveals record details');
  });

  done();
  process.exit();
})();
