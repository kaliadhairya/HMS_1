const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

test('local authentication observes current identity, session and membership without a cache', { skip: process.env.HMS_FACILITY_TEST !== 'true' }, async t => {
  assert.match(process.env.DB_NAME || '', /^hms_verify_final_/);
  const express = require('express');
  const { sequelize } = require('../models/db');
  const { requestContext, bindAuditActor } = require('../utils/auditContext');
  const { protect } = require('../middleware/auth');
  const { signSessionToken } = require('../utils/authTokens');
  bindAuditActor(sequelize);
  const query = (sql, replacements = {}) => sequelize.query(sql, { replacements, type: 'SELECT' });
  const [facility] = await query('SELECT hms_initial_facility() AS id');
  const [admin] = await query("SELECT id FROM hms_users WHERE username='admin'");
  const [user] = await query(`INSERT INTO hms_users(username,password,name,role,is_active,first_login)
    VALUES(:name,'not-used-for-login','Synthetic authentication snapshot','receptionist',1,'N') RETURNING id,username,role`, { name: 'auth-snapshot-' + crypto.randomUUID() });
  const newSession = async () => {
    const [session] = await query("INSERT INTO hms_sessions(user_id,facility_id,expires_at) VALUES(:user,:facility,now()+interval '1 hour') RETURNING id", { user: user.id, facility: facility.id });
    return { id: session.id, token: signSessionToken(user, session.id, facility.id) };
  };
  const app = express();
  app.use(requestContext);
  app.get('/probe', protect, (req, res) => res.json(req.user));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); await sequelize.close(); });
  let session = await newSession();
  const get = headers => fetch(`http://127.0.0.1:${server.address().port}/probe`, { headers: { authorization: 'Bearer ' + session.token, ...headers } });
  await t.test('returns current role permissions and facility, without password material', async () => {
    const response = await get(), body = await response.json();
    assert.equal(response.status, 200); assert.equal(body.facilityId, facility.id);
    assert.equal(body.role, 'receptionist'); assert(Array.isArray(body.permissions));
    assert(!Object.keys(body).some(k => /password|otp|hash/i.test(k)));
    await query("UPDATE hms_users SET role='nurse' WHERE id=:id", { id: user.id });
    assert.equal((await (await get()).json()).role, 'nurse');
  });
  await t.test('rejects a forged facility header', async () => {
    assert.equal((await get({ 'x-facility-id': crypto.randomUUID() })).status, 403);
  });
  await t.test('deactivation is effective on the next request', async () => {
    await query('UPDATE hms_users SET is_active=0 WHERE id=:id', { id: user.id });
    assert.equal((await get()).status, 401);
    await query('UPDATE hms_users SET is_active=1 WHERE id=:id', { id: user.id });
    assert.equal((await get()).status, 200);
  });
  await t.test('expiry and revocation are effective on the next request', async () => {
    await query("UPDATE hms_sessions SET expires_at=now()-interval '1 second' WHERE id=:id", { id: session.id });
    assert.equal((await get()).status, 401);
    session = await newSession();
    await query("UPDATE hms_sessions SET revoked_at=now(),revoked_reason='Synthetic revocation' WHERE id=:id", { id: session.id });
    assert.equal((await get()).status, 401);
  });
  await t.test('membership revocation is effective without waiting for cache expiry', async () => {
    session = await newSession();
    assert.equal((await get()).status, 200);
    await query(`UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=:admin,
      revocation_reason='Synthetic immediate membership revocation' WHERE user_id=:user AND facility_id=:facility AND revoked_at IS NULL`, { admin: admin.id, user: user.id, facility: facility.id });
    assert.equal((await get()).status, 403);
  });
});
