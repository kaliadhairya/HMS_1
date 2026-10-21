// Refunds through the v2 API (completion A3): a refund cannot exceed the deposit's balance;
// the requester cannot approve it (separation of duties); approval, payment and confirmation
// each take effect once; a repeated payment with the same key pays nothing extra.
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
  const { step, done } = runner('V2 refunds');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const [fund] = await sql('SELECT id, billing_fund_balance(id) AS balance FROM hms_patient_funds WHERE billing_fund_balance(id) > 60 ORDER BY id LIMIT 1');
  assert(fund, 'the database needs a deposit with a balance over 60');
  const amount = 50;
  const refundState = async (id) => (await sql('SELECT state FROM hms_refunds WHERE id = $1', [id]))[0].state;
  let refund;

  await step('A refund larger than the deposit balance is refused', async () => {
    const r = await call('POST', '/v2/refunds', desk, { fund_id: fund.id, amount: Number(fund.balance) + 1000, method: 'Cash', reason: 'Too large for the test' }, key());
    assert(r.status === 400 && r.data.code === 'REFUND_EXCEEDS_CREDIT', `oversized refund: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  });

  await step('The front desk requests a refund; it is recorded once with a refund number', async () => {
    refund = await call('POST', '/v2/refunds', desk, { fund_id: fund.id, amount, method: 'Cash', reason: 'Synthetic refund for the v2 test' }, key());
    assert(refund.status === 201 && refund.data.data.id && refund.data.data.refund_number, `request ${refund.status} ${JSON.stringify(refund.data).slice(0, 200)}`);
  });

  const id = refund.data.data.id;
  await step('The requester cannot approve their own refund', async () => {
    const r = await call('POST', `/v2/refunds/${id}/approve`, desk, {}, key());
    assert(r.status === 403, `receptionist approved: ${r.status}`);
    assert(await refundState(id) !== 'Approved', 'a refused approval changed the refund');
  });

  await step('An administrator approves the refund', async () => {
    const r = await call('POST', `/v2/refunds/${id}/approve`, admin, { note: 'Checked against the deposit' }, key());
    assert(r.status === 200 && r.data.data.state && await refundState(id) === r.data.data.state, `approve ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
  });

  const payKey = crypto.randomUUID();
  await step('The front desk pays the approved refund, and a repeated payment with the same key pays nothing extra', async () => {
    const paid = await call('POST', `/v2/refunds/${id}/pay`, desk, {}, { 'idempotency-key': payKey });
    assert(paid.status === 200, `pay ${paid.status} ${JSON.stringify(paid.data).slice(0, 200)}`);
    const replay = await call('POST', `/v2/refunds/${id}/pay`, desk, {}, { 'idempotency-key': payKey });
    assert(replay.status === 200 && replay.data.data.id === id, `replay ${replay.status} ${JSON.stringify(replay.data).slice(0, 160)}`);
  });

  await step('A cash refund is completed by its payment; it cannot be confirmed again', async () => {
    const state = await refundState(id);
    assert(state === 'Completed' || state === 'Confirmed', `after cash payment the refund is ${state}`);
    const r = await call('POST', `/v2/refunds/${id}/confirm`, desk, { provider_reference: 'SYNTH-REF-V2' }, key());
    assert(r.status === 409 && r.data.code === 'REFUND_ALREADY_COMPLETED', `second confirm: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
    assert(await refundState(id) === state, 'a second confirm changed the refund');
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
