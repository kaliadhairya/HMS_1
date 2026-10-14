const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
test('WAL archiving accepts identical retries and refuses overwrite/corruption', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-wal-test-'));
  try {
    const input = path.join(root, 'source');
    fs.writeFileSync(input, 'Synthetic WAL segment');
    const run = (name = '000000010000000000000001') => spawnSync('sh', [path.resolve(__dirname, '../../scripts/archive-wal.sh'), input, name], { env: { ...process.env, HMS_WAL_ARCHIVE_DIR: root } });
    assert.equal(run().status, 0);
    assert.equal(run().status, 0, 'same segment retry succeeds');
    fs.writeFileSync(input, 'Different synthetic segment');
    assert.equal(run().status, 1, 'existing segment must not be replaced');
    fs.writeFileSync(path.join(root, '000000010000000000000001.gz'), 'corrupt');
    assert.equal(run().status, 1, 'corrupt stored segment does not count as archived');
    assert.equal(run('../outside').status, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
