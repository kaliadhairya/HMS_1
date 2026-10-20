// Release drain (completion B8): on SIGTERM the API reports draining, refuses
// new work with a retry hint, finishes in-flight requests within its timeout,
// closes the database and exits 0.
const path = require('path');
const { spawn } = require('child_process');
const { sleep, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const PORT = process.env.E2E_DRAIN_PORT || '15604';
const BASE = `http://127.0.0.1:${PORT}`;

function start() {
  const out = [];
  const child = spawn('node', ['server.js'], {
    cwd: BACKEND,
    env: { ...process.env, PORT, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '', OUTBOX_DISPATCH: 'off', INTERFACE_WORKER: 'off', HMS_DRAIN_GRACE_MS: '2500', HMS_DRAIN_TIMEOUT_MS: '5000' },
  });
  child.stdout.on('data', (d) => out.push(String(d)));
  child.stderr.on('data', (d) => out.push(String(d)));
  child.log = () => out.join('');
  child.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return child;
}
async function ready(child) {
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) return false;
    if (await fetch(`${BASE}/api/ready`).then((r) => r.ok).catch(() => false)) return true;
    await sleep(250);
  }
  return false;
}

(async () => {
  const { step, done } = runner('Release drain');
  const server = start();
  try {
    await step('The instance starts and reports ready', async () => {
      assert(await ready(server), `server did not become ready: ${server.log().slice(-400)}`);
    });
    await step('On SIGTERM it reports draining and refuses new work with a retry hint', async () => {
      server.kill('SIGTERM');
      let status = null, body = null;
      for (let i = 0; i < 20 && status !== 503; i++) {
        const r = await fetch(`${BASE}/api/ready`).catch(() => null);
        if (r) { status = r.status; body = await r.json().catch(() => null); }
        if (status !== 503) await sleep(100);
      }
      assert(status === 503 && body && body.status === 'draining', `readiness during drain: ${status} ${JSON.stringify(body)}`);
      const work = await fetch(`${BASE}/api/patients`).catch(() => null);
      assert(work && work.status === 503, `new work during drain: ${work && work.status}`);
      const data = await work.json();
      assert(data.code === 'SERVICE_DRAINING' && work.headers.get('retry-after') === '5', `refusal: ${JSON.stringify(data)}`);
    });
    await step('The instance finishes the drain and exits cleanly', async () => {
      const code = await Promise.race([server.exited, sleep(20000).then(() => 'timeout')]);
      assert(code === 0, `exit ${code}: ${server.log().slice(-400)}`);
      assert(/Drain complete/.test(server.log()), 'no drain completion was logged');
    });
  } finally {
    if (server.exitCode === null) server.kill('SIGKILL');
  }
  done();
  process.exit();
})();
