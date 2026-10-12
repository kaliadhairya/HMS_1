// Sessions: signing out, password changes, forced logout, deactivation and
// idle timeout end a login at once, over HTTP and on the live socket; the
// browser session is an HttpOnly cookie guarded against cross-site requests.
const { API, api, sql, runner, assert } = require('./helpers');
const { io } = require('../frontend/node_modules/socket.io-client');

const ORIGIN = API.replace(/\/api$/, '');

async function login(username, password, { bearer = true } = {}) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(bearer ? { 'x-auth-transport': 'bearer' } : {}) },
    body: JSON.stringify({ username, password }),
  });
  const data = await res.json();
  return { status: res.status, data, cookie: (res.headers.get('set-cookie') || '').split(';')[0], setCookie: res.headers.get('set-cookie') || '' };
}

const me = (token) => api('GET', '/auth/me', { token }).then((r) => r.status);

function connectSocket(token) {
  return new Promise((resolve) => {
    const socket = io(ORIGIN, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => { socket.close(); resolve(e); });
  });
}

const waitForDisconnect = (socket, ms = 3000) => new Promise((resolve) => {
  if (!socket.connected) return resolve(true);
  const timer = setTimeout(() => resolve(false), ms);
  socket.on('disconnect', () => { clearTimeout(timer); resolve(true); });
});

(async () => {
  const { step, done } = runner('Sessions');
  const NURSE = ['nurse', 'Nurse@123'];
  const TEMP_PASSWORD = 'Session#Check1';

  await step('Signing out ends the session; the token stops working', async () => {
    const { data } = await login(...NURSE);
    assert(await me(data.token) === 200, 'fresh token rejected');
    assert((await api('POST', '/auth/logout', { token: data.token })).status === 200, 'logout failed');
    assert(await me(data.token) === 401, 'token still works after logout');
  });

  await step('Changing the password signs out other devices but keeps this one', async () => {
    const a = (await login(...NURSE)).data.token;
    const b = (await login(...NURSE)).data.token;
    const changed = await api('POST', '/auth/change-password', { token: a, body: { currentPassword: NURSE[1], newPassword: TEMP_PASSWORD } });
    assert(changed.status === 200, `change-password ${changed.status} ${JSON.stringify(changed.data)}`);
    try {
      assert(await me(a) === 200, 'the device that changed the password was signed out');
      assert(await me(b) === 401, 'the other device stayed signed in');
    } finally {
      const back = await api('POST', '/auth/change-password', { token: a, body: { currentPassword: TEMP_PASSWORD, newPassword: NURSE[1] } });
      assert(back.status === 200, `could not restore the nurse password: ${back.status}`);
    }
  });

  await step('Forced logout by a super admin ends HTTP access and drops the live socket', async () => {
    const admin = (await login('superadmin', 'Superadmin@123')).data.token;
    const nurse = (await login(...NURSE)).data.token;
    const socket = await connectSocket(nurse);
    assert(socket.connected, `socket did not connect: ${socket.message}`);
    const nurseId = (await sql("SELECT id FROM hms_users WHERE username = 'nurse'"))[0].id;
    const r = await api('POST', `/security/sessions/${nurseId}/force-logout`, { token: admin });
    assert(r.status === 200, `force-logout ${r.status}`);
    assert(await waitForDisconnect(socket), 'socket stayed connected');
    assert(await me(nurse) === 401, 'token still works after forced logout');
    const again = await connectSocket(nurse);
    assert(!again.connected, 'revoked token opened a new socket');
  });

  await step('Deactivating an account ends its sessions; reactivating does not revive them', async () => {
    const admin = (await login('superadmin', 'Superadmin@123')).data.token;
    const nurse = (await login(...NURSE)).data.token;
    const nurseId = (await sql("SELECT id FROM hms_users WHERE username = 'nurse'"))[0].id;
    assert((await api('PATCH', `/users/${nurseId}/toggle-active`, { token: admin })).status === 200, 'deactivate failed');
    try {
      assert(await me(nurse) === 401, 'token works on a deactivated account');
    } finally {
      assert((await api('PATCH', `/users/${nurseId}/toggle-active`, { token: admin })).status === 200, 'reactivate failed');
    }
    assert(await me(nurse) === 401, 'old session came back after reactivation');
  });

  await step('An idle session times out at the role limit and cannot be reused', async () => {
    const nurse = (await login(...NURSE)).data.token;
    const sid = JSON.parse(Buffer.from(nurse.split('.')[1], 'base64url')).sid;
    await sql("UPDATE hms_sessions SET last_seen_at = now() - interval '3 hours' WHERE id = $1", [sid]);
    const r = await api('GET', '/auth/me', { token: nurse });
    assert(r.status === 401 && /without activity/.test(r.data.message), `idle session answered ${r.status} ${JSON.stringify(r.data)}`);
    await sql("UPDATE hms_sessions SET last_seen_at = now() WHERE id = $1", [sid]);
    assert(await me(nurse) === 401, 'timed-out session was usable again');
  });

  await step('Browsers get an HttpOnly SameSite cookie and no token in the response', async () => {
    const r = await login(...NURSE, { bearer: false });
    assert(r.status === 200 && !r.data.token, 'token returned to a browser login');
    assert(/HttpOnly/i.test(r.setCookie) && /SameSite=Strict/i.test(r.setCookie), `cookie flags: ${r.setCookie}`);
    const get = await fetch(`${API}/auth/me`, { headers: { cookie: r.cookie } });
    assert(get.status === 200, `cookie GET ${get.status}`);
  });

  await step('A cookie-authenticated change without X-Requested-With is refused (CSRF)', async () => {
    const r = await login(...NURSE, { bearer: false });
    const post = (headers) => fetch(`${API}/auth/logout`, { method: 'POST', headers: { cookie: r.cookie, ...headers } });
    assert((await post({})).status === 403, 'cross-site style POST was accepted');
    assert((await post({ 'x-requested-with': 'XMLHttpRequest' })).status === 200, 'same-site POST was refused');
    const after = await fetch(`${API}/auth/me`, { headers: { cookie: r.cookie } });
    assert(after.status === 401, 'cookie session survived logout');
  });

  done();
  process.exit();
})();
