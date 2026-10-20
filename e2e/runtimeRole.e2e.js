// Restricted runtime identity (completion A2). The provisioning script creates
// a non-owner role; the production identity check accepts it and refuses the
// owner; the role cannot create schema objects. Throwaway databases only.
const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');
const { sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '..', 'backend');
const role = `hms_runtime_${crypto.randomBytes(3).toString('hex')}`;
const password = crypto.randomBytes(18).toString('hex');
const ownerEnv = { DB_HOST: process.env.DB_HOST, DB_PORT: process.env.DB_PORT, DB_NAME: process.env.DB_NAME, DB_USER: process.env.DB_USER, DB_PASSWORD: process.env.DB_PASSWORD };

const run = (file, args, env) => new Promise((resolve) => execFile(process.execPath, [file, ...(args || [])], { cwd: BACKEND, env: { ...process.env, ...env }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: String(stdout) + String(stderr) })));
// The production identity check, run as whichever database identity the environment names.
const checkIdentity = (user, pass) => new Promise((resolve) => execFile(process.execPath, ['-e', `
  const { sequelize } = require('./models/db');
  require('./services/databaseRuntime.cts').verifyRuntime(sequelize)
    .then(() => { console.log('IDENTITY_OK'); return sequelize.close(); })
    .catch((e) => { console.log('IDENTITY_REFUSED ' + e.message); return sequelize.close(); });
`], { cwd: BACKEND, env: { ...process.env, DB_USER: user, DB_PASSWORD: pass, NODE_ENV: 'production' }, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => resolve(String(stdout) + String(stderr))));

(async () => {
  const { step, done } = runner('Restricted runtime identity');
  try {
    await step('Provisioning creates the runtime role; a second run is harmless', async () => {
      const env = { ...ownerEnv, RUNTIME_DB_USER: role, RUNTIME_DB_PASSWORD: password };
      const first = await run('scripts/provision-runtime-role.cjs', null, env);
      assert(first.code === 0 && first.out.includes('"provisioned":true'), `provision: ${first.out.slice(-300)}`);
      const again = await run('scripts/provision-runtime-role.cjs', null, env);
      assert(again.code === 0, `second run: ${again.out.slice(-300)}`);
      const [r] = await sql('SELECT rolsuper, rolbypassrls, rolcreatedb FROM pg_roles WHERE rolname = $1', [role]);
      assert(r && r.rolsuper === false && r.rolbypassrls === false && r.rolcreatedb === false, `role attributes ${JSON.stringify(r)}`);
    });

    await step('The production identity check accepts the runtime role', async () => {
      const out = await checkIdentity(role, password);
      assert(out.includes('IDENTITY_OK'), `runtime role refused: ${out.slice(-400)}`);
    });

    await step('The production identity check refuses the owner identity', async () => {
      const out = await checkIdentity(ownerEnv.DB_USER, ownerEnv.DB_PASSWORD);
      assert(out.includes('IDENTITY_REFUSED') && /bypass row-level security|own clinical tables/.test(out), `owner not refused: ${out.slice(-400)}`);
    });

    await step('The runtime role cannot create schema objects', async () => {
      const { Client } = require(path.join(BACKEND, 'node_modules', 'pg'));
      const c = new Client({ host: ownerEnv.DB_HOST, port: Number(ownerEnv.DB_PORT), user: role, password, database: ownerEnv.DB_NAME });
      await c.connect();
      try {
        let refused = false;
        try { await c.query('CREATE TABLE hms_runtime_probe (id int)'); } catch (e) { refused = /permission denied/.test(e.message); }
        assert(refused, 'runtime role created a table');
      } finally { await c.end(); }
    });
  } finally {
    await sql(`REASSIGN OWNED BY ${role} TO CURRENT_USER`).catch(() => {});
    await sql(`DROP OWNED BY ${role}`).catch(() => {});
    await sql(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
  }
  done();
  process.exit();
})();
