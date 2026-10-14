// Idempotency (migration 0007): a retried or repeated command runs once.
// Uses the advance-deposit command; every step counts the deposits in the
// database rather than trusting the responses.
const crypto = require('crypto');
const { Client } = require('../backend/node_modules/pg');
const { requestHash } = require('../backend/utils/idempotency');
const { API, apiLogin, sql, runner, assert, stamp } = require('./helpers');

async function advance(token, key, body) {
  const res = await fetch(`${API}/billing/advance`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, replay: res.headers.get('idempotent-replay') === 'true', requestId: res.headers.get('x-request-id'), data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('Idempotency');
  const desk = await apiLogin('receptionist');
  const [patient] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 1');
  const [deskUser] = await sql("SELECT id FROM hms_users WHERE username = 'receptionist'");
  const [{id:facilityId}] = await sql('SELECT hms_initial_facility() id');
  const receiptHash = body => requestHash({method:'POST',originalUrl:'/api/billing/advance',body,user:{facilityId},headers:{}});
  const tag = `E2E idem ${stamp()}`;
  // Phase 5: an advance is a deposit payment with a receipt (hms_payment_intents carries the note).
  const deposits = async (note) => (await sql(`SELECT count(*)::int AS n FROM hms_receipts r JOIN hms_payment_intents i ON i.id = r.intent_id
    WHERE i.purpose = 'deposit' AND i.notes = $1`, [note]))[0].n;
  const body = (note, amount = 101) => ({ patientId: patient.id, amount, paymentMode: 'Cash', notes: note });

  await step('A financial command without an Idempotency-Key is refused (428)', async () => {
    const note = `${tag} no-key`;
    const r = await advance(desk, null, body(note));
    assert(r.status === 428, `status ${r.status}`);
    assert(await deposits(note) === 0, 'a deposit was recorded anyway');
  });

  await step('Repeating a request with the same key replays the first answer and records one deposit', async () => {
    const note = `${tag} replay`;
    const key = crypto.randomUUID();
    const first = await advance(desk, key, body(note));
    const second = await advance(desk, key, body(note));
    assert(first.status === 201, `first ${first.status} ${JSON.stringify(first.data)}`);
    assert(second.status === 201 && second.replay, `second ${second.status} replay=${second.replay}`);
    assert(second.data.data.id === first.data.data.id, 'replay returned a different deposit');
    assert(await deposits(note) === 1, `${await deposits(note)} deposits recorded`);
  });

  await step('Reusing a key for a different request is refused (409)', async () => {
    const note = `${tag} mismatch`;
    const key = crypto.randomUUID();
    assert((await advance(desk, key, body(note, 50))).status === 201, 'first request failed');
    const other = await advance(desk, key, body(note, 999));
    assert(other.status === 409, `status ${other.status}`);
    assert(await deposits(note) === 1, 'the different request was recorded');
  });

  await step('Twenty simultaneous requests with one key record exactly one deposit', async () => {
    const note = `${tag} concurrent`;
    const key = crypto.randomUUID();
    const results = await Promise.all(Array.from({ length: 20 }, () => advance(desk, key, body(note))));
    const statuses = results.map((r) => r.status);
    // Each one either ran (201), replayed the stored answer (201) or found the original still running (409).
    assert(statuses.every((s) => s === 201 || s === 409), `unexpected statuses ${statuses.join(',')}`);
    assert(await deposits(note) === 1, `${await deposits(note)} deposits recorded`);
  });

  await step('Legacy committed changes without a receipt are held for reconciliation, without repeating the deposit', async () => {
    const note = `${tag} crash-after-commit`;
    const key = crypto.randomUUID();
    assert((await advance(desk, key, body(note))).status === 201, 'original failed');
    // Make the key look as if the server stopped after committing but before storing its answer.
    await sql(`UPDATE hms_idempotency_keys SET state = 'in_progress', response_status = NULL, response_body = NULL, finished_at = NULL,
                      created_at = now() - interval '10 minutes'
               WHERE user_id = $1 AND idempotency_key = $2`, [deskUser.id, key]);
    const retry = await advance(desk, key, body(note));
    assert(retry.status === 409 && retry.data.code === 'IDEMPOTENCY_OUTCOME_UNKNOWN', `retry ${retry.status} ${JSON.stringify(retry.data)}`);
    assert(await deposits(note) === 1, `${await deposits(note)} deposits recorded`);
  });

  await step('An old uncommitted claim stays locked; a rolled-back original can be retried safely', async () => {
    const note = `${tag} crash-before-commit`;
    const key = crypto.randomUUID();
    const c = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
    await c.connect();
    try {
      await c.query('BEGIN');
      await c.query(`INSERT INTO hms_idempotency_keys (user_id,idempotency_key,method,path,request_hash,request_id,state,created_at)
        VALUES ($1,$2,'POST','/api/billing/advance',$3,$4,'in_progress',now()-interval '10 minutes')`,
        [deskUser.id,key,receiptHash(body(note)),crypto.randomUUID()]);
      const blocked = await advance(desk,key,body(note));
      assert(blocked.status === 409 && blocked.data.code === 'IDEMPOTENCY_IN_PROGRESS','old active request was not held');
      assert(await deposits(note) === 0,'retry created a deposit while original was active');
      await c.query('ROLLBACK');
      const retried = await advance(desk,key,body(note));
      assert(retried.status === 201,'retry after rollback failed');
      assert((await advance(desk,key,body(note))).replay,'completed result not replayed');
      assert(await deposits(note) === 1,'duplicate deposit after rollback');
    } finally { await c.end(); }
  });

  await step('A request still in progress is not run a second time (409)', async () => {
    const note = `${tag} in-progress`;
    const key = crypto.randomUUID();
    await sql(`INSERT INTO hms_idempotency_keys (user_id, idempotency_key, method, path, request_hash, request_id, state)
               VALUES ($1, $2, 'POST', '/api/billing/advance', $3, $4, 'in_progress')`,
    [deskUser.id, key, receiptHash(body(note)), `live-${crypto.randomUUID()}`]);
    const r = await advance(desk, key, body(note));
    assert(r.status === 409, `status ${r.status}`);
    assert(await deposits(note) === 0, 'command ran while the original was in progress');
  });

  await step('Keys are per user: another user with the same key gets their own result', async () => {
    const admin = await apiLogin('admin');
    const note = `${tag} per-user`;
    const key = crypto.randomUUID();
    assert((await advance(desk, key, body(note))).status === 201, 'desk request failed');
    const other = await advance(admin, key, body(note));
    assert(other.status === 201 && !other.replay, `admin got ${other.status} replay=${other.replay}`);
    assert(await deposits(note) === 2, `${await deposits(note)} deposits recorded`);
  });

  done();
  process.exit(process.exitCode || 0);
})();
