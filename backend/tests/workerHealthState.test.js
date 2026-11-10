const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const state = require('../utils/workerHealthState');

test('worker health fails on a recorded failure and recovers after successful work', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-worker-health-'));
  const file = path.join(dir, 'heartbeat');
  const run = () => spawnSync(process.execPath, [path.join(__dirname, '../scripts/worker-health.cjs')], { env: { ...process.env, HMS_WORKER_HEARTBEAT_FILE: file } }).status;
  try {
    state.failure('synthetic', new Error('synthetic failure'));
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), jobs: state.jobs }));
    assert.equal(run(), 1);
    state.success('synthetic');
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), jobs: state.jobs }));
    assert.equal(run(), 0);
    assert.equal(state.jobs.synthetic.failures, 1);
  } finally { delete state.jobs.synthetic; fs.rmSync(dir, { recursive: true, force: true }); }
});
