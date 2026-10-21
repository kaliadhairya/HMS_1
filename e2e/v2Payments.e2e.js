// Payments through the v2 API (completion A3): a payment against an issued invoice reduces its
// balance once; a retried request with the same key records nothing extra; overpayment,
// a missing transaction reference and an unauthorised role are refused.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

const { issuedInvoice } = require('./fixtures/billingFixture');

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
  const { step, done } = runner('V2 payments');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  // Its own issued invoice (two consultations, Rs. 400), so the suite does not depend on earlier suites.
  const { invoice } = await issuedInvoice(2, 'V2 payments');
  const inv = { id: invoice.id, due: invoice.patient_due };
  assert(Number(inv.due) > 200, `the fixture invoice is due ${inv.due}`);
  const due = () => sql('SELECT billing_invoice_patient_due($1) AS due', [inv.id]).then((r) => Number(r[0].due));
  const intents = async () => (await sql('SELECT count(*)::int AS n FROM hms_payment_intents WHERE invoice_id = $1', [inv.id]))[0].n;
  const startDue = Number(inv.due);
  // A quarter each time: the payment and its retried request leave a balance for the overpayment check.
  const part = Math.floor(startDue / 4);
  const payment = { invoice_id: inv.id, amount: part, method: 'Cash' };

  await step('A nurse cannot take a payment', async () => {
    const r = await call('POST', '/v2/payments', nurse, payment, key());
    assert(r.status === 403, `nurse took a payment: ${r.status}`);
  });

  let first;
  await step('A cash payment against an issued invoice is recorded once and reduces the balance', async () => {
    const before = await intents();
    first = await call('POST', '/v2/payments', desk, payment, key());
    assert(first.status === 201 && first.data.data.state, `payment ${first.status} ${JSON.stringify(first.data).slice(0, 220)}`);
    assert(first.data.data.amount === part && first.data.data.invoice_id === inv.id, `fields ${JSON.stringify(first.data.data).slice(0, 200)}`);
    assert(await intents() === before + 1, 'the payment was not recorded once');
    assert(Math.abs((await due()) - (startDue - part)) < 0.01, `balance ${await due()} expected ${startDue - part}`);
  });

  await step('A retried payment with the same key records nothing extra and reduces the balance once', async () => {
    const sameKey = crypto.randomUUID();
    const a = await call('POST', '/v2/payments', desk, payment, { 'idempotency-key': sameKey });
    const b = await call('POST', '/v2/payments', desk, payment, { 'idempotency-key': sameKey });
    assert(a.status === 201 && b.data?.data?.id === a.data?.data?.id, `retry ${b.status} ${JSON.stringify(b.data).slice(0, 160)}`);
    const n = (await sql('SELECT count(*)::int AS n FROM hms_payment_intents WHERE invoice_id = $1 AND id = $2', [inv.id, a.data.data.id]))[0].n;
    assert(n === 1, `${n} payment records for one retried request`);
  });

  await step('A payment above the balance is refused and changes nothing', async () => {
    const before = await due();
    const r = await call('POST', '/v2/payments', desk, { invoice_id: inv.id, amount: before + 500, method: 'Cash' }, key());
    assert(r.status === 422 && r.data.code === 'MORE_THAN_DUE', `overpayment: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
    assert(Math.abs((await due()) - before) < 0.01, 'a refused overpayment changed the balance');
  });

  await step('An electronic payment without a transaction reference is refused', async () => {
    const r = await call('POST', '/v2/payments', desk, { invoice_id: inv.id, amount: 1, method: 'UPI', outcome: 'confirmed' }, key());
    assert(r.status === 422, `UPI without reference: ${r.status} ${JSON.stringify(r.data).slice(0, 120)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
