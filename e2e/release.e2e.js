// The release procedure (completion B8) against a recorded stand-in for docker: a healthy release
// replaces the services after a backup, build, migration and runtime grant; an unhealthy release
// puts the kept images back and waits for them to be healthy; a failed migration replaces
// nothing. The real Docker app is never touched. The stand-in records every call it receives.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { runner, assert } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const FAKE = `#!/usr/bin/env bash
# Stand-in for docker: records the call, answers what the release and backup scripts ask.
echo "$*" >> "$FAKE_DIR/calls"
args="$*"
case "$args" in
  *"ps -q "*) echo "cid-\${args##* }" ;;
  "inspect -f {{.Config.Image}} "*) svc=\${args##*cid-}; echo "hms-$svc" ;;
  "inspect -f {{.Image}} "*) svc=\${args##*cid-}; echo "sha256:old-$svc" ;;
  "inspect -f {{if .State.Health}}"*)
    if [ -f "$FAKE_DIR/rolled-back" ]; then echo healthy; else echo "$FAKE_NEW_HEALTH"; fi ;;
  "tag hms-release-rollback/"*) touch "$FAKE_DIR/rolled-back" ;;
  *"run --rm migrate"*) [ "$FAKE_MIGRATE" = fail ] && exit 1 ;;
  *"exec -T backend printenv HMS_DOCUMENT_DIR"*) ;;
esac
exit 0
`;

function release(health, migrate = 'ok') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-release-'));
  fs.mkdirSync(path.join(dir, 'bin'));
  fs.writeFileSync(path.join(dir, 'bin', 'docker'), FAKE, { mode: 0o755 });
  return new Promise((resolve) => execFile('bash', ['scripts/release.sh', 'docker-compose.prod.yml'], {
    cwd: ROOT,
    env: { ...process.env, PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`, FAKE_DIR: dir, FAKE_NEW_HEALTH: health, FAKE_MIGRATE: migrate,
      HMS_BACKUP_DIR: path.join(dir, 'backups'), RELEASE_HEALTH_TIMEOUT: '2', RELEASE_POLL_SECONDS: '0.2' },
  }, (err, stdout, stderr) => {
    const calls = fs.existsSync(path.join(dir, 'calls')) ? fs.readFileSync(path.join(dir, 'calls'), 'utf8').trim().split('\n') : [];
    fs.rmSync(dir, { recursive: true, force: true });
    resolve({ code: err ? err.code : 0, out: stdout + stderr, calls });
  }));
}
const index = (calls, pattern) => calls.findIndex((c) => pattern.test(c));

(async () => {
  const { step, done } = runner('Release and rollback');

  await step('A healthy release backs up, builds, migrates and grants before replacing worker, backend and frontend', async () => {
    const r = await release('healthy');
    assert(r.code === 0 && /RELEASED/.test(r.out), `release ${r.code} ${r.out.slice(-300)}`);
    const dump = index(r.calls, /exec -T db pg_dump/), build = index(r.calls, / build worker backend frontend migrate/);
    const migrate = index(r.calls, /run --rm migrate/), grant = index(r.calls, /run --rm runtime-role/);
    const ups = ['worker', 'backend', 'frontend'].map((s) => index(r.calls, new RegExp(`up -d --no-deps --no-build ${s}$`)));
    assert(dump >= 0 && dump < build && build < migrate && migrate < grant && grant < Math.min(...ups), `order: ${r.calls.join(' | ')}`);
    assert(ups[0] < ups[1] && ups[1] < ups[2], 'worker, backend and frontend were not replaced in order');
    assert(!r.calls.some((c) => /^tag hms-release-rollback\//.test(c)), 'a healthy release rolled back');
  });

  await step('An unhealthy release puts the kept images back and reports the rollback', async () => {
    const r = await release('unhealthy');
    assert(r.code === 1 && /ROLLED BACK/.test(r.out), `rollback ${r.code} ${r.out.slice(-300)}`);
    for (const svc of ['worker', 'backend', 'frontend']) {
      const kept = index(r.calls, new RegExp(`^tag sha256:old-${svc} hms-release-rollback/${svc}:latest$`));
      const back = index(r.calls, new RegExp(`^tag hms-release-rollback/${svc}:latest hms-${svc}$`));
      assert(kept >= 0 && back > kept, `${svc} was not restored from its kept image: ${r.calls.join(' | ')}`);
      const ups = r.calls.filter((c) => new RegExp(`up -d --no-deps --no-build ${svc}$`).test(c)).length;
      assert(ups === 2, `${svc} was started ${ups} times, expected the new and the restored version`);
    }
  });

  await step('A failed migration replaces nothing and leaves the running version', async () => {
    const r = await release('healthy', 'fail');
    assert(r.code === 1 && /migration failed/.test(r.out), `failed migration ${r.code} ${r.out.slice(-300)}`);
    assert(!r.calls.some((c) => /up -d/.test(c) || /run --rm runtime-role/.test(c)), `services were changed: ${r.calls.join(' | ')}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
