// The journal covers counter sales and bills raised before Phase 5
// (migration 0098): a counter sale posts one balanced entry when it commits,
// old bills' balances are opening receivables, and payments and discounts on
// them post as they happen. The reconciliation checks agree with the journal.
const { api, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const comparisons = async (token) => {
  const r = await api('POST', '/finance/reconciliation/run', { token, body: {} });
  assert(r.status === 200, `reconciliation ${r.status} ${JSON.stringify(r.data)}`);
  return Object.fromEntries(r.data.data.comparisons.map((c) => [c.name, c]));
};

(async () => {
  const { step, done } = runner('Accounts');
  const admin = await apiLogin('admin');
  const desk = await apiLogin('receptionist');
  let legacy;

  await step('A counter sale posts one balanced entry at commit: cash against pharmacy revenue and GST', async () => {
    const [m] = await sql('SELECT b.id AS batch_id, b.medicine_id FROM hms_medicine_batches b ORDER BY b.id LIMIT 1');
    assert(m, 'needs a medicine batch in the test copy');
    const [{ id }] = await sql("SELECT nextval('hms_otc_sale_seq')::int AS id");
    // Header and lines in one transaction, as the pharmacy writes them.
    await sql(`INSERT INTO hms_otc_sales (id, patient_id, sold_by, total_amount, payment_mode, bill_number) VALUES (${id}, NULL, NULL, 0, 'UPI', 'OTC-E2E-${id}');
      INSERT INTO hms_otc_items (id, otc_sale_id, medicine_id, batch_id, quantity, rate, gst_amount, amount) VALUES (nextval('hms_otc_item_seq'), ${id}, ${m.medicine_id}, ${m.batch_id}, 2, 50, 12, 112);
      UPDATE hms_otc_sales SET total_amount = 112 WHERE id = ${id}`);
    const lines = await sql(`SELECT l.gl_code, l.debit::float, l.credit::float FROM hms_journal_lines l JOIN hms_journal_entries e ON e.id = l.entry_id
      WHERE e.source_type = 'counter_sale' AND e.source_key = $1 ORDER BY l.gl_code`, [String(id)]);
    const by = Object.fromEntries(lines.map((l) => [l.gl_code, l]));
    assert(lines.length === 3 && by['1010'].debit === 112 && by['4020'].credit === 100 && by['2100'].credit === 12, `entry ${JSON.stringify(lines)}`);
    const c = await comparisons(admin);
    assert(c['Counter sales posted'].ok, `counter sales vs journal: ${JSON.stringify(c['Counter sales posted'])}`);
  });

  await step('What was owed on bills raised before Phase 5 is an opening receivable that agrees with the bills', async () => {
    [legacy] = await sql(`SELECT b.id, b.patient_id, billing_legacy_due(b.id)::float AS due FROM hms_bills b
      WHERE billing_is_legacy_bill(b.id) AND COALESCE(b.status, '') NOT IN ('Cancelled', 'Paid') AND billing_legacy_due(b.id) > 0 ORDER BY b.id LIMIT 1`);
    if (!legacy) {
      // The backup has no unpaid old bill: make one the way old bills looked.
      const [p] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 1');
      [legacy] = await sql(`INSERT INTO hms_bills (id, patient_id, bill_type, bill_number, status, total_amount, discount_amount, gst_amount, net_payable, advance_adjusted, created_at, updated_at)
        VALUES (nextval('hms_bills_seq'), $1, 'OPD', 'OLD-E2E', 'Pending', 300, 0, 0, 300, 0, now(), now()) RETURNING id, patient_id, 300::float AS due`, [p.id]);
    }
    // A bill written without an invoice becomes a receivable when it commits.
    const [{ id: written }] = await sql(`INSERT INTO hms_bills (id, patient_id, bill_type, bill_number, status, total_amount, discount_amount, gst_amount, net_payable, advance_adjusted, created_at, updated_at)
      SELECT nextval('hms_bills_seq'), id, 'OPD', 'OLD-E2E-2', 'Pending', 40, 0, 0, 40, 0, now(), now() FROM hms_patients ORDER BY id LIMIT 1 RETURNING id`);
    const [opening] = await sql("SELECT l.debit::float FROM hms_journal_entries e JOIN hms_journal_lines l ON l.entry_id = e.id WHERE e.source_type = 'legacy_opening' AND e.source_key = $1 AND l.gl_code = '1100'", [String(written)]);
    assert(opening && opening.debit === 40, `no opening receivable for a bill written without an invoice: ${JSON.stringify(opening)}`);
    const c = await comparisons(admin);
    assert(c['Patient receivables'].ok && c['Trial balance'].ok, `receivables ${JSON.stringify(c['Patient receivables'])}`);
  });

  await step('A payment and a discount on an old bill post to the journal and keep receivables in agreement', async () => {
    const pay = await api('POST', `/billing/${legacy.id}/payment`, { token: desk, body: { amount: 1, paymentMode: 'Cash' } });
    assert(pay.status === 200, `old-path payment ${pay.status} ${JSON.stringify(pay.data)}`);
    const [entry] = await sql(`SELECT e.id FROM hms_journal_entries e WHERE e.source_type = 'legacy_payment' AND e.source_key = $1`, [String(pay.data.data.id)]);
    assert(entry, 'the payment was not posted');
    const [bill] = await sql('SELECT net_payable::float AS net, discount_amount::float AS disc FROM hms_bills WHERE id = $1', [legacy.id]);
    if (legacy.due > 2) {
      const d = await api('POST', `/billing/${legacy.id}/discount`, { token: admin, body: { amount: bill.disc + 1 } });
      assert(d.status === 200, `old-path discount ${d.status} ${JSON.stringify(d.data)}`);
      assert((await sql("SELECT 1 FROM hms_journal_entries WHERE source_type = 'legacy_adjustment' AND source_key LIKE $1", [`${legacy.id}:%`])).length === 1, 'the discount was not posted');
    }
    const c = await comparisons(admin);
    for (const name of ['Patient receivables', 'Receipts posted', 'Counter sales posted', 'Trial balance']) assert(c[name].ok, `${name}: ${JSON.stringify(c[name])}`);
  });

  done();
  process.exit();
})();
