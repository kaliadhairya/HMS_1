// Container health check for the worker process (completion B8): healthy while the heartbeat
// file that worker.js refreshes is younger than HMS_WORKER_HEARTBEAT_MAX_AGE_MS (default 60 s).
const fs = require('fs');
const file = process.env.HMS_WORKER_HEARTBEAT_FILE || '/tmp/hms-worker-heartbeat';
const maxAge = Number(process.env.HMS_WORKER_HEARTBEAT_MAX_AGE_MS) || 60000;
try {
  const age = Date.now() - fs.statSync(file).mtimeMs;
  if (age > maxAge) { console.error(`worker heartbeat is ${Math.round(age / 1000)} s old`); process.exit(1); }
} catch {
  console.error('worker heartbeat missing');
  process.exit(1);
}
