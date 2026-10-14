// Reconciliation (Phase 5, migration 0076): cash drawers, bank/provider/payer
// settlement lines, and continuous checks that open owned exceptions when
// receipts, settlements, subledgers and the journal disagree.
const { sequelize } = require('../models/db');
const B = require('./billing');

const { fail, rows, one, run, money } = B;
const text = (v, max = 500) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

// Thresholds for "too old"; operational settings, not clinical values.
const LIMITS = {
  pendingPaymentMinutes: Number(process.env.FINANCE_PENDING_PAYMENT_MINUTES || 30),
  unsettledReceiptDays: Number(process.env.FINANCE_UNSETTLED_RECEIPT_DAYS || 3),
  refundUnconfirmedDays: Number(process.env.FINANCE_REFUND_UNCONFIRMED_DAYS || 3),
  uninvoicedHours: Number(process.env.FINANCE_UNINVOICED_HOURS || 24),
  claimUnpaidDays: Number(process.env.FINANCE_CLAIM_UNPAID_DAYS || 30),
  returnCreditDays: Number(process.env.FINANCE_RETURN_CREDIT_DAYS || 2),
};

async function openException(kind, subjectKey, details, t) {
  return one(`INSERT INTO hms_recon_exceptions (kind, subject_key, details) VALUES (:kind, :key, CAST(:details AS jsonb))
    ON CONFLICT (kind, subject_key) WHERE status = 'Open' DO NOTHING RETURNING id`,
  { kind, key: String(subjectKey), details: JSON.stringify(details || {}) }, t);
}

// ── Cash sessions ───────────────────────────────────────────
async function openSession({ openingFloat }, user, t) {
  const float = money(openingFloat || 0);
  if (!(float >= 0)) fail(400, 'Opening float must be zero or more.');
  const s = await one(`INSERT INTO hms_cash_sessions (cashier_user_id, opening_float) VALUES (:u, :float)
    ON CONFLICT (cashier_user_id) WHERE status = 'Open' DO NOTHING RETURNING *`, { u: user.id, float }, t);
  if (!s) fail(409, 'You already have an open cash drawer. Close it first.', 'SESSION_OPEN');
  return s;
}

async function expectedCash(sessionId, t) {
  return one(`SELECT s.opening_float
      + COALESCE((SELECT sum(amount) FROM hms_receipts WHERE cash_session_id = s.id), 0)
      - COALESCE((SELECT sum(amount) FROM hms_refunds WHERE cash_session_id = s.id AND state = 'Confirmed'), 0) AS expected
    FROM hms_cash_sessions s WHERE s.id = :id`, { id: sessionId }, t);
}

async function closeSession(sessionId, { countedCash, note }, user, t) {
  const s = await one('SELECT * FROM hms_cash_sessions WHERE id::text = :id FOR UPDATE', { id: String(sessionId) }, t);
  if (!s) fail(404, 'Cash session not found.');
  if (s.status !== 'Open') fail(409, 'This cash drawer is already closed.', 'SESSION_CLOSED');
  if (s.cashier_user_id !== user.id && !B.isAdmin(user)) fail(403, 'Only the cashier or an administrator closes a drawer.');
  const counted = money(countedCash);
  if (!(counted >= 0)) fail(400, 'Enter the cash counted.');
  const expected = money((await expectedCash(s.id, t)).expected);
  const variance = money(counted - expected);
  if (variance !== 0 && !text(note)) fail(400, `The count differs from the expected Rs. ${expected.toFixed(2)} by Rs. ${variance.toFixed(2)}. Explain the difference.`, 'VARIANCE_NOTE_REQUIRED');
  const closed = await one(`UPDATE hms_cash_sessions SET status = 'Closed', closed_at = now(), expected_cash = :expected, counted_cash = :counted,
      variance = :variance, close_note = :note WHERE id = :id RETURNING *`, { id: s.id, expected, counted, variance, note: text(note) }, t);
  if (variance !== 0) await openException('cash_variance', s.id, { cashier: s.cashier_user_id, expected, counted, variance }, t);
  return closed;
}

async function sessionView(sessionId, t) {
  const s = await one(`SELECT s.*, u.name AS cashier_name FROM hms_cash_sessions s JOIN hms_users u ON u.id = s.cashier_user_id WHERE s.id::text = :id`, { id: String(sessionId) }, t);
  if (!s) return null;
  s.expected_now = money((await expectedCash(s.id, t)).expected);
  s.receipts = await rows('SELECT receipt_number, amount, received_at, patient_id FROM hms_receipts WHERE cash_session_id = :id ORDER BY received_at', { id: s.id }, t);
  s.refunds = await rows("SELECT refund_number, amount, completed_at FROM hms_refunds WHERE cash_session_id = :id AND state = 'Confirmed'", { id: s.id }, t);
  return s;
}

// ── Settlements ─────────────────────────────────────────────
// Record a statement line and match it to the receipt or remittance it pays
// out, by reference and exact amount. Anything else becomes an exception.
async function recordSettlement(body, user, t) {
  const source = ['bank', 'card', 'upi', 'payer'].includes(body.source) ? body.source : null;
  if (!source) fail(400, 'Source must be bank, card, upi or payer.');
  const ref = text(body.statementReference, 100);
  const providerRef = text(body.providerReference, 100);
  const amount = money(body.amount);
  const settledOn = typeof body.settledOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.settledOn) ? body.settledOn : null;
  if (!ref || !(amount > 0) || !settledOn) fail(400, 'Give the statement reference, amount and settlement date.');
  const line = await one(`INSERT INTO hms_settlements (source, statement_reference, provider_reference, amount, settled_on, recorded_by)
    VALUES (:source, :ref, :providerRef, :amount, :settledOn, :user)
    ON CONFLICT (source, statement_reference) DO NOTHING RETURNING *`, { source, ref, providerRef, amount, settledOn, user: user.id }, t);
  if (!line) fail(409, 'That statement line is already recorded.', 'DUPLICATE_SETTLEMENT');
  return matchSettlement(line, user, t);
}

async function matchSettlement(line, user, t) {
  if (!line.provider_reference) {
    await openException('unmatched_settlement', line.id, { source: line.source, reference: line.statement_reference, amount: line.amount }, t);
    return { settlement: line, matched: false };
  }
  let target;
  if (line.source === 'payer') {
    target = await one(`SELECT r.id, r.amount, 'remittance' AS kind FROM hms_remittances r
      WHERE r.remittance_reference = :ref AND NOT EXISTS (SELECT 1 FROM hms_settlements s WHERE s.remittance_id = r.id)`, { ref: line.provider_reference }, t);
  } else {
    const methods = { card: ['Card'], upi: ['UPI'], bank: ['BankTransfer', 'Cheque', 'Card', 'UPI'] }[line.source];
    target = await one(`SELECT r.id, r.amount, 'receipt' AS kind FROM hms_receipts r
      WHERE r.provider_reference = :ref AND r.method IN (:methods) AND NOT EXISTS (SELECT 1 FROM hms_settlements s WHERE s.receipt_id = r.id)`,
    { ref: line.provider_reference, methods }, t);
  }
  if (!target) {
    await openException('unmatched_settlement', line.id, { source: line.source, reference: line.statement_reference, providerReference: line.provider_reference, amount: line.amount }, t);
    return { settlement: line, matched: false };
  }
  if (money(target.amount) !== money(line.amount)) {
    await openException('settlement_amount_mismatch', line.id, { [target.kind]: target.id, recorded: target.amount, settled: line.amount }, t);
    return { settlement: line, matched: false };
  }
  const matched = await one(`UPDATE hms_settlements SET ${target.kind === 'receipt' ? 'receipt_id' : 'remittance_id'} = :target,
      matched_by = :user, matched_at = now() WHERE id = :id RETURNING *`, { id: line.id, target: target.id, user: user.id }, t);
  return { settlement: matched, matched: true };
}

// ── Continuous checks ───────────────────────────────────────
// Each check lists the problems it finds now; new ones open exceptions. The
// result also reports subledger totals against the journal.
async function runChecks(t) {
  const found = [];
  const add = async (kind, key, details) => { found.push({ kind, key, details }); await openException(kind, key, details, t); };

  for (const i of await rows("SELECT id, amount, method, invoice_id, created_at FROM hms_payment_intents WHERE state = 'Unknown'", {}, t)) {
    await add('unknown_payment', i.id, { amount: i.amount, method: i.method, invoice: i.invoice_id, since: i.created_at });
  }
  for (const i of await rows(`SELECT id, amount, method, created_at FROM hms_payment_intents
      WHERE state IN ('Initiated', 'Pending') AND created_at < now() - make_interval(mins => :m)`, { m: LIMITS.pendingPaymentMinutes }, t)) {
    await add('stale_pending_payment', i.id, { amount: i.amount, method: i.method, since: i.created_at });
  }
  for (const r of await rows(`SELECT r.id, r.receipt_number, r.amount, r.method, r.received_at FROM hms_receipts r
      WHERE r.method IN ('Card', 'UPI', 'BankTransfer', 'Cheque') AND r.received_at < now() - make_interval(days => :d)
        AND NOT EXISTS (SELECT 1 FROM hms_settlements s WHERE s.receipt_id = r.id)`, { d: LIMITS.unsettledReceiptDays }, t)) {
    await add('unsettled_receipt', r.id, { receipt: r.receipt_number, amount: r.amount, method: r.method, received: r.received_at });
  }
  for (const r of await rows(`SELECT r.id, r.receipt_number FROM hms_receipts r
      WHERE NOT EXISTS (SELECT 1 FROM hms_journal_entries e WHERE e.source_type = 'receipt' AND e.source_key = r.id::text)`, {}, t)) {
    await add('receipt_unposted', r.id, { receipt: r.receipt_number });
  }
  for (const r of await rows(`SELECT id, refund_number, amount, submitted_at FROM hms_refunds
      WHERE state = 'Submitted' AND submitted_at < now() - make_interval(days => :d)`, { d: LIMITS.refundUnconfirmedDays }, t)) {
    await add('refund_unconfirmed', r.id, { refund: r.refund_number, amount: r.amount, submitted: r.submitted_at });
  }
  for (const f of await rows('SELECT id, kind, amount, billing_fund_balance(id) AS balance FROM hms_patient_funds WHERE billing_fund_balance(id) < 0', {}, t)) {
    await add('fund_overused', f.id, { kind: f.kind, amount: f.amount, balance: f.balance });
  }
  for (const i of await rows(`SELECT id, invoice_number, billing_invoice_patient_due(id) AS due FROM hms_invoices
      WHERE status NOT IN ('Draft', 'Void') AND billing_invoice_patient_due(id) < 0
        AND NOT EXISTS (SELECT 1 FROM hms_patient_funds f JOIN hms_invoice_notes n ON n.id = f.note_id WHERE n.invoice_id = hms_invoices.id)`, {}, t)) {
    await add('invoice_overpaid', i.id, { invoice: i.invoice_number, due: i.due });
  }
  // Episodes that have ended but still carry charges no invoice covers.
  for (const a of await rows(`SELECT a.id, a.account_number, count(*)::int AS charges, sum(c.amount) AS amount FROM hms_billing_accounts a
      JOIN hms_charge_events c ON c.account_id = a.id
      LEFT JOIN hms_admissions adm ON adm.id = a.admission_id LEFT JOIN hms_encounters e ON e.id = a.encounter_id
      WHERE c.source_type NOT IN ('reversal') AND NOT EXISTS (SELECT 1 FROM hms_charge_events r WHERE r.reverses_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
                         WHERE l.charge_event_id = c.id AND NOT l.released AND i.status <> 'Draft')
        AND ((a.episode_type = 'admission' AND adm.status = 'Discharged' AND adm.discharge_date < (now() - make_interval(hours => :h))::timestamp)
          OR (a.episode_type = 'encounter' AND e.status = 'Finalized' AND COALESCE(e.updated_at, e.encounter_date) < (now() - make_interval(hours => :h))::timestamp))
      GROUP BY a.id, a.account_number`, { h: LIMITS.uninvoicedHours }, t)) {
    await add('uninvoiced_charges', a.id, { account: a.account_number, charges: a.charges, amount: a.amount });
  }
  for (const r of await rows(`SELECT r.id, c.description, i.invoice_number FROM hms_charge_events r
      JOIN hms_charge_events c ON c.id = r.reverses_id
      JOIN hms_invoice_lines l ON l.charge_event_id = c.id AND NOT l.released AND l.amount > 0
      JOIN hms_invoices i ON i.id = l.invoice_id AND i.status <> 'Draft'
      WHERE NOT EXISTS (SELECT 1 FROM hms_invoice_notes n WHERE n.source_type = 'charge_reversal' AND n.source_key = r.id::text)`, {}, t)) {
    await add('uncredited_reversal', r.id, { charge: r.description, invoice: r.invoice_number });
  }
  for (const c of await rows(`SELECT c.id, c.claim_number, c.approved_amount, c.adjudicated_at FROM hms_claims c
      WHERE c.status = 'Adjudicated' AND c.approved_amount > 0 AND c.adjudicated_at < now() - make_interval(days => :d)
        AND NOT EXISTS (SELECT 1 FROM hms_remittances r WHERE r.claim_id = c.id)`, { d: LIMITS.claimUnpaidDays }, t)) {
    await add('claim_unpaid', c.id, { claim: c.claim_number, approved: c.approved_amount, adjudicated: c.adjudicated_at });
  }

  // Stock and medicine charges (completion A7).
  for (const r of await rows(`SELECT r.id, r.quantity, r.recorded_at, c.account_id FROM hms_med_returns r
      JOIN hms_charge_events c ON c.source_type = 'medicine_dispense_line' AND c.source_key = r.dispense_line_id::text
      WHERE r.recorded_at < now() - make_interval(days => :d)
        AND NOT EXISTS (SELECT 1 FROM hms_charge_events x WHERE x.source_type = 'medicine_return' AND x.source_key = r.id::text)
        AND NOT EXISTS (SELECT 1 FROM hms_invoice_notes n WHERE n.source_type = 'medicine_return' AND n.source_key = r.id::text)`, { d: LIMITS.returnCreditDays }, t)) {
    await add('return_uncredited', r.id, { quantity: r.quantity, returned: r.recorded_at, account: r.account_id });
  }
  for (const m of await rows(`SELECT mc.id, mc.dispense_line_id, mc.amount, mc.created_at FROM hms_med_charges mc
      WHERE NOT EXISTS (SELECT 1 FROM hms_charge_events c WHERE c.source_type = 'medicine_dispense_line' AND c.source_key = mc.dispense_line_id::text)`, {}, t)) {
    await add('dispense_uncharged', m.dispense_line_id, { amount: m.amount, dispensed: m.created_at });
  }
  for (const c of await rows(`SELECT c.id, c.source_key, c.amount FROM hms_charge_events c
      WHERE c.source_type = 'medicine_dispense_line' AND NOT EXISTS (SELECT 1 FROM hms_med_dispense_lines dl WHERE dl.id::text = c.source_key)`, {}, t)) {
    await add('charge_without_dispense', c.id, { dispense_line: c.source_key, amount: c.amount });
  }
  for (const b of await rows(`SELECT b.batch_id, b.location_id, b.quantity, COALESCE(m.total, 0) AS journal FROM hms_med_balances b
      LEFT JOIN (SELECT batch_id, location_id, sum(delta) AS total FROM hms_med_movements GROUP BY 1, 2) m ON m.batch_id = b.batch_id AND m.location_id = b.location_id
      WHERE b.quantity <> COALESCE(m.total, 0)`, {}, t)) {
    await add('stock_mismatch', `${b.batch_id}:${b.location_id}`, { batch: b.batch_id, location: b.location_id, balance: b.quantity, journal: b.journal });
  }

  // Journal against subledgers.
  const gl = Object.fromEntries((await rows(`SELECT gl_code, sum(debit) - sum(credit) AS balance FROM hms_journal_lines GROUP BY gl_code`, {}, t))
    .map((r) => [r.gl_code, money(r.balance)]));
  const sub = await one(`SELECT
      COALESCE((SELECT sum(f.amount - COALESCE((SELECT sum(a.amount) FROM hms_allocations a WHERE a.fund_id = f.id), 0)
        - COALESCE((SELECT sum(r.amount) FROM hms_refunds r WHERE r.fund_id = f.id AND r.state = 'Confirmed'), 0))
        FROM hms_patient_funds f WHERE f.kind = 'deposit'), 0) AS deposits,
      COALESCE((SELECT sum(f.amount - COALESCE((SELECT sum(a.amount) FROM hms_allocations a WHERE a.fund_id = f.id), 0)
        - COALESCE((SELECT sum(r.amount) FROM hms_refunds r WHERE r.fund_id = f.id AND r.state = 'Confirmed'), 0))
        FROM hms_patient_funds f WHERE f.kind = 'credit'), 0) AS credits,
      COALESCE((SELECT sum(GREATEST(0, billing_invoice_patient_due(i.id))) FROM hms_invoices i WHERE i.status NOT IN ('Draft', 'Void')), 0)
        -- Still owed on bills raised before Phase 5 (migration 0098).
        + COALESCE((SELECT sum(billing_legacy_due(b.id)) FROM hms_bills b WHERE billing_is_legacy_bill(b.id) AND COALESCE(b.status, '') <> 'Cancelled'), 0) AS patient_receivable,
      COALESCE((SELECT sum(i.payer_amount) FROM hms_invoices i WHERE i.status NOT IN ('Draft', 'Void')), 0)
        - COALESCE((SELECT sum(n.payer_amount) FROM hms_invoice_notes n WHERE n.kind = 'credit'), 0)
        + COALESCE((SELECT sum(n.payer_amount) FROM hms_invoice_notes n WHERE n.kind = 'debit'), 0)
        - COALESCE((SELECT sum(amount) FROM hms_remittances), 0)
        - COALESCE((SELECT sum(d.amount) FROM hms_denials d WHERE d.status = 'WrittenOff'), 0) AS payer_receivable,
      COALESCE((SELECT sum(amount) FROM hms_receipts), 0) AS receipts,
      COALESCE((SELECT sum(amount) FROM hms_otc_items), 0) AS counter_sales`, {}, t);
  const counterPostings = await one(`SELECT COALESCE(sum(l.debit), 0) AS v FROM hms_journal_lines l JOIN hms_journal_entries e ON e.id = l.entry_id
    WHERE e.source_type = 'counter_sale' AND l.gl_code IN ('1000', '1010', '1020')`, {}, t);
  const receiptPostings = await one(`SELECT COALESCE(sum(l.debit), 0) AS v FROM hms_journal_lines l JOIN hms_journal_entries e ON e.id = l.entry_id
    WHERE e.source_type = 'receipt' AND l.gl_code IN ('1000', '1010', '1020')`, {}, t);
  const comparisons = [
    { name: 'Patient deposits', gl: '2000', ledger: money(sub.deposits), journal: money(-(gl['2000'] || 0)) },
    { name: 'Patient credit balances', gl: '2300', ledger: money(sub.credits), journal: money(-(gl['2300'] || 0)) },
    { name: 'Patient receivables', gl: '1100', ledger: money(sub.patient_receivable), journal: money(gl['1100'] || 0) },
    { name: 'Payer receivables', gl: '1110', ledger: money(sub.payer_receivable), journal: money(gl['1110'] || 0) },
    { name: 'Receipts posted', gl: 'receipts', ledger: money(sub.receipts), journal: money(receiptPostings.v) },
    { name: 'Counter sales posted', gl: 'counter_sales', ledger: money(sub.counter_sales), journal: money(counterPostings.v) },
    { name: 'Trial balance', gl: 'all', ledger: 0, journal: money(Object.values(gl).reduce((s, v) => s + v, 0)) },
  ];
  for (const c of comparisons) {
    c.ok = money(c.ledger) === money(c.journal);
    if (!c.ok) await add('journal_imbalance', `gl:${c.gl}`, { name: c.name, ledger: c.ledger, journal: c.journal });
  }
  return { found, comparisons, limits: LIMITS };
}

async function resolveException(id, { resolution }, user, t) {
  const e = await one('SELECT * FROM hms_recon_exceptions WHERE id::text = :id FOR UPDATE', { id: String(id) }, t);
  if (!e) fail(404, 'Exception not found.');
  if (e.status !== 'Open') fail(409, 'This exception is already resolved.');
  const why = text(resolution, 1000);
  if (!why || why.length < 5) fail(400, 'Record how it was resolved (at least 5 characters).');
  return one(`UPDATE hms_recon_exceptions SET status = 'Resolved', resolved_by = :user, resolved_at = now(), resolution = :why
    WHERE id = :id RETURNING *`, { id: e.id, user: user.id, why }, t);
}

async function assignException(id, ownerUserId, t) {
  const owner = await one("SELECT id FROM hms_users WHERE id = :id AND role IN ('super_admin', 'admin', 'receptionist')", { id: Number(ownerUserId) }, t);
  if (!owner) fail(400, 'The owner must be a billing or administrative user.');
  const e = await one(`UPDATE hms_recon_exceptions SET owner_user_id = :owner WHERE id::text = :id AND status = 'Open' RETURNING *`, { id: String(id), owner: owner.id }, t);
  if (!e) fail(404, 'Open exception not found.');
  return e;
}

// Background: bed days for inpatients and the reconciliation checks.
function startFinanceWorker() {
  if (process.env.FINANCE_WORKER === 'off') return () => {};
  const every = Number(process.env.FINANCE_WORKER_INTERVAL_MS || 15 * 60 * 1000);
  const tick = async () => {
    try {
      await sequelize.transaction(async (t) => {
        // One run at a time across processes (API and worker roles, completion A8).
        if (!(await one('SELECT pg_try_advisory_xact_lock(727290) AS locked', {}, t)).locked) return;
        await run("SELECT billing_accrue_ward_days(id) FROM hms_admissions WHERE status = 'Active' AND admission_date IS NOT NULL", {}, t);
        await runChecks(t);
      });
    } catch (err) {
      console.error('Finance worker failed:', err.original?.message || err.message);
    }
  };
  const timer = setInterval(tick, every);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = {
  LIMITS, openSession, closeSession, sessionView, recordSettlement, runChecks, resolveException, assignException, startFinanceWorker,
};
