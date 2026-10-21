// A restore checks the stored patient documents (completion B6). An isolated copy runs HMS with
// its own private document folder; documents are uploaded; the copy is backed up as the backup
// script does (database dump plus the encrypted document folder) and restored into another
// database. The restore's document step verifies the clean backup, and fails when a stored
// document was altered, when the archive is of another store, or when the archive is missing.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { runner, assert, sleep, creds, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const TEMPLATE = process.env.PHASE4_FOUNDATION_DB_NAME;
const tag = crypto.randomBytes(3).toString('hex');
const SRC = `hms_verify_claude_b6src_${tag}`;
const DST = `hms_verify_claude_b6dst_${tag}`;
const PORT = Number(process.env.E2E_SECOND_PORT || 15574) + 4;
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-b6-'));
const DOCS = path.join(WORK, 'documents');
const sh = (cmd, args, env = {}, opts = {}) => new Promise((resolve) => execFile(cmd, args, { cwd: BACKEND, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024, ...opts },
  (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout) + String(stderr), stdout: String(stdout) })));
const base = `http://127.0.0.1:${PORT}/api`;
const verify = (archive) => sh('node', ['scripts/restore-verify-documents.cts'], {
  RESTORE_DB_NAME: DST, RESTORE_DB_HOST: process.env.DB_HOST, RESTORE_DB_PORT: process.env.DB_PORT,
  RESTORE_DB_USER: process.env.DB_USER, RESTORE_DB_PASSWORD: process.env.DB_PASSWORD, DOCUMENT_ARCHIVE: archive || '',
});
const result = (r) => { try { return JSON.parse(r.stdout); } catch { return null; } };

(async () => {
  const { step, done } = runner('Backup and restore of patient documents');
  assert(TEMPLATE && /^hms_verify_/.test(TEMPLATE), 'needs PHASE4_FOUNDATION_DB_NAME (an idle hms_verify_* copy) as the template');
  let api;
  try {
    await step('An isolated HMS stores two encrypted patient documents in its own folder', async () => {
      assert((await sh('docker', ['exec', 'hms-db', 'createdb', '-U', 'postgres', '-T', TEMPLATE, SRC])).code === 0, 'createdb');
      const mig = await sh('node', ['migrate.js', 'up'], { DB_NAME: SRC });
      assert(mig.code === 0, `migrate ${mig.out.slice(-300)}`);
      fs.mkdirSync(DOCS, { mode: 0o700 });
      api = spawn('node', ['server.js'], { cwd: BACKEND, env: { ...process.env, DB_NAME: SRC, PORT: String(PORT), HMS_DOCUMENT_DIR: DOCS, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '', OUTBOX_DISPATCH: 'off', INTERFACE_WORKER: 'off', FINANCE_WORKER: 'off' } });
      const log = [];
      api.stdout.on('data', (d) => log.push(String(d))); api.stderr.on('data', (d) => log.push(String(d)));
      let ready = false;
      for (let i = 0; i < 150 && !ready && api.exitCode === null; i++) { ready = await fetch(`${base}/ready`).then((r) => r.ok).catch(() => false); if (!ready) await sleep(200); }
      assert(ready, `API did not start: ${log.join('').slice(-400)}`);
      const [username, password] = creds('receptionist');
      const token = (await (await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Auth-Transport': 'bearer' }, body: JSON.stringify({ username, password }) })).json()).token;
      const reg = await fetch(`${base}/patients/hms`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ patientType: 'other', name: `Backup drill ${tag}`, age: 40, gender: 'Other', opdIndoor: 'OPD', testDate: new Date().toISOString().slice(0, 10), phoneNumber: `95${String(Date.now()).slice(-8)}` }) });
      const patientId = (await reg.json()).data?.id;
      assert(reg.status === 201 && patientId, `register ${reg.status}`);
      for (const n of [1, 2]) {
        const form = new FormData();
        form.append('file', new Blob([Buffer.from(`%PDF-1.4\n% backup drill ${tag} ${n}\n%%EOF\n`, 'latin1')]), `drill-${n}.pdf`);
        form.append('docType', 'Report');
        const up = await fetch(`${base}/patients/hms/${patientId}/documents`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID() }, body: form });
        const body = await up.json().catch(() => null);
        assert(up.status === 201 && body?.data?.state === 'Available', `upload ${n}: ${up.status} ${JSON.stringify(body).slice(0, 200)}`);
      }
      api.kill('SIGTERM');
      await new Promise((r) => api.on('exit', r));
    });

    await step('Backed up and restored, every stored document verifies against the archive', async () => {
      const dump = await sh('docker', ['exec', 'hms-db', 'sh', '-c', `createdb -U postgres ${DST} && pg_dump -U postgres -Fc -d ${SRC} | pg_restore -U postgres -d ${DST} --no-owner --exit-on-error`]);
      assert(dump.code === 0, `restore ${dump.out.slice(-300)}`);
      assert((await sh('tar', ['-czf', path.join(WORK, 'documents.tar.gz'), '-C', DOCS, '.'])).code === 0, 'archive');
      const r = await verify(path.join(WORK, 'documents.tar.gz'));
      const v = result(r);
      assert(r.code === 0 && v?.status === 'VERIFIED' && v.documents === 2 && v.counts.verified === 2, `clean restore: ${r.code} ${r.out.slice(-300)}`);
      assert(!r.out.includes(`backup drill ${tag}`) && !r.out.includes('.hmsdoc'), 'the report reveals document details');
    });

    await step('A restore fails when a stored document in the backup was altered', async () => {
      const copy = path.join(WORK, 'altered');
      fs.mkdirSync(copy);
      assert((await sh('tar', ['-xzf', path.join(WORK, 'documents.tar.gz'), '-C', copy])).code === 0, 'unpack');
      const files = [];
      const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else files.push(p); } };
      walk(copy);
      const stored = files.find((f) => !f.includes(`${path.sep}incoming${path.sep}`));
      assert(stored, 'no stored document in the archive');
      const bytes = fs.readFileSync(stored);
      bytes[bytes.length - 1] ^= 0xff;
      fs.writeFileSync(stored, bytes);
      assert((await sh('tar', ['-czf', path.join(WORK, 'altered.tar.gz'), '-C', copy, '.'])).code === 0, 'archive');
      const r = await verify(path.join(WORK, 'altered.tar.gz'));
      const v = result(r);
      assert(r.code === 1 && v?.status === 'FAILED' && v.counts.verified === 1 && v.counts.corrupt + v.counts.wrong_version === 1, `altered restore: ${r.code} ${r.out.slice(-300)}`);
    });

    await step('A restore fails when the archive is of another store, and is refused when it is missing', async () => {
      const empty = path.join(WORK, 'empty');
      fs.mkdirSync(empty);
      assert((await sh('tar', ['-czf', path.join(WORK, 'empty.tar.gz'), '-C', empty, '.'])).code === 0, 'archive');
      const wrong = await verify(path.join(WORK, 'empty.tar.gz'));
      assert(wrong.code === 1 && result(wrong)?.counts.missing === 2, `other store: ${wrong.code} ${wrong.out.slice(-200)}`);
      const missing = await verify('');
      assert(missing.code === 2 && /no document archive/.test(missing.out), `missing archive: ${missing.code} ${missing.out.slice(-200)}`);
    });
  } finally {
    if (api && api.exitCode === null) api.kill('SIGKILL');
    for (const db of [SRC, DST]) await sh('docker', ['exec', 'hms-db', 'dropdb', '-U', 'postgres', '--if-exists', '--force', db]);
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
