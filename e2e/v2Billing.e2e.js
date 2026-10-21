// Billing through the v2 API (completion A3, blueprint 3.10): charges on an account, a reviewed
// draft issued as a source-linked invoice (If-Match on the draft version), a deposit applied to it,
// a credit note, and a cancelled charge. Retries post once; roles, stale drafts and oversized
// amounts are refused; the journal stays balanced.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

const { outpatientAccount } = require('./fixtures/billingFixture');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const key = (extra = {}) => ({ 'idempotency-key': crypto.randomUUID(), ...extra });
const short = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`;
const money = (v) => Math.round(Number(v) * 100) / 100;

(async () => {
  const { step, done } = runner('V2 billing');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');

  const { patientId, patientPublic, accountId } = await outpatientAccount('V2 billing');
  const charges = async () => (await sql('SELECT count(*)::int AS n FROM hms_charge_events WHERE account_id = $1', [accountId]))[0].n;
  const journalBalanced = async () => (await sql('SELECT entry_id FROM hms_journal_lines GROUP BY entry_id HAVING sum(debit) <> sum(credit)')).length === 0;
  let invoice;

  await step('A nurse cannot add charges to an outpatient account; a bad quantity is a field error', async () => {
    const r = await call('POST', `/v2/billing-accounts/${accountId}/charges`, nurse, { code: 'CONSULT-DEFAULT' }, key());
    assert(r.status === 403, `nurse on an outpatient account: ${short(r)}`);
    const q = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { code: 'CONSULT-DEFAULT', quantity: -2 }, key());
    assert(q.status === 422, `negative quantity: ${short(q)}`);
    const hand = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { category: 'Procedure', description: 'Dressing', unit_price: 50, reason: 'Not on the list' }, key());
    assert(hand.status === 403, `receptionist priced a service by hand: ${short(hand)}`);
  });

  await step('The desk adds a price-list charge; a retried request with the same key posts it once', async () => {
    const before = await charges();
    const sameKey = crypto.randomUUID();
    const a = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { code: 'CONSULT-DEFAULT' }, { 'idempotency-key': sameKey });
    const b = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { code: 'CONSULT-DEFAULT' }, { 'idempotency-key': sameKey });
    assert(a.status === 201 && a.data.data.code === 'CONSULT-DEFAULT' && a.data.data.amount === '200.00', `charge ${short(a)}`);
    assert(b.status === 201 && b.data.data.id === a.data.data.id, `replay ${short(b)}`);
    assert(await charges() === before + 1, 'a retried charge posted twice');
    const draft = await call('POST', `/v2/billing-accounts/${accountId}/draft-invoice`, desk, {}, key());
    assert(draft.status === 200 && draft.data.data.status === 'Draft' && money(draft.data.data.total) === 200, `draft ${short(draft)}`);
    const view = await call('GET', `/v2/billing-accounts/${accountId}`, desk);
    assert(view.status === 200 && view.data.data.patient_id === patientPublic && view.data.data.draft_invoice?.version === draft.data.data.version, `account ${short(view)}`);
  });

  await step('Issuing needs the reviewed draft version: missing is 428, a draft changed by a later charge is 412', async () => {
    const seen = (await call('GET', `/v2/billing-accounts/${accountId}`, desk)).data.data.draft_invoice;
    const missing = await call('POST', `/v2/billing-accounts/${accountId}/invoices`, desk, {}, key());
    assert(missing.status === 428, `no If-Match: ${short(missing)}`);
    const added = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { code: 'LAB-DEFAULT' }, key());
    assert(added.status === 201, `second charge ${short(added)}`);
    const stale = await call('POST', `/v2/billing-accounts/${accountId}/invoices`, desk, {}, key({ 'if-match': `"${seen.version}"` }));
    assert(stale.status === 412 && stale.data.code === 'VERSION_CONFLICT', `stale draft issued: ${short(stale)}`);
    const [{ n }] = await sql("SELECT count(*)::int AS n FROM hms_invoices WHERE account_id = $1 AND status <> 'Draft'", [accountId]);
    assert(n === 0, 'a refused issue left an invoice');
  });

  await step('The reviewed draft is issued once; its lines name the charges they bill', async () => {
    const draft = (await call('GET', `/v2/billing-accounts/${accountId}`, desk)).data.data.draft_invoice;
    const sameKey = crypto.randomUUID();
    const a = await call('POST', `/v2/billing-accounts/${accountId}/invoices`, desk, {}, { 'idempotency-key': sameKey, 'if-match': `"${draft.version}"` });
    const b = await call('POST', `/v2/billing-accounts/${accountId}/invoices`, desk, {}, { 'idempotency-key': sameKey, 'if-match': `"${draft.version}"` });
    assert(a.status === 201 && a.data.data.status === 'Issued' && a.data.data.invoice_number, `issue ${short(a)}`);
    assert(b.status === 201 && b.data.data.invoice_number === a.data.data.invoice_number, `replay ${short(b)}`);
    invoice = a.data.data;
    assert(money(invoice.total) === 300 && invoice.lines.length === 2 && invoice.lines.every((l) => l.charge_id), `lines ${JSON.stringify(invoice.lines).slice(0, 200)}`);
    const ids = (await sql('SELECT id FROM hms_charge_events WHERE account_id = $1', [accountId])).map((r) => r.id);
    assert(invoice.lines.every((l) => ids.includes(l.charge_id)), 'an invoice line names a charge of another account');
  });

  let fundId;
  await step('A deposit is applied to the invoice once; more than its balance is refused', async () => {
    const dep = await call('POST', '/v2/payments', desk, { patient_id: patientPublic, amount: 120, method: 'Cash' }, key());
    assert(dep.status === 201, `deposit ${short(dep)}`);
    [{ id: fundId }] = await sql("SELECT id FROM hms_patient_funds WHERE patient_id = $1 AND kind = 'deposit' ORDER BY created_at DESC LIMIT 1", [patientId]);
    const over = await call('POST', '/v2/deposit-allocations', desk, { fund_id: fundId, invoice_id: invoice.id, amount: 500 }, key());
    assert(over.status === 422 && over.data.code === 'FUND_OVERALLOCATED', `over-allocation ${short(over)}`);
    const sameKey = crypto.randomUUID();
    const a = await call('POST', '/v2/deposit-allocations', desk, { fund_id: fundId, invoice_id: invoice.id, amount: 100 }, { 'idempotency-key': sameKey });
    const b = await call('POST', '/v2/deposit-allocations', desk, { fund_id: fundId, invoice_id: invoice.id, amount: 100 }, { 'idempotency-key': sameKey });
    assert(a.status === 201 && a.data.data.amount === '100.00' && b.data?.data?.id === a.data.data.id, `allocation ${short(a)} / ${short(b)}`);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_allocations WHERE fund_id = $1', [fundId]);
    assert(n === 1, `${n} allocations for one retried request`);
    const [{ due }] = await sql('SELECT billing_invoice_patient_due($1) AS due', [invoice.id]);
    assert(money(due) === 200, `due after the deposit: ${due}`);
  });

  await step('A billed charge cannot be cancelled; it is corrected by an administrator\'s credit note', async () => {
    const r = await call('POST', `/v2/charges/${invoice.lines[0].charge_id}/reverse`, desk, { reason: 'Entered on the wrong visit' }, key());
    assert(r.status === 409 && r.data.code === 'CHARGE_INVOICED', `invoiced charge cancelled: ${short(r)}`);
    const line = invoice.lines.find((l) => l.code === 'LAB-DEFAULT');
    const body = { invoice_id: invoice.id, reason: 'Test not performed', lines: [{ invoice_line_id: line.id, amount: 100 }] };
    const byDesk = await call('POST', '/v2/credit-notes', desk, body, key());
    assert(byDesk.status === 403, `desk raised a credit note: ${short(byDesk)}`);
    const note = await call('POST', '/v2/credit-notes', admin, body, key());
    assert(note.status === 201 && note.data.data.note_number && note.data.data.kind === 'credit', `credit note ${short(note)}`);
    const [{ due }] = await sql('SELECT billing_invoice_patient_due($1) AS due', [invoice.id]);
    assert(money(due) === 100, `due after the credit note: ${due}`);
  });

  await step('A charge not yet billed is cancelled with a linked reversal; the journal stays balanced', async () => {
    const extra = await call('POST', `/v2/billing-accounts/${accountId}/charges`, desk, { code: 'LAB-DEFAULT' }, key());
    assert(extra.status === 201, `extra charge ${short(extra)}`);
    const noReason = await call('POST', `/v2/charges/${extra.data.data.id}/reverse`, desk, {}, key());
    assert(noReason.status === 422, `reversal without a reason: ${short(noReason)}`);
    const rev = await call('POST', `/v2/charges/${extra.data.data.id}/reverse`, desk, { reason: 'Ordered twice by mistake' }, key());
    assert(rev.status === 201 && rev.data.data.reverses_id === extra.data.data.id && money(rev.data.data.amount) === -100, `reversal ${short(rev)}`);
    const again = await call('POST', `/v2/charges/${rev.data.data.id}/reverse`, desk, { reason: 'Reverse the reversal' }, key());
    assert(again.status === 409, `a reversal was reversed: ${short(again)}`);
    assert(await journalBalanced(), 'the journal has an unbalanced entry');
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
