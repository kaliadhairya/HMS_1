// Acceptance gaps closed for C1 (blueprint 5.3): a password-reset token is never a session; a
// downstream service failing during a command leaves nothing half-done and the command can be
// retried; a connection cut mid-command or mid-session loses nothing and duplicates nothing.
const crypto = require('crypto');
const net = require('net');
const { API, api, apiLogin, sql, sleep, inCare, runner, assert, requireThrowawayDb } = require('./helpers');
const { io } = require('../frontend/node_modules/socket.io-client');
const { outpatientAccount } = require('./fixtures/billingFixture');

requireThrowawayDb();
const ORIGIN = API.replace(/\/api$/, '');
const tag = crypto.randomUUID().slice(0, 8);
const MOCK = process.env.ABDM_MOCK_URL || 'http://127.0.0.1:9330';
const mock = async (p, body) => (await fetch(MOCK + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })).json().catch(() => null);
const digits = (n) => Array.from(crypto.randomBytes(n), (b) => b % 10).join('');

// A relay in front of the API that can drop every connection passing through it, and can
// swallow the API's answers so a request arrives but its answer never does.
function relay({ swallowAnswers = false } = {}) {
  const target = new URL(ORIGIN);
  const sockets = new Set();
  const server = net.createServer((client) => {
    const upstream = net.connect(Number(target.port), target.hostname);
    for (const s of [client, upstream]) { sockets.add(s); s.on('error', () => {}); s.on('close', () => sockets.delete(s)); }
    client.pipe(upstream);
    if (!swallowAnswers) upstream.pipe(client); else upstream.resume();
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    url: `http://127.0.0.1:${server.address().port}`,
    cut: () => { for (const s of sockets) s.destroy(); },
    close: () => new Promise((r) => { server.close(() => r()); for (const s of sockets) s.destroy(); }),
  })));
}
function connectSocket(token, origin = ORIGIN) {
  return new Promise((resolve) => {
    const socket = io(origin, { auth: { token }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    socket.received = [];
    socket.onAny((type, data) => socket.received.push({ type, data }));
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', (e) => { socket.close(); resolve(e); });
  });
}

(async () => {
  const { step, done } = runner('Failure modes');

  await step('A password-reset token is refused as a session over HTTP, cookie and socket; a session token cannot reset a password', async () => {
    const password = 'Synthetic@Reset1';
    const hash = await require('../backend/node_modules/bcryptjs').hash(password, 10);
    const username = `reset-${tag}`;
    await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic reset user','receptionist',1,0)", [username, hash]);
    const forgot = await api('POST', '/auth/forgot-password', { body: { usernameOrPhone: username } });
    assert(forgot.status === 200, `forgot ${forgot.status}`);
    const [{ otp_code: otp }] = await sql('SELECT otp_code FROM hms_users WHERE username = $1', [username]);
    const verified = await api('POST', '/auth/verify-otp', { body: { username, otp } });
    const resetToken = verified.data?.resetToken;
    assert(verified.status === 200 && resetToken, `verify-otp ${verified.status}`);
    assert((await api('GET', '/auth/me', { token: resetToken })).status === 401, 'a reset token opened a session (bearer)');
    const viaCookie = await fetch(`${API}/auth/me`, { headers: { cookie: `hms_session=${resetToken}` } });
    assert(viaCookie.status === 401, `a reset token opened a session (cookie): ${viaCookie.status}`);
    assert((await api('GET', '/v2/events', { token: resetToken })).status === 401, 'a reset token read the event feed');
    const socket = await connectSocket(resetToken);
    assert(!(socket && socket.connected), 'a reset token opened a live socket');
    if (socket?.close) socket.close();
    const login = await api('POST', '/auth/login', { body: { username, password }, headers: { 'X-Auth-Transport': 'bearer' } });
    const session = login.data?.token;
    assert(session, `login ${login.status}`);
    const misuse = await api('POST', '/auth/reset-password', { body: { resetToken: session, newPassword: 'Another@Pass2' } });
    assert(misuse.status === 400, `a session token reset a password: ${misuse.status}`);
    const used = await api('POST', '/auth/reset-password', { body: { resetToken, newPassword: 'Changed@Pass3' } });
    assert(used.status === 200, `reset ${used.status}`);
    assert((await api('POST', '/auth/reset-password', { body: { resetToken, newPassword: 'Again@Pass4' } })).status === 400, 'a reset token was used twice');
  });

  await step('A reset code cannot be guessed: a wrong guess cancels it, and unknown accounts get the same answer', async () => {
    const hash = await require('../backend/node_modules/bcryptjs').hash('Synthetic@Guess1', 10);
    const username = `guess-${tag}`;
    await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic guess user','receptionist',1,0)", [username, hash]);
    const known = await api('POST', '/auth/forgot-password', { body: { usernameOrPhone: username } });
    const unknown = await api('POST', '/auth/forgot-password', { body: { usernameOrPhone: `nobody-${tag}` } });
    assert(known.status === 200 && unknown.status === 200 && known.data.message === unknown.data.message, `account existence revealed: ${known.status}/${unknown.status}`);
    const [{ otp_code: otp }] = await sql('SELECT otp_code FROM hms_users WHERE username = $1', [username]);
    const wrong = String((Number(otp) + 1) % 1000000).padStart(6, '1');
    assert((await api('POST', '/auth/verify-otp', { body: { username, otp: wrong } })).status === 400, 'a wrong code was accepted');
    const after = await api('POST', '/auth/verify-otp', { body: { username, otp } });
    assert(after.status === 400 && !after.data.resetToken, 'the right code still worked after a wrong guess');
    assert((await api('POST', '/auth/verify-otp', { body: { username: `nobody-${tag}`, otp } })).status === 400, 'an unknown account answered differently');
  });

  await step('When the ABDM gateway fails during ABHA verification, the request is refused cleanly, nothing is half-recorded, and a retry works', async () => {
    const desk = await apiLogin('receptionist');
    const abha = digits(14);
    const [p] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, dob, phonenumber) VALUES ($1, $2, 'other', 36, 'Female', 'OPD', CURRENT_DATE, '1990-05-01', '9876509876') RETURNING id", [`Mira Shah ${tag}`, `FM-${tag}`]);
    await inCare(p.id);
    await mock('/_mock/profiles', { abhaNumber: abha, abhaAddress: `mira${tag}@sbx`, name: `Mira Shah ${tag}`, gender: 'F', yearOfBirth: '1990', mobile: '9876509876' });
    await mock('/_mock/fail', { prefix: '/v3/profile/login/request/otp', count: 1, status: 503 });
    const failed = await api('POST', `/abdm/patients/${p.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: abha } });
    assert(failed.status >= 500 || failed.status === 409 || failed.status === 424, `gateway failure answered ${failed.status} ${JSON.stringify(failed.data).slice(0, 160)}`);
    assert(!/stack|ECONN|at \//.test(JSON.stringify(failed.data)), 'the failure leaked internal details');
    const pending = await sql("SELECT status FROM hms_abha_verifications WHERE patient_id = $1 AND status = 'OtpSent'", [p.id]).catch(() => []);
    assert(pending.length === 0, 'a verification waits for an OTP that was never sent');
    assert((await sql("SELECT 1 FROM hms_patient_identifiers WHERE patient_id = $1 AND issuer = 'ABDM'", [p.id])).length === 0, 'an identifier was recorded');
    assert((await api('GET', '/auth/me', { token: desk })).status === 200, 'the failure ended the user session');
    const retry = await api('POST', `/abdm/patients/${p.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: abha } });
    assert(retry.status === 201 && retry.data.data.status === 'OtpSent', `retry ${retry.status} ${JSON.stringify(retry.data).slice(0, 160)}`);
  });

  await step('A command whose connection is cut before the answer commits once; the retry with the same key returns the original result', async () => {
    const desk = await apiLogin('receptionist');
    const { patientId, patientPublic } = await outpatientAccount('Cut connection');
    const r = await relay({ swallowAnswers: true });
    const key = crypto.randomUUID();
    const body = JSON.stringify({ patient_id: patientPublic, amount: 75, method: 'Cash' });
    // The request reaches the API, which commits it; its answer never reaches the client.
    const lost = fetch(`${r.url}/api/v2/payments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${desk}`, 'idempotency-key': key }, body })
      .then((res) => res.status).catch(() => 'cut');
    let committed = [];
    for (let i = 0; i < 100 && !committed.length; i++) {
      committed = await sql("SELECT state FROM hms_idempotency_keys WHERE idempotency_key = $1 AND state = 'completed'", [key]);
      if (!committed.length) await sleep(100);
    }
    assert(committed.length === 1, 'the API did not commit the request before the cut');
    r.cut();
    assert(await lost === 'cut', 'the client received an answer through the cut connection');
    await r.close();
    const retry = await fetch(`${API}/v2/payments`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${desk}`, 'idempotency-key': key }, body });
    const data = await retry.json();
    assert(retry.status === 201 && data.data?.id, `retry ${retry.status} ${JSON.stringify(data).slice(0, 160)}`);
    const intents = await sql("SELECT id FROM hms_payment_intents WHERE patient_id = $1 AND purpose = 'deposit'", [patientId]);
    assert(intents.length === 1 && intents[0].id === data.data.id, `${intents.length} deposits after a cut and a retry`);
    const funds = await sql("SELECT billing_fund_balance(id) AS b FROM hms_patient_funds WHERE patient_id = $1", [patientId]);
    assert(funds.length === 1 && Number(funds[0].b) === 75, `deposit balance ${JSON.stringify(funds)}`);
  });

  await step('A live connection cut mid-session misses nothing: the events published meanwhile are recovered from the cursor', async () => {
    const nurse = await apiLogin('nurse');
    const r = await relay();
    const start = (await api('GET', '/v2/events', { token: nurse })).data.data.next_cursor;
    const socket = await connectSocket(nurse, r.url);
    assert(socket.connected, 'socket did not connect through the relay');
    const lostConnection = new Promise((resolve) => socket.on('disconnect', resolve));
    r.cut();
    await Promise.race([lostConnection, sleep(5000)]);
    assert(!socket.connected, 'the socket survived the cut');
    const PROBE = `cut_probe_${tag}`;
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(String((await sql("INSERT INTO hms_outbox (event_type, audience, payload) VALUES ($1, 'all', CAST($2 AS jsonb)) RETURNING id", [PROBE, JSON.stringify({ n: i })]))[0].id));
    const end = Date.now() + 10000;
    let got = [];
    while (Date.now() < end && got.length < 3) {
      const page = await api('GET', `/v2/events?cursor=${start}`, { token: nurse });
      got = page.data.data.events.filter((e) => e.type === PROBE).map((e) => e.id);
      if (got.length < 3) await sleep(300);
    }
    assert(JSON.stringify(got) === JSON.stringify(ids), `recovered ${JSON.stringify(got)} of ${JSON.stringify(ids)}`);
    socket.close();
    await r.close();
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
