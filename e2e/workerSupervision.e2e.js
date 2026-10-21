// The worker process is supervised (completion B8): while the database answers it refreshes a
// heartbeat that the container health check reads; when the database becomes unreachable it
// exits for its supervisor to restart it, and the health check then reports it unhealthy; it
// refuses to start without a database. A relay in front of PostgreSQL lets the test cut it off.
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const { spawn, execFile } = require('child_process');
const { runner, assert, sleep, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-worker-'));
const BEAT = path.join(WORK, 'heartbeat');

function relay() {
  const sockets = new Set();
  const server = net.createServer((client) => {
    const db = net.connect(Number(process.env.DB_PORT || 5432), process.env.DB_HOST || '127.0.0.1');
    for (const s of [client, db]) { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); }
    client.pipe(db); db.pipe(client);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port,
    cut: () => new Promise((done) => { server.close(() => done()); for (const s of sockets) s.destroy(); }),
  })));
}
function startWorker(dbPort) {
  const out = [];
  const child = spawn('node', ['worker.js'], { cwd: BACKEND, env: { ...process.env, DB_HOST: '127.0.0.1', DB_PORT: String(dbPort), HMS_WORKER_HEARTBEAT_MS: '300', HMS_WORKER_HEARTBEAT_FILE: BEAT,
    AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', INTERNAL_SERVICE_SECRET: '', TZ: 'UTC', DEVICE_MLLP: 'off', DOWNTIME_KIT_DIR: '' } });
  child.stdout.on('data', (d) => out.push(String(d))); child.stderr.on('data', (d) => out.push(String(d)));
  child.log = () => out.join('');
  child.exited = new Promise((r) => child.on('exit', (code) => r(code)));
  return child;
}
const health = () => new Promise((resolve) => execFile('node', ['scripts/worker-health.cjs'], { cwd: BACKEND, env: { ...process.env, HMS_WORKER_HEARTBEAT_FILE: BEAT, HMS_WORKER_HEARTBEAT_MAX_AGE_MS: '2000' } },
  (err, stdout, stderr) => resolve({ code: err ? err.code : 0, out: stdout + stderr })));

(async () => {
  const { step, done } = runner('Worker supervision');
  let worker, db;
  try {
    await step('A worker without a database refuses to start and reports unhealthy', async () => {
      const w = startWorker(9);
      const code = await Promise.race([w.exited, sleep(30000).then(() => 'timeout')]);
      assert(code !== 0 && code !== 'timeout', `worker without a database: ${code} ${w.log().slice(-200)}`);
      assert((await health()).code === 1, 'health check passed without a heartbeat');
    });

    await step('A running worker refreshes its heartbeat and the health check passes', async () => {
      db = await relay();
      worker = startWorker(db.port);
      const end = Date.now() + 30000;
      while (Date.now() < end && !fs.existsSync(BEAT)) await sleep(200);
      assert(fs.existsSync(BEAT), `no heartbeat: ${worker.log().slice(-300)}`);
      const first = fs.statSync(BEAT).mtimeMs;
      await sleep(1200);
      assert(fs.statSync(BEAT).mtimeMs > first, 'the heartbeat was not refreshed');
      assert(worker.exitCode === null && (await health()).code === 0, 'a running worker reported unhealthy');
    });

    await step('When the database becomes unreachable the worker exits for its supervisor, and is then unhealthy', async () => {
      await db.cut();
      const code = await Promise.race([worker.exited, sleep(30000).then(() => 'timeout')]);
      assert(code === 1, `worker after losing the database: ${code} ${worker.log().slice(-300)}`);
      assert(/unreachable; exiting for the supervisor/.test(worker.log()), 'no supervisor message');
      await sleep(2200);
      assert((await health()).code === 1, 'a stopped worker reported healthy');
    });
  } finally {
    if (worker && worker.exitCode === null) worker.kill('SIGKILL');
    fs.rmSync(WORK, { recursive: true, force: true });
  }
  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
