// Worker facility context under row policies (A2 rule, used by A8/A7/C6
// background work). Connects as a non-owner role, like the production
// identity: with no context it sees no facility records; with the worker
// account and facility bound (as services/workerContext.cts does) it sees
// that facility's records; an account without membership still sees none.
const crypto = require('crypto');
const path = require('path');
const { sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const { Client } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'));
const role = `hms_rls_probe_${crypto.randomBytes(3).toString('hex')}`;
const password = crypto.randomBytes(12).toString('hex');
async function asProbe(settings) {
  const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: role, password });
  await c.connect();
  try {
    for (const [k, v] of Object.entries(settings)) await c.query('SELECT set_config($1, $2, false)', [k, v]);
    return Number((await c.query('SELECT count(*) AS n FROM hms_admissions')).rows[0].n);
  } finally { await c.end(); }
}

(async () => {
  const { step, done } = runner('Worker facility context');
  const [{ id: facility }] = await sql('SELECT hms_initial_facility() AS id');
  const [{ n: total }] = await sql('SELECT count(*)::int AS n FROM hms_admissions WHERE facility_id = hms_initial_facility()');
  const [member] = await sql("SELECT u.id FROM hms_users u JOIN hms_facility_memberships m ON m.user_id = u.id WHERE u.username = 'admin' AND m.facility_id = hms_initial_facility() AND m.revoked_at IS NULL");
  const [stranger] = await sql("INSERT INTO hms_users (username, password, name, role, is_active) VALUES ($1, 'NOT-A-LOGIN', 'Synthetic worker without membership', 'admin', 1) RETURNING id", [`nomember_${role}`]);
  // New staff get a membership automatically (0114); this account must not have one.
  await sql("UPDATE hms_facility_memberships SET revoked_at = now(), revoked_by_user_id = $2 WHERE user_id = $1 AND revoked_at IS NULL", [stranger.id, member.id]);
  await sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
  await sql(`GRANT USAGE ON SCHEMA public TO ${role}; GRANT SELECT ON hms_admissions, hms_facility_memberships, hms_facilities, hms_users TO ${role}`);
  try {
    await step('Precondition: the copy has admissions in the initial facility', async () => { assert(total > 0, 'no admissions to see'); });
    await step('A non-owner identity with no facility context sees no facility records', async () => {
      assert(await asProbe({}) === 0, 'rows visible without a facility context');
    });
    await step('Bound to an approved worker account and its facility, it sees exactly that facility\'s records', async () => {
      assert(await asProbe({ 'hms.facility_id': facility, 'hms.actor_user_id': String(member.id) }) === total, 'worker context did not see its facility');
    });
    await step('An account without membership of the facility still sees nothing', async () => {
      assert(await asProbe({ 'hms.facility_id': facility, 'hms.actor_user_id': String(stranger.id) }) === 0, 'a non-member saw facility rows');
    });
  } finally {
    await sql(`REVOKE ALL ON hms_admissions, hms_facility_memberships, hms_facilities, hms_users FROM ${role}; REVOKE USAGE ON SCHEMA public FROM ${role}; DROP ROLE ${role}`).catch(() => {});
    await sql("UPDATE hms_users SET is_active = 0 WHERE id = $1", [stranger.id]).catch(() => {});
  }
  done();
  process.exit();
})();
