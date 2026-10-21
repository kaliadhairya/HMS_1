// Laboratory orders through the v2 API (completion A3): the patient, encounter and order are
// named by public identifier; a retried order is not created twice; an order whose patient
// does not match its encounter is refused; cancelling needs the current order revision.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), headers: res.headers };
}
const key = () => ({ 'idempotency-key': crypto.randomUUID() });

(async () => {
  const { step, done } = runner('V2 laboratory orders');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [enc] = await sql(`SELECT e.id, e.patient_id, e.public_id AS enc_public, p.public_id AS patient_public FROM hms_encounters e
    JOIN hms_patients p ON p.id = e.patient_id
    JOIN hms_care_team_assignments c ON c.patient_id = e.patient_id AND c.practitioner_user_id = $1 AND c.valid_to IS NULL
    WHERE e.status <> 'Finalized' ORDER BY e.id LIMIT 1`, [doctorUser.id]);
  assert(enc, 'the database needs an open encounter for a patient in the doctor\'s care');
  const [other] = await sql('SELECT public_id FROM hms_patients WHERE id <> $1 ORDER BY id LIMIT 1', [enc.patient_id]);
  const [test] = await sql('SELECT id FROM hms_lab_test_versions WHERE effective_at <= now() AND (expires_at IS NULL OR expires_at > now()) ORDER BY id LIMIT 1');
  assert(test, 'the database needs an active laboratory test version');
  const countOrders = async () => (await sql('SELECT count(*)::int AS n FROM hms_investigation_orders WHERE encounter_id = $1', [enc.id]))[0].n;
  const order = { patient_id: enc.patient_public, encounter_id: enc.enc_public, test_version_ids: [test.id] };
  let created;

  await step('A nurse cannot order laboratory tests', async () => {
    const r = await call('POST', '/v2/lab-orders', nurse, order, key());
    assert(r.status === 403, `nurse ordered: ${r.status}`);
  });

  await step('A doctor orders a test for a patient and encounter named by public identifier', async () => {
    const before = await countOrders();
    const r = await call('POST', '/v2/lab-orders', doctor, order, key());
    assert(r.status === 201 && /^[0-9a-f-]{36}$/i.test(r.data.data.id), `order ${r.status} ${JSON.stringify(r.data).slice(0, 220)}`);
    assert(await countOrders() === before + 1, 'the order was not saved once');
    assert(Number.isInteger(r.data.data.version) && r.data.data.items.length === 1, `fields ${JSON.stringify(r.data.data).slice(0, 200)}`);
    created = r;
  });

  await step('A retried order with the same key creates no second order', async () => {
    const sameKey = crypto.randomUUID();
    const first = await call('POST', '/v2/lab-orders', doctor, order, { 'idempotency-key': sameKey });
    const again = await call('POST', '/v2/lab-orders', doctor, order, { 'idempotency-key': sameKey });
    assert(first.status === 201 && again.status === 201 && again.data?.data?.id === first.data?.data?.id, `retry ${again.status} ${JSON.stringify(again.data).slice(0, 120)}`);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_investigation_orders WHERE encounter_id = $1 AND public_id = $2', [enc.id, first.data.data.id]);
    assert(n === 1, `${n} orders for one retried request`);
  });

  await step('An order whose patient does not match its encounter is refused', async () => {
    const r = await call('POST', '/v2/lab-orders', doctor, { patient_id: other.public_id, encounter_id: enc.enc_public, test_version_ids: [test.id] }, key());
    assert(r.status >= 400 && r.status < 500, `mismatch accepted: ${r.status}`);
  });

  const orderId = created.data.data.id;
  await step('Cancelling needs the order revision; a stale revision changes nothing', async () => {
    const none = await call('POST', `/v2/lab-orders/${orderId}/cancel`, doctor, {}, key());
    assert(none.status === 428, `no If-Match: ${none.status}`);
    const stale = await call('POST', `/v2/lab-orders/${orderId}/cancel`, doctor, {}, { ...key(), 'if-match': '"999"' });
    assert(stale.status >= 400 && stale.status < 500 && stale.data.code === 'VERSION_CONFLICT', `stale: ${stale.status} ${JSON.stringify(stale.data).slice(0, 120)}`);
    const [row] = await sql('SELECT status FROM hms_investigation_orders WHERE public_id = $1', [orderId]);
    assert(row.status !== 'Cancelled', 'a stale cancel cancelled the order');
  });

  await step('A nurse cannot cancel an order; the doctor cancels with the current revision', async () => {
    const denied = await call('POST', `/v2/lab-orders/${orderId}/cancel`, nurse, {}, { ...key(), 'if-match': `"${created.data.data.version}"` });
    assert(denied.status === 403, `nurse cancelled: ${denied.status}`);
    const r = await call('POST', `/v2/lab-orders/${orderId}/cancel`, doctor, {}, { ...key(), 'if-match': `"${created.data.data.version}"` });
    assert(r.status === 200 && r.data.data.status === 'Cancelled', `cancel ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
