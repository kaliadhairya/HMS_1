// Revenue cycle (Phase 5, migrations 0070–0076): billing accounts, charges,
// invoices, credit and debit notes, payments, deposits, refunds and the
// financial journal. Every function runs inside the caller's transaction `t`;
// routes open one transaction per command (with the Phase 1 idempotency key).
//
// Lock order, everywhere: billing account -> invoice -> patient fund -> refund.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');

const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const run = (sql, replacements, t) => sequelize.query(sql, { replacements, transaction: t });
const money = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const pad = (n) => String(n).padStart(6, '0');
const year = () => new Date().getFullYear();
const nextNumber = async (prefix, seq, t) => `${prefix}-${year()}-${pad((await one(`SELECT nextval('${seq}') AS n`, {}, t)).n)}`;

const ADMIN_ROLES = ['super_admin', 'admin'];
const isAdmin = (user) => ADMIN_ROLES.includes(user.role);
const METHODS = ['Cash', 'Card', 'UPI', 'BankTransfer', 'Cheque'];
const CASH_GL = { Cash: '1000', Card: '1010', UPI: '1010', BankTransfer: '1020', Cheque: '1020' };
const CATEGORIES = ['Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service', 'Package'];

// ── Journal ─────────────────────────────────────────────────
// One entry per business source; a repeat returns the first entry, never a
// second posting. Lines with a negative amount are posted on the other side.
async function post(t, { sourceType, sourceKey, accountId = null, patientId = null, memo, user, lines }) {
  const clean = [];
  for (const l of lines) {
    const net = money((l.debit || 0) - (l.credit || 0));
    if (net !== 0) clean.push({ gl: l.gl, debit: net > 0 ? net : 0, credit: net < 0 ? -net : 0 });
  }
  if (!clean.length) return null;
  const entry = await one(`INSERT INTO hms_journal_entries (source_type, source_key, account_id, patient_id, memo, posted_by)
    VALUES (:sourceType, :sourceKey, :accountId, :patientId, :memo, :user)
    ON CONFLICT (source_type, source_key) DO NOTHING RETURNING id`,
  { sourceType, sourceKey: String(sourceKey), accountId, patientId, memo, user: user?.id ?? null }, t);
  if (!entry) return (await one('SELECT id FROM hms_journal_entries WHERE source_type = :sourceType AND source_key = :sourceKey', { sourceType, sourceKey: String(sourceKey) }, t)).id;
  for (const l of clean) {
    await run('INSERT INTO hms_journal_lines (entry_id, gl_code, debit, credit) VALUES (:entry, :gl, :debit, :credit)', { entry: entry.id, ...l }, t);
  }
  return entry.id;
}
const revenueGl = (category) => ({ Consultation: '4000', Lab: '4010', Medicine: '4020', Ward: '4030', Package: '4050' }[category] || '4040');

// ── Accounts and charges ────────────────────────────────────
async function accountFor({ encounterId = null, admissionId = null }, t) {
  const r = await one('SELECT billing_account_for(CAST(:e AS integer), CAST(:a AS integer)) AS id', { e: encounterId, a: admissionId }, t);
  return r.id;
}

async function lockAccount(accountId, t) {
  const acc = await one('SELECT * FROM hms_billing_accounts WHERE id::text = :id FOR UPDATE', { id: String(accountId) }, t);
  if (!acc) fail(404, 'Billing account not found.');
  return acc;
}

// Bed days so far for an admission (active admissions accrue as days complete).
async function accrueWard(admissionId, t) {
  if (admissionId) await run('SELECT billing_accrue_ward_days(:id)', { id: Number(admissionId) }, t);
}

// Medicine sold at the MRP of the batch the pharmacy would issue first.
async function medicinePrice(medicineId, t) {
  // Usable stock only: not quarantined, recalled or expired (Phase 3 lot status).
  const b = await one(`SELECT mrp FROM hms_medicine_batches WHERE medicine_id = :id AND quantity > 0 AND COALESCE(lot_status, 'AVAILABLE') = 'AVAILABLE'
      AND expiry_date >= hms_service_today()
    ORDER BY expiry_date ASC LIMIT 1`, { id: medicineId }, t);
  if (b && Number(b.mrp) > 0) return Number(b.mrp);
  const p = await one('SELECT mrp FROM hms_purchase_items WHERE medicine_id = :id ORDER BY id DESC LIMIT 1', { id: medicineId }, t);
  return p ? Number(p.mrp) || 0 : 0;
}

// A charge added by staff: a charge master item, a medicine at MRP, or (an
// administrator only) a priced service with a reason.
async function addCharge(accountId, body, user, t) {
  const acc = await lockAccount(accountId, t);
  if (acc.status !== 'Open') fail(409, 'This account is closed.');
  const quantity = Number(body.quantity ?? 1);
  if (!(quantity > 0) || quantity > 9999 || !/^\d+(\.\d{1,3})?$/.test(String(body.quantity ?? 1))) fail(400, 'Quantity must be a positive number (up to 3 decimals, at most 9999).');
  const key = `${user.id}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
  let id;
  if (body.code) {
    const item = await one(`SELECT i.* FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
      WHERE v.status = 'Active' AND i.code = :code`, { code: String(body.code) }, t);
    if (!item) fail(404, 'That item is not on the active price list.');
    if (item.category === 'Ward') fail(400, 'Bed days are charged from the bed history, not by hand.');
    ({ id } = await one(`SELECT billing_capture_charge(:acc, 'manual', :key, :category, :code, :name, :item, 'charge_master',
      :qty, :price, :gst, now(), :user, :reason) AS id`,
    { acc: acc.id, key, category: item.category, code: item.code, name: item.name, item: item.id, qty: quantity, price: item.unit_price, gst: item.gst_rate, user: user.id, reason }, t));
  } else if (body.medicineId) {
    const med = await one('SELECT id, generic_name, strength, strength_unit FROM hms_medicines WHERE id = :id', { id: Number(body.medicineId) }, t);
    if (!med) fail(404, 'Medicine not found.');
    if (!Number.isInteger(quantity)) fail(400, 'Medicines are charged in whole units.');
    const price = await medicinePrice(med.id, t);
    const name = [med.generic_name, med.strength && `${med.strength}${med.strength_unit || ''}`].filter(Boolean).join(' ');
    ({ id } = await one(`SELECT billing_capture_charge(:acc, 'manual', :key, 'Medicine', :code, :name, NULL, 'source',
      :qty, :price, 0, now(), :user, :reason) AS id`,
    { acc: acc.id, key, code: `MED-${med.id}`, name, qty: quantity, price, user: user.id, reason: reason || 'Added on the billing page' }, t));
  } else {
    if (!isAdmin(user)) fail(403, 'Only an administrator can price a service by hand.');
    const category = CATEGORIES.includes(body.category) && body.category !== 'Package' ? body.category : null;
    const price = Number(body.unitPrice);
    const description = typeof body.description === 'string' ? body.description.trim().slice(0, 200) : '';
    if (!category || !description || !(price >= 0) || price > 1e9) fail(400, 'Give a category, a description and a price.');
    if (!reason || reason.length < 5) fail(400, 'Say why this charge is priced by hand.');
    ({ id } = await one(`SELECT billing_capture_charge(:acc, 'manual', :key, :category, NULL, :description, NULL, 'manual',
      :qty, :price, :gst, now(), :user, :reason) AS id`,
    { acc: acc.id, key, category, description, qty: quantity, price: money(price), gst: Number(body.gstRate || 0), user: user.id, reason }, t));
  }
  await refreshDraft(acc.id, user, t);
  return one('SELECT * FROM hms_charge_events WHERE id = :id', { id }, t);
}

// Cancel a charge before it is invoiced. Once it is on an issued invoice,
// the correction is a credit note.
async function reverseCharge(chargeId, reason, user, t) {
  const c = await one('SELECT * FROM hms_charge_events WHERE id::text = :id', { id: String(chargeId) }, t);
  if (!c) fail(404, 'Charge not found.');
  await lockAccount(c.account_id, t);
  if (c.source_type === 'reversal') fail(409, 'A reversal cannot be reversed.');
  if (!reason || String(reason).trim().length < 5) fail(400, 'Say why the charge is cancelled.');
  if (['ward_day', 'consultation', 'lab_order_item', 'medicine_dispense_line'].includes(c.source_type) && !isAdmin(user)) {
    fail(403, 'Charges recorded by the clinical system are cancelled by an administrator.');
  }
  const billed = await one(`SELECT i.invoice_number FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
    WHERE l.charge_event_id = :id AND NOT l.released AND i.status <> 'Draft'`, { id: c.id }, t);
  if (billed) fail(409, `This charge is on invoice ${billed.invoice_number}. Correct it with a credit note.`, 'CHARGE_INVOICED');
  const { id } = await one('SELECT billing_reverse_charge(:id, :reason, :user) AS id', { id: c.id, reason: String(reason).trim().slice(0, 500), user: user.id }, t);
  await refreshDraft(c.account_id, user, t);
  return one('SELECT * FROM hms_charge_events WHERE id = :id', { id }, t);
}

async function applyPackage(accountId, packageCode, user, t) {
  const acc = await lockAccount(accountId, t);
  const v = await one(`SELECT pv.*, p.name, p.code FROM hms_package_versions pv JOIN hms_packages p ON p.id = pv.package_id
    WHERE p.code = :code AND pv.status = 'Active'`, { code: String(packageCode || '') }, t);
  if (!v) fail(404, 'No active package with that code.');
  const ap = await one(`INSERT INTO hms_account_packages (account_id, package_version_id, applied_by) VALUES (:acc, :v, :user)
    ON CONFLICT (account_id, package_version_id) DO NOTHING RETURNING *`, { acc: acc.id, v: v.id, user: user.id }, t);
  if (!ap) fail(409, 'This package is already applied to the account.');
  await one(`SELECT billing_capture_charge(:acc, 'package', :key, 'Package', :code, :name, NULL, 'source', 1, :price, :gst, now(), :user) AS id`,
    { acc: acc.id, key: ap.id, code: v.code, name: `${v.name} (package v${v.version})`, price: v.price, gst: v.gst_rate, user: user.id }, t);
  await refreshDraft(acc.id, user, t);
  return ap;
}

// ── Pricing an invoice: uninvoiced charges and package coverage ──
const ruleMatches = (rule, charge) => rule.category === charge.category && (!rule.code || rule.code === charge.code);

async function packageContext(accountId, t) {
  const packages = await rows(`SELECT ap.id, pv.id AS version_id FROM hms_account_packages ap
    JOIN hms_package_versions pv ON pv.id = ap.package_version_id WHERE ap.account_id = :acc ORDER BY ap.applied_at`, { acc: accountId }, t);
  for (const p of packages) {
    // Code-specific rules before category-wide ones.
    p.rules = await rows('SELECT * FROM hms_package_rules WHERE version_id = :v ORDER BY (code IS NULL), category, code, id', { v: p.version_id }, t);
    p.used = new Map(p.rules.map((r) => [r.id, { quantity: 0, amount: 0 }]));
  }
  // Allowance already used on issued invoices.
  const covered = await rows(`SELECT l.account_package_id, c.category, c.code, c.quantity, c.amount FROM hms_invoice_lines l
    JOIN hms_invoices i ON i.id = l.invoice_id JOIN hms_charge_events c ON c.id = l.charge_event_id
    WHERE i.account_id = :acc AND i.status <> 'Draft' AND NOT l.released AND l.account_package_id IS NOT NULL`, { acc: accountId }, t);
  for (const line of covered) {
    const p = packages.find((x) => x.id === line.account_package_id);
    const rule = p && p.rules.find((r) => r.rule === 'include' && ruleMatches(r, line));
    if (rule) { const u = p.used.get(rule.id); u.quantity += Number(line.quantity); u.amount += Number(line.amount); }
  }
  return packages;
}

function coverage(packages, charge) {
  for (const p of packages) {
    if (p.rules.some((r) => r.rule === 'exclude' && ruleMatches(r, charge))) continue;
    const rule = p.rules.find((r) => r.rule === 'include' && ruleMatches(r, charge));
    if (!rule) continue;
    const u = p.used.get(rule.id);
    if (rule.allowance_quantity != null && u.quantity + Number(charge.quantity) > Number(rule.allowance_quantity) + 1e-9) continue;
    if (rule.allowance_amount != null && u.amount + Number(charge.amount) > Number(rule.allowance_amount) + 0.001) continue;
    u.quantity += Number(charge.quantity);
    u.amount += Number(charge.amount);
    return p.id;
  }
  return null;
}

// Lines a new invoice would carry: every charge not on an issued invoice. A
// charge and its reversal that are both unbilled cancel out and are left off.
async function pricedLines(acc, t) {
  const charges = await rows(`SELECT c.* FROM hms_charge_events c
    WHERE c.account_id = :acc AND NOT EXISTS (
      SELECT 1 FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
       WHERE l.charge_event_id = c.id AND NOT l.released AND i.status <> 'Draft')
    ORDER BY c.service_at, c.created_at, c.id`, { acc: acc.id }, t);
  const ids = new Set(charges.map((c) => c.id));
  const pairs = new Set(charges.filter((c) => c.reverses_id && ids.has(c.reverses_id)).flatMap((c) => [c.id, c.reverses_id]));
  const packages = await packageContext(acc.id, t);
  const lines = [];
  for (const c of charges) {
    if (pairs.has(c.id)) continue;
    let packageId = null;
    // A charge cancelled after it was invoiced is corrected by a credit note on
    // that invoice (see uncreditedReversals), never by a negative line here.
    if (c.source_type === 'reversal') continue;
    if (c.source_type !== 'package' && c.source_type !== 'medicine_return') {
      packageId = coverage(packages, c);
    }
    const amount = packageId ? 0 : money(c.amount);
    lines.push({ charge: c, packageId, amount, gst: packageId ? 0 : money(c.gst_amount) });
  }
  return lines;
}

// The payer's share of a total: (100 - co-pay)% of it, capped by the approved
// pre-authorisation not used by the account's other invoices.
async function payerSplit(accountId, total, invoiceId, t) {
  const ap = await one(`SELECT ap.*, pa.status AS preauth_status, pa.approved_amount FROM hms_account_payers ap
    JOIN hms_preauthorizations pa ON pa.id = ap.preauth_id WHERE ap.account_id = :acc`, { acc: accountId }, t);
  if (!ap || !['Approved', 'PartiallyApproved'].includes(ap.preauth_status) || total <= 0) return { payer: 0, patient: money(total) };
  const used = await one(`SELECT COALESCE(sum(payer_amount), 0) AS used FROM hms_invoices
    WHERE account_id = :acc AND status NOT IN ('Draft', 'Void') AND id::text <> :inv`, { acc: accountId, inv: String(invoiceId || '') }, t);
  const cap = Math.max(0, money(Number(ap.approved_amount) - Number(used.used)));
  const payer = Math.min(cap, money(total * (100 - Number(ap.copay_percent)) / 100));
  return { payer: money(payer), patient: money(total - payer) };
}

// Build or refresh the account's draft invoice from its unbilled charges. The
// revision changes only when the lines or totals change, so an issue request
// can tell whether the reviewer saw the current draft.
async function refreshDraft(accountId, user, t, { create = false } = {}) {
  const acc = await lockAccount(accountId, t);
  let draft = await one("SELECT * FROM hms_invoices WHERE account_id = :acc AND status = 'Draft'", { acc: acc.id }, t);
  if (!draft && !create) return null;
  if (acc.admission_id) await accrueWard(acc.admission_id, t);
  const lines = await pricedLines(acc, t);
  const kind = acc.episode_type === 'admission'
    && (await one('SELECT status FROM hms_admissions WHERE id = :id', { id: acc.admission_id }, t))?.status === 'Active' ? 'interim' : 'final';
  if (!draft) {
    if (!lines.length) return null;
    draft = await one(`INSERT INTO hms_invoices (account_id, patient_id, kind, created_by) VALUES (:acc, :pid, :kind, :user) RETURNING *`,
      { acc: acc.id, pid: acc.patient_id, kind, user: user.id }, t);
  }
  const current = await rows('SELECT charge_event_id, amount, gst_amount, account_package_id FROM hms_invoice_lines WHERE invoice_id = :id ORDER BY line_no', { id: draft.id }, t);
  const sig = (ls) => ls.map((l) => `${l.charge_event_id}:${money(l.amount)}:${money(l.gst_amount)}:${l.account_package_id || ''}`).join('|');
  const next = lines.map((l) => ({ charge_event_id: l.charge.id, amount: l.amount, gst_amount: l.gst, account_package_id: l.packageId }));
  const subtotal = money(lines.reduce((s, l) => s + l.amount, 0));
  const gst = money(lines.reduce((s, l) => s + l.gst, 0));
  const discount = Math.min(money(draft.discount_amount), Math.max(0, money(subtotal + gst)));
  const total = money(subtotal + gst - discount);
  const split = await payerSplit(acc.id, Math.max(0, total), draft.id, t);
  if (money(subtotal + gst) < 0) fail(409, 'Credits on this account are more than its new charges. Use a credit note on the earlier invoice.');
  const changed = sig(current) !== sig(next) || money(draft.subtotal) !== subtotal || money(draft.gst_amount) !== gst
    || money(draft.discount_amount) !== discount || money(draft.payer_amount) !== split.payer || draft.kind !== kind;
  if (!changed) return draft;
  await run('DELETE FROM hms_invoice_lines WHERE invoice_id = :id', { id: draft.id }, t);
  let n = 0;
  for (const l of lines) {
    n += 1;
    const c = l.charge;
    await run(`INSERT INTO hms_invoice_lines (invoice_id, line_no, charge_event_id, category, code, description, service_at,
      quantity, unit_price, list_amount, amount, gst_rate, gst_amount, account_package_id)
      VALUES (:inv, :n, :charge, :category, :code, :description, :serviceAt, :quantity, :unitPrice, :listAmount, :amount, :gstRate, :gst, :pkg)`, {
      inv: draft.id, n, charge: c.id, category: c.category, code: c.code, description: c.description, serviceAt: c.service_at,
      quantity: c.quantity, unitPrice: c.unit_price, listAmount: money(c.amount), amount: l.amount,
      gstRate: c.gst_rate, gst: l.gst, pkg: l.packageId,
    }, t);
  }
  return one(`UPDATE hms_invoices SET subtotal = :subtotal, gst_amount = :gst, discount_amount = :discount,
      discount_reason = CASE WHEN :discount = 0 THEN NULL ELSE discount_reason END,
      discount_approved_by = CASE WHEN :discount = 0 THEN NULL ELSE discount_approved_by END,
      total = :total, payer_amount = :payer, patient_amount = :patient, kind = :kind, revision = revision + 1
    WHERE id = :id RETURNING *`,
  { id: draft.id, subtotal, gst, discount, total, payer: split.payer, patient: split.patient, kind }, t);
}

// Charges cancelled after their invoice was issued, still waiting for the
// credit note that corrects that invoice.
async function uncreditedReversals(accountId, t) {
  return rows(`SELECT r.id AS reversal_id, r.reason, r.created_at, c.id AS charge_id, c.description, c.category,
      l.id AS invoice_line_id, l.amount, l.gst_amount, i.id AS invoice_id, i.invoice_number
    FROM hms_charge_events r JOIN hms_charge_events c ON c.id = r.reverses_id
    JOIN hms_invoice_lines l ON l.charge_event_id = c.id AND NOT l.released
    JOIN hms_invoices i ON i.id = l.invoice_id AND i.status <> 'Draft'
    WHERE r.account_id = :acc AND l.amount > 0
      AND NOT EXISTS (SELECT 1 FROM hms_invoice_notes n WHERE n.source_type = 'charge_reversal' AND n.source_key = r.id::text)
    ORDER BY r.created_at`, { acc: accountId }, t);
}

// The credit note for one such reversal: the whole line, on its invoice.
async function creditReversal(reversalId, user, t) {
  const r = await one('SELECT account_id FROM hms_charge_events WHERE id::text = :id AND source_type = \'reversal\'', { id: String(reversalId) }, t);
  if (!r) fail(404, 'Cancelled charge not found.');
  const item = (await uncreditedReversals(r.account_id, t)).find((x) => x.reversal_id === String(reversalId) || x.reversal_id === reversalId);
  if (!item) fail(409, 'This cancelled charge needs no credit note (it was not billed, or it is already credited).');
  return createNote(item.invoice_id, {
    kind: 'credit', reason: `Charge cancelled after billing: ${item.reason || item.description}`.slice(0, 1000),
    lines: [{ invoiceLineId: item.invoice_line_id, amount: Number(item.amount), gstAmount: Number(item.gst_amount) }],
    sourceType: 'charge_reversal', sourceKey: String(item.reversal_id),
  }, user, t);
}

async function draftInvoice(accountId, user, t) {
  const draft = await refreshDraft(accountId, user, t, { create: true });
  if (!draft) fail(409, 'There is nothing new to bill on this account.', 'NOTHING_TO_BILL');
  return draft;
}

async function lockInvoice(invoiceId, t) {
  const inv = await one('SELECT * FROM hms_invoices WHERE id::text = :id FOR UPDATE', { id: String(invoiceId) }, t);
  if (!inv) fail(404, 'Invoice not found.');
  return inv;
}

// A discount agreed before issue changes the price (administrator, with a reason).
async function setDiscount(invoiceId, { amount, reason, revision }, user, t) {
  if (!isAdmin(user)) fail(403, 'Only administrators can approve discounts.');
  const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  await lockAccount(first.account_id, t);
  let inv = await lockInvoice(invoiceId, t);
  if (inv.status !== 'Draft') fail(409, 'The invoice is issued. A later reduction needs a credit note.', 'INVOICE_ISSUED');
  inv = await refreshDraft(inv.account_id, user, t);
  if (revision != null && Number(revision) !== Number(inv.revision)) fail(409, 'The bill changed since you opened it. Review it again.', 'STALE_DRAFT');
  const discount = money(amount);
  if (!(discount >= 0)) fail(400, 'Discount must be zero or more.');
  if (discount > money(Number(inv.subtotal) + Number(inv.gst_amount))) fail(400, 'Discount cannot be more than the bill total.');
  const why = typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 500) : null;
  if (discount > 0 && (!why || why.length < 3)) fail(400, 'Give a reason for the discount.');
  const total = money(Number(inv.subtotal) + Number(inv.gst_amount) - discount);
  const split = await payerSplit(inv.account_id, total, inv.id, t);
  return one(`UPDATE hms_invoices SET discount_amount = :discount, discount_reason = :why, discount_approved_by = :by,
      total = :total, payer_amount = :payer, patient_amount = :patient, revision = revision + 1 WHERE id = :id RETURNING *`,
  { id: inv.id, discount, why: discount > 0 ? why : null, by: discount > 0 ? user.id : null, total, payer: split.payer, patient: split.patient }, t);
}

// ── Issue ───────────────────────────────────────────────────
async function issueInvoice(invoiceId, { revision, applyDeposits = false } = {}, user, t) {
  const first = await one('SELECT account_id, status FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  const acc = await lockAccount(first.account_id, t);
  let inv = await lockInvoice(invoiceId, t);
  if (inv.status !== 'Draft') fail(409, `Invoice ${inv.invoice_number} is already issued.`, 'INVOICE_ISSUED');
  inv = await refreshDraft(acc.id, user, t);
  if (!inv) fail(409, 'There is nothing new to bill on this account.', 'NOTHING_TO_BILL');
  if (revision != null && Number(revision) !== Number(inv.revision)) {
    fail(409, 'Charges changed since you reviewed this bill. Review it again before issuing.', 'STALE_DRAFT');
  }
  const lines = await rows('SELECT * FROM hms_invoice_lines WHERE invoice_id = :id ORDER BY line_no', { id: inv.id }, t);
  if (!lines.length) fail(409, 'There is nothing new to bill on this account.', 'NOTHING_TO_BILL');
  const number = await nextNumber('INV', 'hms_invoice_seq', t);
  inv = await one(`UPDATE hms_invoices SET status = 'Issued', invoice_number = :number, issued_by = :user, issued_at = now()
    WHERE id = :id RETURNING *`, { id: inv.id, number, user: user.id }, t);

  // Journal: receivables against revenue by category, GST and discount.
  const revenue = {};
  for (const l of lines) revenue[l.category] = money((revenue[l.category] || 0) + Number(l.amount));
  await post(t, {
    sourceType: 'invoice', sourceKey: inv.id, accountId: acc.id, patientId: acc.patient_id, user,
    memo: `Invoice ${number}`,
    lines: [
      { gl: '1100', debit: Number(inv.patient_amount) },
      { gl: '1110', debit: Number(inv.payer_amount) },
      { gl: '4900', debit: Number(inv.discount_amount) },
      ...Object.entries(revenue).map(([cat, amt]) => ({ gl: revenueGl(cat), credit: amt })),
      { gl: '2100', credit: Number(inv.gst_amount) },
    ],
  });
  await writeLegacyBill(inv, acc, lines, user, t);
  if (applyDeposits) await applyAvailableFunds(inv.id, user, t);
  return one('SELECT * FROM hms_invoices WHERE id = :id', { id: inv.id }, t);
}

// Controlled voiding: only an invoice nothing has been applied to.
async function voidInvoice(invoiceId, reason, user, t) {
  if (!isAdmin(user)) fail(403, 'Only administrators can void an invoice.');
  const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  await lockAccount(first.account_id, t);
  const inv = await lockInvoice(invoiceId, t);
  if (inv.status !== 'Issued') fail(409, inv.status === 'Draft' ? 'A draft is discarded, not voided.' : `An invoice that is ${inv.status} cannot be voided.`);
  if (!reason || String(reason).trim().length < 5) fail(400, 'Say why the invoice is voided.');
  const used = await one(`SELECT (SELECT count(*) FROM hms_allocations WHERE invoice_id = :id) + (SELECT count(*) FROM hms_invoice_notes WHERE invoice_id = :id)
    + (SELECT count(*) FROM hms_claims WHERE invoice_id = :id) + (SELECT count(*) FROM hms_payment_intents WHERE invoice_id = :id AND state <> 'Failed') AS n`, { id: inv.id }, t);
  if (Number(used.n) > 0) fail(409, 'Payments, notes or a claim exist for this invoice. Correct it with a credit note instead.', 'INVOICE_IN_USE');
  await run(`UPDATE hms_invoices SET status = 'Void', voided_by = :user, voided_at = now(), void_reason = :reason WHERE id = :id`,
    { id: inv.id, user: user.id, reason: String(reason).trim().slice(0, 500) }, t);
  await run('UPDATE hms_invoice_lines SET released = true WHERE invoice_id = :id', { id: inv.id }, t);
  // Reverse the issue posting line for line.
  const lines = await rows(`SELECT jl.gl_code, jl.debit, jl.credit FROM hms_journal_lines jl JOIN hms_journal_entries je ON je.id = jl.entry_id
    WHERE je.source_type = 'invoice' AND je.source_key = :id`, { id: inv.id }, t);
  await post(t, { sourceType: 'invoice_void', sourceKey: inv.id, accountId: inv.account_id, patientId: inv.patient_id, user,
    memo: `Void of invoice ${inv.invoice_number}`, lines: lines.map((l) => ({ gl: l.gl_code, debit: Number(l.credit), credit: Number(l.debit) })) });
  await syncLegacyBill(inv.id, t);
  return one('SELECT * FROM hms_invoices WHERE id = :id', { id: inv.id }, t);
}

// ── Credit and debit notes ──────────────────────────────────
// lines: [{ invoiceLineId?, category?, description?, amount, gstAmount? }] (amount before GST).
// The patient/payer split defaults to the invoice's own proportion.
async function createNote(invoiceId, { kind, reason, lines, payerAmount, sourceType = null, sourceKey = null }, user, t) {
  if (!isAdmin(user)) fail(403, 'Credit and debit notes are approved by an administrator.');
  if (!['credit', 'debit'].includes(kind)) fail(400, 'A note is a credit or a debit.');
  if (!reason || String(reason).trim().length < 5) fail(400, 'Give the reason for the note (at least 5 characters).');
  if (!Array.isArray(lines) || !lines.length || lines.length > 100) fail(400, 'A note needs at least one line.');
  const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  await lockAccount(first.account_id, t);
  const inv = await lockInvoice(invoiceId, t);
  if (!['Issued', 'PartiallyCredited'].includes(inv.status)) fail(409, `Notes cannot be raised on a ${inv.status.toLowerCase()} invoice.`);
  const invLines = await rows('SELECT * FROM hms_invoice_lines WHERE invoice_id = :id', { id: inv.id }, t);
  const clean = lines.map((l) => {
    const ref = l.invoiceLineId ? invLines.find((x) => x.id === l.invoiceLineId) : null;
    if (l.invoiceLineId && !ref) fail(400, 'A note line refers to a line of another invoice.');
    const amount = money(l.amount);
    const gstAmount = money(l.gstAmount ?? (ref ? Number(ref.gst_rate) * amount / 100 : 0));
    const category = ref ? ref.category : l.category;
    if (!(amount > 0) || !(gstAmount >= 0)) fail(400, 'Each note line needs a positive amount.');
    if (!CATEGORIES.includes(category)) fail(400, 'Each note line needs a category.');
    const description = String(l.description || (ref ? ref.description : '')).trim().slice(0, 200);
    if (!description) fail(400, 'Each note line needs a description.');
    return { ref, amount, gstAmount, category, description };
  });
  const total = money(clean.reduce((s, l) => s + l.amount + l.gstAmount, 0));
  const share = Number(inv.total) > 0 ? Number(inv.payer_amount) / Number(inv.total) : 0;
  const payer = money(payerAmount != null ? payerAmount : total * share);
  if (!(payer >= 0) || payer > total) fail(400, 'The payer part must be between zero and the note total.');
  const patient = money(total - payer);
  const dueBefore = money((await one('SELECT billing_invoice_patient_due(:id) AS due', { id: inv.id }, t)).due);
  const number = await nextNumber(kind === 'credit' ? 'CRN' : 'DBN', 'hms_credit_note_seq', t);
  const note = await one(`INSERT INTO hms_invoice_notes (note_number, invoice_id, kind, reason, amount, gst_amount, payer_amount, patient_amount,
      source_type, source_key, requested_by, approved_by)
    VALUES (:number, :inv, :kind, :reason, :amount, :gst, :payer, :patient, :sourceType, :sourceKey, :user, :user) RETURNING *`, {
    number, inv: inv.id, kind, reason: String(reason).trim().slice(0, 1000), amount: total,
    gst: money(clean.reduce((s, l) => s + l.gstAmount, 0)), payer, patient, sourceType, sourceKey, user: user.id,
  }, t);
  for (const l of clean) {
    await run(`INSERT INTO hms_invoice_note_lines (note_id, invoice_line_id, category, description, amount, gst_amount)
      VALUES (:note, :line, :category, :description, :amount, :gst)`,
    { note: note.id, line: l.ref?.id || null, category: l.category, description: l.description, amount: l.amount, gst: l.gstAmount }, t);
  }
  const preGst = money(clean.reduce((s, l) => s + l.amount, 0));
  const gstTotal = money(note.gst_amount);
  if (kind === 'credit') {
    // What the patient no longer owes reduces the receivable; any part they
    // had already paid becomes a credit they can use or have refunded.
    const toReceivable = Math.min(patient, Math.max(0, dueBefore));
    const toCredit = money(patient - toReceivable);
    await post(t, { sourceType: 'credit_note', sourceKey: note.id, accountId: inv.account_id, patientId: inv.patient_id, user,
      memo: `Credit note ${number} on ${inv.invoice_number}`,
      lines: [{ gl: '4900', debit: preGst }, { gl: '2100', debit: gstTotal }, { gl: '1110', credit: payer },
        { gl: '1100', credit: toReceivable }, { gl: '2300', credit: toCredit }] });
    if (toCredit > 0) {
      await run(`INSERT INTO hms_patient_funds (patient_id, account_id, kind, amount, note_id, created_by)
        VALUES (:pid, :acc, 'credit', :amount, :note, :user)`, { pid: inv.patient_id, acc: inv.account_id, amount: toCredit, note: note.id, user: user.id }, t);
    }
    const sums = await one(`SELECT COALESCE(sum(amount) FILTER (WHERE kind = 'credit'), 0) AS cr, COALESCE(sum(amount) FILTER (WHERE kind = 'debit'), 0) AS db
      FROM hms_invoice_notes WHERE invoice_id = :id`, { id: inv.id }, t);
    const status = money(sums.cr) >= money(Number(inv.total) + Number(sums.db)) ? 'Credited' : 'PartiallyCredited';
    if (status !== inv.status) await run('UPDATE hms_invoices SET status = :status WHERE id = :id', { id: inv.id, status }, t);
  } else {
    const revenue = {};
    for (const l of clean) revenue[l.category] = money((revenue[l.category] || 0) + l.amount);
    await post(t, { sourceType: 'debit_note', sourceKey: note.id, accountId: inv.account_id, patientId: inv.patient_id, user,
      memo: `Debit note ${number} on ${inv.invoice_number}`,
      lines: [{ gl: '1100', debit: patient }, { gl: '1110', debit: payer },
        ...Object.entries(revenue).map(([cat, amt]) => ({ gl: revenueGl(cat), credit: amt })), { gl: '2100', credit: gstTotal }] });
  }
  await syncLegacyBill(inv.id, t);
  return note;
}

// ── Returned medicine ───────────────────────────────────────
// A return puts stock in quarantine (Phase 3); the money is a separate,
// authorised adjustment: a negative charge while the dispense is unbilled,
// otherwise a credit note on the invoice line that billed it.
async function pendingReturnCredits(t, accountId = null) {
  return rows(`SELECT r.id, r.quantity, r.reason, r.recorded_at, dl.rate, round(r.quantity * dl.rate, 2) AS amount,
      c.id AS charge_id, c.account_id, c.description, a.account_number, a.patient_id, p.name AS patient_name, p.uhid,
      (SELECT l.id FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
        WHERE l.charge_event_id = c.id AND NOT l.released AND i.status <> 'Draft' LIMIT 1) AS invoice_line_id
    FROM hms_med_returns r
    JOIN hms_med_dispense_lines dl ON dl.id = r.dispense_line_id
    JOIN hms_charge_events c ON c.source_type = 'medicine_dispense_line' AND c.source_key = r.dispense_line_id::text
    JOIN hms_billing_accounts a ON a.id = c.account_id JOIN hms_patients p ON p.id = a.patient_id
    WHERE (CAST(:acc AS uuid) IS NULL OR c.account_id = CAST(:acc AS uuid))
      AND NOT EXISTS (SELECT 1 FROM hms_charge_events x WHERE x.source_type = 'medicine_return' AND x.source_key = r.id::text)
      AND NOT EXISTS (SELECT 1 FROM hms_invoice_notes n WHERE n.source_type = 'medicine_return' AND n.source_key = r.id::text)
    ORDER BY r.recorded_at`, { acc: accountId }, t);
}

async function creditReturn(returnId, user, t) {
  if (!isAdmin(user)) fail(403, 'Credit for returned medicine is authorised by an administrator.');
  const first = (await pendingReturnCredits(t)).find((r) => r.id === String(returnId) || r.id === returnId);
  if (!first) fail(409, 'This return has no pending credit (it is already credited, or its dispense was not charged).');
  await lockAccount(first.account_id, t);
  const r = (await pendingReturnCredits(t, first.account_id)).find((x) => x.id === first.id);
  if (!r) fail(409, 'This return is already credited.');
  if (r.invoice_line_id) {
    const line = await one('SELECT invoice_id, amount FROM hms_invoice_lines WHERE id = :id', { id: r.invoice_line_id }, t);
    const amount = Math.min(money(r.amount), money(line.amount));
    if (!(amount > 0)) fail(409, 'The billed line has no amount to credit (a package covered it).');
    return { note: await createNote(line.invoice_id, { kind: 'credit', reason: `Medicine returned: ${r.reason}`.slice(0, 1000),
      lines: [{ invoiceLineId: r.invoice_line_id, amount, gstAmount: 0 }], sourceType: 'medicine_return', sourceKey: r.id }, user, t) };
  }
  const { id } = await one(`SELECT billing_capture_charge(:acc, 'medicine_return', :key, 'Medicine', NULL, :description, NULL, 'source',
      :qty, :rate, 0, now(), :user, :reason) AS id`, {
    acc: r.account_id, key: r.id, description: `Returned: ${r.description}`, qty: -Number(r.quantity), rate: r.rate,
    user: user.id, reason: `Medicine returned: ${r.reason}`.slice(0, 500),
  }, t);
  await refreshDraft(r.account_id, user, t);
  return { charge: await one('SELECT * FROM hms_charge_events WHERE id = :id', { id }, t) };
}

// ── Payments ────────────────────────────────────────────────
async function cashSession(user, t) {
  const open = await one("SELECT id FROM hms_cash_sessions WHERE cashier_user_id = :u AND status = 'Open' FOR UPDATE", { u: user.id }, t);
  if (open) return open.id;
  // Cash taken without an open drawer opens one (float 0); it is counted at close.
  const created = await one(`INSERT INTO hms_cash_sessions (cashier_user_id) VALUES (:u)
    ON CONFLICT (cashier_user_id) WHERE status = 'Open' DO NOTHING RETURNING id`, { u: user.id }, t);
  return created ? created.id : (await one("SELECT id FROM hms_cash_sessions WHERE cashier_user_id = :u AND status = 'Open'", { u: user.id }, t)).id;
}

function translateIntentConflict(err) {
  const constraint = err?.original?.constraint || err?.parent?.constraint;
  if (constraint === 'ux_intent_open_invoice' || constraint === 'ux_intent_open_deposit') {
    fail(409, 'An earlier payment here is still pending or its outcome is unknown. Confirm or fail it first; collecting again could charge the patient twice.', 'PAYMENT_OUTCOME_OPEN');
  }
  if (constraint === 'ux_intent_provider_ref') fail(409, 'That provider reference is already recorded against another payment.', 'DUPLICATE_PROVIDER_REFERENCE');
  throw err;
}

// Start a payment. outcome: 'confirmed' (money received: cash, cheque, or a
// card/UPI/bank payment with its reference), 'pending' (sent to the terminal
// or bank) or 'unknown' (no answer; goes to reconciliation).
async function startPayment(body, user, t) {
  const purpose = body.invoiceId ? 'invoice' : 'deposit';
  const method = METHODS.includes(body.method) ? body.method : null;
  const amount = money(body.amount);
  const outcome = body.outcome || 'confirmed';
  if (!method) fail(400, `Payment method must be one of ${METHODS.join(', ')}.`);
  if (!(amount > 0) || amount > 1e9) fail(400, 'Enter an amount greater than zero.');
  if (!['confirmed', 'pending', 'unknown'].includes(outcome)) fail(400, 'Outcome must be confirmed, pending or unknown.');
  if (['Cash', 'Cheque'].includes(method) && outcome !== 'confirmed') fail(400, 'Cash and cheque payments are recorded when received.');
  const reference = typeof body.providerReference === 'string' && body.providerReference.trim() ? body.providerReference.trim().slice(0, 100) : null;
  if (outcome === 'confirmed' && !['Cash', 'Cheque'].includes(method) && !reference) fail(400, 'Enter the transaction reference from the card terminal, UPI app or bank.');
  let patientId; let accountId = null; let invoiceId = null;
  if (purpose === 'invoice') {
    const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(body.invoiceId) }, t);
    if (!first) fail(404, 'Invoice not found.');
    await lockAccount(first.account_id, t);
    const inv = await lockInvoice(body.invoiceId, t);
    if (['Draft', 'Void'].includes(inv.status)) fail(409, 'Payments are taken only on an issued invoice.');
    const due = money((await one('SELECT billing_invoice_patient_due(:id) AS due', { id: inv.id }, t)).due);
    if (due <= 0) fail(400, 'This invoice is already fully paid.', 'NOTHING_DUE');
    if (amount > due + 0.001) fail(400, `Amount is more than the balance due (Rs. ${due.toFixed(2)}).`, 'MORE_THAN_DUE');
    ({ patient_id: patientId, account_id: accountId, id: invoiceId } = inv);
  } else {
    if (body.accountId) {
      const acc = await lockAccount(body.accountId, t);
      ({ patient_id: patientId, id: accountId } = acc);
    } else {
      patientId = Number(body.patientId);
      if (!Number.isInteger(patientId) || !(await one('SELECT id FROM hms_patients WHERE id = :id', { id: patientId }, t))) fail(404, 'Patient not found.');
    }
  }
  // A payment whose outcome is still open blocks another collection for the
  // same bill (or the same deposit), whatever its method.
  const open = await one(`SELECT id, state, method FROM hms_payment_intents WHERE state IN ('Initiated', 'Pending', 'Unknown')
      AND ((CAST(:inv AS uuid) IS NOT NULL AND invoice_id = CAST(:inv AS uuid))
        OR (CAST(:inv AS uuid) IS NULL AND purpose = 'deposit' AND patient_id = :pid AND account_id IS NOT DISTINCT FROM CAST(:acc AS uuid)))
    LIMIT 1`, { inv: invoiceId, pid: patientId, acc: accountId }, t);
  if (open) {
    fail(409, `An earlier ${open.method} payment here is ${open.state.toLowerCase()}. Confirm or fail it first; collecting again could charge the patient twice.`, 'PAYMENT_OUTCOME_OPEN');
  }
  const state = { confirmed: 'Confirmed', pending: 'Pending', unknown: 'Unknown' }[outcome];
  const intent = await one(`INSERT INTO hms_payment_intents (patient_id, account_id, purpose, invoice_id, amount, method, state,
      provider_reference, notes, created_by, resolved_by, resolved_at)
    VALUES (:pid, :acc, :purpose, :inv, :amount, :method, :state, :ref, :notes, :user,
      CASE WHEN :state = 'Confirmed' THEN CAST(:user AS integer) END, CASE WHEN :state = 'Confirmed' THEN now() END) RETURNING *`, {
    pid: patientId, acc: accountId, purpose, inv: invoiceId, amount, method, state, ref: reference,
    notes: typeof body.notes === 'string' ? body.notes.slice(0, 500) : null, user: user.id,
  }, t).catch(translateIntentConflict);
  const receipt = state === 'Confirmed' ? await settleIntent(intent, user, t) : null;
  return { intent: await one('SELECT * FROM hms_payment_intents WHERE id = :id', { id: intent.id }, t), receipt };
}

// Money received: a receipt, then either a deposit or an allocation to the
// invoice. If the invoice now owes less than was paid (a credit note was issued
// meanwhile), the rest is kept as the patient's credit, never lost or doubled.
async function settleIntent(intent, user, t) {
  const sessionId = intent.method === 'Cash' ? await cashSession(user, t) : null;
  const number = await nextNumber('RCP', 'hms_receipt_seq', t);
  const receipt = await one(`INSERT INTO hms_receipts (receipt_number, intent_id, patient_id, amount, method, provider_reference, received_by, cash_session_id)
    VALUES (:number, :intent, :pid, :amount, :method, :ref, :user, :session) RETURNING *`, {
    number, intent: intent.id, pid: intent.patient_id, amount: intent.amount, method: intent.method,
    ref: intent.provider_reference, user: user.id, session: sessionId,
  }, t);
  const cashGl = CASH_GL[intent.method];
  if (intent.purpose === 'deposit') {
    await run(`INSERT INTO hms_patient_funds (patient_id, account_id, kind, amount, receipt_id, created_by)
      VALUES (:pid, :acc, 'deposit', :amount, :receipt, :user)`, { pid: intent.patient_id, acc: intent.account_id, amount: intent.amount, receipt: receipt.id, user: user.id }, t);
    await post(t, { sourceType: 'receipt', sourceKey: receipt.id, accountId: intent.account_id, patientId: intent.patient_id, user,
      memo: `Deposit ${number}`, lines: [{ gl: cashGl, debit: Number(intent.amount) }, { gl: '2000', credit: Number(intent.amount) }] });
    return receipt;
  }
  await lockInvoice(intent.invoice_id, t);
  const due = Math.max(0, money((await one('SELECT billing_invoice_patient_due(:id) AS due', { id: intent.invoice_id }, t)).due));
  const applied = Math.min(due, money(intent.amount));
  const excess = money(Number(intent.amount) - applied);
  if (applied > 0) {
    await run('INSERT INTO hms_allocations (invoice_id, receipt_id, amount, allocated_by) VALUES (:inv, :receipt, :amount, :user)',
      { inv: intent.invoice_id, receipt: receipt.id, amount: applied, user: user.id }, t);
  }
  if (excess > 0) {
    await run(`INSERT INTO hms_patient_funds (patient_id, account_id, kind, amount, receipt_id, created_by)
      VALUES (:pid, :acc, 'credit', :amount, :receipt, :user)`, { pid: intent.patient_id, acc: intent.account_id, amount: excess, receipt: receipt.id, user: user.id }, t);
  }
  await post(t, { sourceType: 'receipt', sourceKey: receipt.id, accountId: intent.account_id, patientId: intent.patient_id, user,
    memo: `Payment ${number}`, lines: [{ gl: cashGl, debit: Number(intent.amount) }, { gl: '1100', credit: applied }, { gl: '2300', credit: excess }] });
  await writeLegacyPayment(intent.invoice_id, receipt, applied, user, t);
  await syncLegacyBill(intent.invoice_id, t);
  return receipt;
}

async function lockIntent(intentId, t) {
  const i = await one('SELECT * FROM hms_payment_intents WHERE id::text = :id', { id: String(intentId) }, t);
  if (!i) fail(404, 'Payment not found.');
  if (i.account_id) await lockAccount(i.account_id, t);
  if (i.invoice_id) await lockInvoice(i.invoice_id, t);
  return one('SELECT * FROM hms_payment_intents WHERE id = :id FOR UPDATE', { id: i.id }, t);
}

// The terminal, bank or reconciliation reports the outcome of a pending or unknown payment.
async function resolvePayment(intentId, { outcome, providerReference, reason }, user, t) {
  const intent = await lockIntent(intentId, t);
  if (['Confirmed', 'Failed'].includes(intent.state)) {
    fail(409, `This payment is already ${intent.state.toLowerCase()}.`, 'PAYMENT_ALREADY_RESOLVED');
  }
  if (outcome === 'unknown') {
    return { intent: await one("UPDATE hms_payment_intents SET state = 'Unknown' WHERE id = :id RETURNING *", { id: intent.id }, t) };
  }
  if (outcome === 'failed') {
    if (!reason || String(reason).trim().length < 3) fail(400, 'Say why the payment failed.');
    return { intent: await one(`UPDATE hms_payment_intents SET state = 'Failed', failure_reason = :reason, resolved_by = :user, resolved_at = now()
      WHERE id = :id RETURNING *`, { id: intent.id, reason: String(reason).trim().slice(0, 500), user: user.id }, t) };
  }
  if (outcome !== 'confirmed') fail(400, 'Outcome must be confirmed, failed or unknown.');
  const reference = intent.provider_reference || (typeof providerReference === 'string' ? providerReference.trim().slice(0, 100) : '');
  if (!['Cash', 'Cheque'].includes(intent.method) && !reference) fail(400, 'Enter the provider reference that confirms the payment.');
  const updated = await one(`UPDATE hms_payment_intents SET state = 'Confirmed', provider_reference = :ref, resolved_by = :user, resolved_at = now()
    WHERE id = :id RETURNING *`, { id: intent.id, ref: reference || null, user: user.id }, t).catch(translateIntentConflict);
  const receipt = await settleIntent(updated, user, t);
  return { intent: updated, receipt };
}

// ── Deposits and credits ────────────────────────────────────
async function lockFund(fundId, t) {
  const f = await one('SELECT * FROM hms_patient_funds WHERE id::text = :id FOR UPDATE', { id: String(fundId) }, t);
  if (!f) fail(404, 'Deposit or credit not found.');
  return f;
}

async function allocateFund({ fundId, invoiceId, amount }, user, t) {
  const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  await lockAccount(first.account_id, t);
  const inv = await lockInvoice(invoiceId, t);
  if (['Draft', 'Void'].includes(inv.status)) fail(409, 'Deposits are applied only to an issued invoice.');
  const fund = await lockFund(fundId, t);
  if (fund.patient_id !== inv.patient_id) fail(409, 'A deposit is used only for the same patient.');
  const balance = money((await one('SELECT billing_fund_balance(:id) AS b', { id: fund.id }, t)).b);
  const due = money((await one('SELECT billing_invoice_patient_due(:id) AS due', { id: inv.id }, t)).due);
  const value = amount == null ? Math.min(balance, due) : money(amount);
  if (!(value > 0)) fail(409, balance <= 0 ? 'Nothing is left on this deposit.' : 'Nothing is due on this invoice.', 'NOTHING_TO_ALLOCATE');
  if (value > balance + 0.001) fail(400, `Only Rs. ${balance.toFixed(2)} is left on this deposit.`, 'FUND_OVERALLOCATED');
  if (value > due + 0.001) fail(400, `Only Rs. ${due.toFixed(2)} is due on this invoice.`, 'MORE_THAN_DUE');
  const alloc = await one('INSERT INTO hms_allocations (invoice_id, fund_id, amount, allocated_by) VALUES (:inv, :fund, :amount, :user) RETURNING *',
    { inv: inv.id, fund: fund.id, amount: value, user: user.id }, t);
  await post(t, { sourceType: 'allocation', sourceKey: alloc.id, accountId: inv.account_id, patientId: inv.patient_id, user,
    memo: `${fund.kind === 'deposit' ? 'Deposit' : 'Credit'} applied to ${inv.invoice_number}`,
    lines: [{ gl: fund.kind === 'deposit' ? '2000' : '2300', debit: value }, { gl: '1100', credit: value }] });
  await syncLegacyBill(inv.id, t);
  return alloc;
}

// The patient's deposits and credits, this account's first, oldest first, up to what is due.
async function applyAvailableFunds(invoiceId, user, t) {
  const inv = await lockInvoice(invoiceId, t);
  const funds = await rows(`SELECT f.id FROM hms_patient_funds f WHERE f.patient_id = :pid
      AND (f.account_id = :acc OR f.account_id IS NULL) AND billing_fund_balance(f.id) > 0
    ORDER BY (f.account_id IS NULL), f.created_at, f.id`, { pid: inv.patient_id, acc: inv.account_id }, t);
  const applied = [];
  for (const f of funds) {
    const due = money((await one('SELECT billing_invoice_patient_due(:id) AS due', { id: inv.id }, t)).due);
    if (due <= 0) break;
    applied.push(await allocateFund({ fundId: f.id, invoiceId: inv.id }, user, t));
  }
  return applied;
}

async function patientFunds(patientId, t) {
  return rows(`SELECT f.*, billing_fund_balance(f.id) AS balance, r.receipt_number, n.note_number, a.account_number
    FROM hms_patient_funds f LEFT JOIN hms_receipts r ON r.id = f.receipt_id LEFT JOIN hms_invoice_notes n ON n.id = f.note_id
    LEFT JOIN hms_billing_accounts a ON a.id = f.account_id
    WHERE f.patient_id = :pid ORDER BY f.created_at`, { pid: Number(patientId) }, t);
}

// ── Refunds ─────────────────────────────────────────────────
async function requestRefund({ fundId, amount, method, reason }, user, t) {
  const fund = await lockFund(fundId, t);
  if (!METHODS.includes(method)) fail(400, `Refund method must be one of ${METHODS.join(', ')}.`);
  const value = money(amount);
  const balance = money((await one('SELECT billing_fund_balance(:id) AS b', { id: fund.id }, t)).b);
  if (!(value > 0)) fail(400, 'Enter an amount greater than zero.');
  if (value > balance + 0.001) fail(400, `Only Rs. ${balance.toFixed(2)} can be refunded from this ${fund.kind}.`, 'REFUND_EXCEEDS_CREDIT');
  if (!reason || String(reason).trim().length < 5) fail(400, 'Give the reason for the refund (at least 5 characters).');
  const number = await nextNumber('RFD', 'hms_refund_seq', t);
  return one(`INSERT INTO hms_refunds (refund_number, fund_id, patient_id, amount, method, reason, requested_by)
    VALUES (:number, :fund, :pid, :amount, :method, :reason, :user) RETURNING *`,
  { number, fund: fund.id, pid: fund.patient_id, amount: value, method, reason: String(reason).trim().slice(0, 1000), user: user.id }, t);
}

async function lockRefund(refundId, t) {
  const r = await one('SELECT * FROM hms_refunds WHERE id::text = :id', { id: String(refundId) }, t);
  if (!r) fail(404, 'Refund not found.');
  await lockFund(r.fund_id, t);
  return one('SELECT * FROM hms_refunds WHERE id = :id FOR UPDATE', { id: r.id }, t);
}

async function decideRefund(refundId, { approve, note }, user, t) {
  if (!isAdmin(user)) fail(403, 'Refunds are approved by an administrator.');
  const r = await lockRefund(refundId, t);
  if (r.state !== 'Requested') fail(409, `This refund is already ${r.state.toLowerCase()}.`, 'REFUND_DECIDED');
  if (r.requested_by === user.id) fail(403, 'A refund is approved by someone other than the person who asked for it.', 'SAME_PERSON');
  if (!approve && (!note || String(note).trim().length < 3)) fail(400, 'Say why the refund is rejected.');
  return one(`UPDATE hms_refunds SET state = :state, approved_by = CASE WHEN :approve THEN CAST(:user AS integer) END,
      approved_at = CASE WHEN :approve THEN now() END, decision_note = :note WHERE id = :id RETURNING *`,
  { id: r.id, state: approve ? 'Approved' : 'Rejected', approve: !!approve, user: user.id, note: note ? String(note).trim().slice(0, 500) : null }, t);
}

async function postRefund(r, user, t) {
  const fund = await one('SELECT kind, account_id FROM hms_patient_funds WHERE id = :id', { id: r.fund_id }, t);
  await post(t, { sourceType: 'refund', sourceKey: r.id, accountId: fund.account_id, patientId: r.patient_id, user,
    memo: `Refund ${r.refund_number}`, lines: [{ gl: fund.kind === 'deposit' ? '2000' : '2300', debit: Number(r.amount) }, { gl: CASH_GL[r.method], credit: Number(r.amount) }] });
}

// Pay out an approved refund. Cash leaves the drawer now; other methods are
// confirmed (or failed) when the bank or provider answers.
async function payRefund(refundId, { providerReference }, user, t) {
  const r = await lockRefund(refundId, t);
  if (r.state !== 'Approved') fail(409, r.state === 'Requested' ? 'The refund is not approved yet.' : `This refund is already ${r.state.toLowerCase()}.`, 'REFUND_STATE');
  const ref = typeof providerReference === 'string' && providerReference.trim() ? providerReference.trim().slice(0, 100) : null;
  if (r.method === 'Cash') {
    const session = await cashSession(user, t);
    await run(`UPDATE hms_refunds SET state = 'Submitted', submitted_by = :user, submitted_at = now() WHERE id = :id`, { id: r.id, user: user.id }, t);
    const done = await one(`UPDATE hms_refunds SET state = 'Confirmed', completed_by = :user, completed_at = now(), cash_session_id = :session
      WHERE id = :id RETURNING *`, { id: r.id, user: user.id, session }, t);
    await postRefund(done, user, t);
    return done;
  }
  return one(`UPDATE hms_refunds SET state = 'Submitted', submitted_by = :user, submitted_at = now(), provider_reference = :ref
    WHERE id = :id RETURNING *`, { id: r.id, user: user.id, ref }, t);
}

async function completeRefund(refundId, { outcome, providerReference, reason }, user, t) {
  const r = await lockRefund(refundId, t);
  if (r.state === 'Confirmed' || r.state === 'Failed') fail(409, `This refund is already ${r.state.toLowerCase()}.`, 'REFUND_ALREADY_COMPLETED');
  if (r.state !== 'Submitted') fail(409, 'Only a submitted refund can be confirmed or failed.', 'REFUND_STATE');
  if (outcome === 'failed') {
    if (!reason || String(reason).trim().length < 3) fail(400, 'Say why the refund failed.');
    return one(`UPDATE hms_refunds SET state = 'Failed', failure_reason = :reason, completed_by = :user, completed_at = now()
      WHERE id = :id RETURNING *`, { id: r.id, reason: String(reason).trim().slice(0, 500), user: user.id }, t);
  }
  const ref = r.provider_reference || (typeof providerReference === 'string' ? providerReference.trim().slice(0, 100) : '');
  if (!ref) fail(400, 'Enter the bank or provider reference for the refund.');
  const done = await one(`UPDATE hms_refunds SET state = 'Confirmed', provider_reference = :ref, completed_by = :user, completed_at = now()
    WHERE id = :id RETURNING *`, { id: r.id, ref, user: user.id }, t);
  await postRefund(done, user, t);
  return done;
}

// ── Legacy projection (hms_bills / hms_bill_items / hms_payments) ──
// Older screens, the bill PDF and reports read these tables. They are written
// from the invoice and its receipts and never edited by hand.
async function writeLegacyBill(inv, acc, lines, user, t) {
  const billId = Number((await one("SELECT nextval('hms_bills_seq') AS n", {}, t)).n);
  await run(`INSERT INTO hms_bills (id, patient_id, encounter_id, admission_id, bill_type, bill_number, status, total_amount, discount_amount,
      discount_approved_by, gst_amount, net_payable, advance_adjusted, created_by, created_at, updated_at)
    VALUES (:id, :pid, :enc, :adm, :type, :number, 'Pending', 0, 0, :approver, 0, 0, 0, :user, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, {
    id: billId, pid: inv.patient_id, enc: acc.encounter_id, adm: acc.admission_id, type: acc.episode_type === 'admission' ? 'IPD' : 'OPD',
    number: inv.invoice_number, approver: inv.discount_approved_by, user: user.id,
  }, t);
  // Bed days are shown as one line per ward rate; reversals of earlier
  // invoices' charges reduce the bill as a discount.
  const groups = [];
  for (const l of lines) {
    const amount = Number(l.amount);
    if (amount < 0) continue;
    const wardDay = l.category === 'Ward';
    const key = wardDay ? `W:${l.code}:${l.unit_price}` : `L:${l.id}`;
    let g = groups.find((x) => x.key === key);
    if (!g) {
      g = { key, type: l.category, name: wardDay ? l.description.replace(/ bed day \d+$/, ' bed days') : l.description,
        quantity: 0, rate: money(l.unit_price), amount: 0, gstRate: Number(l.gst_rate), gst: 0, date: l.service_at };
      groups.push(g);
    }
    g.quantity += Number(l.quantity);
    g.amount = money(g.amount + amount);
    g.gst = money(g.gst + Number(l.gst_amount));
  }
  for (const g of groups) {
    await run(`INSERT INTO hms_bill_items (id, bill_id, item_type, item_name, quantity, rate, gst_rate, gst_amount, amount, service_date)
      VALUES (nextval('hms_bill_items_seq'), :bill, :type, :name, :qty, :rate, :gstRate, :gst, :amount, :date)`,
    { bill: billId, type: g.type.slice(0, 30), name: g.name.slice(0, 200), qty: g.quantity, rate: g.rate, gstRate: g.gstRate, gst: g.gst, amount: g.amount, date: g.date }, t);
  }
  await run('UPDATE hms_invoices SET legacy_bill_id = :bill WHERE id = :id', { bill: billId, id: inv.id }, t);
  await run('UPDATE hms_bills SET total_amount = :total WHERE id = :bill', { bill: billId, total: money(groups.reduce((s, g) => s + g.amount, 0)) }, t);
  await syncLegacyBill(inv.id, t);
}

async function syncLegacyBill(invoiceId, t) {
  const inv = await one('SELECT * FROM hms_invoices WHERE id = :id', { id: invoiceId }, t);
  if (!inv?.legacy_bill_id) return;
  const s = await one(`SELECT
      COALESCE((SELECT sum(patient_amount) FROM hms_invoice_notes WHERE invoice_id = :id AND kind = 'credit'), 0) AS pcred,
      COALESCE((SELECT sum(patient_amount) FROM hms_invoice_notes WHERE invoice_id = :id AND kind = 'debit'), 0) AS pdeb,
      COALESCE((SELECT sum(amount) FROM hms_invoice_notes WHERE invoice_id = :id AND kind = 'credit'), 0) AS cred,
      COALESCE((SELECT -sum(amount) FROM hms_invoice_lines WHERE invoice_id = :id AND amount < 0), 0) AS negative,
      COALESCE((SELECT sum(amount) FROM hms_allocations WHERE invoice_id = :id AND fund_id IS NOT NULL), 0) AS funds,
      COALESCE((SELECT sum(amount) FROM hms_allocations WHERE invoice_id = :id AND receipt_id IS NOT NULL), 0) AS receipts`, { id: inv.id }, t);
  const net = Math.max(0, money(Number(inv.patient_amount) - Number(s.pcred) + Number(s.pdeb) - Number(s.funds)));
  const due = money(net - Number(s.receipts));
  const status = inv.status === 'Void' ? 'Cancelled' : due <= 0 ? 'Paid' : Number(s.receipts) > 0 ? 'Partially Paid' : 'Pending';
  // Credits and reversed charges show as a discount on the old bill format.
  await run(`UPDATE hms_bills SET discount_amount = :discount, gst_amount = :gst, net_payable = :net, advance_adjusted = :funds,
      status = :status, updated_at = CURRENT_TIMESTAMP WHERE id = :bill`, {
    bill: inv.legacy_bill_id, discount: money(Number(inv.discount_amount) + Number(s.cred) + Number(s.negative)),
    gst: money(inv.gst_amount), net, funds: money(s.funds), status,
  }, t);
}

async function writeLegacyPayment(invoiceId, receipt, applied, user, t) {
  const inv = await one('SELECT legacy_bill_id FROM hms_invoices WHERE id = :id', { id: invoiceId }, t);
  if (!inv?.legacy_bill_id || !(applied > 0)) return;
  const p = await one(`INSERT INTO hms_payments (id, bill_id, patient_id, payment_mode, amount, reference_number, received_by, receipt_number, payment_date)
    VALUES (nextval('hms_payments_seq'), :bill, :pid, :mode, :amount, :ref, :user, :number, CURRENT_TIMESTAMP) RETURNING id`, {
    bill: inv.legacy_bill_id, pid: receipt.patient_id, mode: receipt.method === 'BankTransfer' ? 'Bank' : receipt.method, amount: applied,
    ref: receipt.provider_reference, user: user.id, number: receipt.receipt_number,
  }, t);
  await run('UPDATE hms_receipts SET legacy_payment_id = :p WHERE id = :id', { p: p.id, id: receipt.id }, t);
}

// ── Read models ─────────────────────────────────────────────
async function invoiceView(invoiceId, t) {
  const inv = await one(`SELECT i.*, billing_invoice_patient_due(i.id) AS patient_due, a.account_number, a.episode_type, a.encounter_id, a.admission_id,
      p.name AS patient_name, p.uhid, u.name AS issued_by_name, d.name AS discount_approved_by_name
    FROM hms_invoices i JOIN hms_billing_accounts a ON a.id = i.account_id JOIN hms_patients p ON p.id = i.patient_id
    LEFT JOIN hms_users u ON u.id = i.issued_by LEFT JOIN hms_users d ON d.id = i.discount_approved_by
    WHERE i.id::text = :id`, { id: String(invoiceId) }, t);
  if (!inv) return null;
  inv.lines = await rows('SELECT * FROM hms_invoice_lines WHERE invoice_id = :id ORDER BY line_no', { id: inv.id }, t);
  inv.notes = await rows('SELECT * FROM hms_invoice_notes WHERE invoice_id = :id ORDER BY created_at', { id: inv.id }, t);
  inv.allocations = await rows(`SELECT al.*, r.receipt_number, r.method, f.kind AS fund_kind FROM hms_allocations al
    LEFT JOIN hms_receipts r ON r.id = al.receipt_id LEFT JOIN hms_patient_funds f ON f.id = al.fund_id
    WHERE al.invoice_id = :id ORDER BY al.allocated_at`, { id: inv.id }, t);
  inv.open_payments = await rows("SELECT * FROM hms_payment_intents WHERE invoice_id = :id AND state IN ('Initiated', 'Pending', 'Unknown')", { id: inv.id }, t);
  inv.claim = await one('SELECT * FROM hms_claims WHERE invoice_id = :id', { id: inv.id }, t);
  return inv;
}

async function accountView(accountId, t) {
  const acc = await one(`SELECT a.*, p.name AS patient_name, p.uhid, p.age, p.gender,
      adm.status AS admission_status, adm.admission_date, adm.discharge_date, e.status AS encounter_status, e.encounter_date,
      lb.bill_number AS legacy_bill_number
    FROM hms_billing_accounts a JOIN hms_patients p ON p.id = a.patient_id
    LEFT JOIN hms_admissions adm ON adm.id = a.admission_id LEFT JOIN hms_encounters e ON e.id = a.encounter_id
    LEFT JOIN hms_bills lb ON lb.id = a.legacy_bill_id
    WHERE a.id::text = :id`, { id: String(accountId) }, t);
  if (!acc) return null;
  acc.charges = await rows(`SELECT c.*, u.name AS posted_by_name,
      (SELECT i.invoice_number FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
        WHERE l.charge_event_id = c.id AND NOT l.released AND i.status <> 'Draft' LIMIT 1) AS invoice_number,
      EXISTS (SELECT 1 FROM hms_charge_events r WHERE r.reverses_id = c.id) AS reversed
    FROM hms_charge_events c LEFT JOIN hms_users u ON u.id = c.posted_by
    WHERE c.account_id = :id ORDER BY c.service_at, c.created_at`, { id: acc.id }, t);
  acc.invoices = await rows(`SELECT i.*, billing_invoice_patient_due(i.id) AS patient_due FROM hms_invoices i
    WHERE i.account_id = :id ORDER BY i.created_at`, { id: acc.id }, t);
  acc.funds = (await patientFunds(acc.patient_id, t)).filter((f) => !f.account_id || f.account_id === acc.id);
  acc.packages = await rows(`SELECT ap.*, p.code, p.name, pv.version, pv.price FROM hms_account_packages ap
    JOIN hms_package_versions pv ON pv.id = ap.package_version_id JOIN hms_packages p ON p.id = pv.package_id
    WHERE ap.account_id = :id`, { id: acc.id }, t);
  acc.payer = await one(`SELECT ap.*, c.policy_number, c.member_id, py.name AS payer_name, pa.status AS preauth_status, pa.approved_amount
    FROM hms_account_payers ap JOIN hms_coverages c ON c.id = ap.coverage_id JOIN hms_payers py ON py.id = c.payer_id
    JOIN hms_preauthorizations pa ON pa.id = ap.preauth_id WHERE ap.account_id = :id`, { id: acc.id }, t);
  acc.open_payments = await rows("SELECT * FROM hms_payment_intents WHERE account_id = :id AND state IN ('Initiated', 'Pending', 'Unknown')", { id: acc.id }, t);
  acc.needs_credit = await uncreditedReversals(acc.id, t);
  const live = acc.invoices.filter((i) => !['Draft', 'Void'].includes(i.status));
  acc.totals = {
    charges: money(acc.charges.reduce((s, c) => s + Number(c.amount) + Number(c.gst_amount), 0)),
    invoiced: money(live.reduce((s, i) => s + Number(i.total), 0)),
    patientDue: money(live.reduce((s, i) => s + Math.max(0, Number(i.patient_due)), 0)),
    payerShare: money(live.reduce((s, i) => s + Number(i.payer_amount), 0)),
    fundsAvailable: money(acc.funds.reduce((s, f) => s + Math.max(0, Number(f.balance)), 0)),
  };
  return acc;
}

module.exports = {
  fail, rows, one, run, money, post, isAdmin, METHODS,
  accountFor, lockAccount, accrueWard, addCharge, reverseCharge, applyPackage,
  pendingReturnCredits, creditReturn,
  refreshDraft, draftInvoice, setDiscount, issueInvoice, voidInvoice, createNote, uncreditedReversals, creditReversal,
  startPayment, resolvePayment, allocateFund, applyAvailableFunds, patientFunds,
  requestRefund, decideRefund, payRefund, completeRefund,
  syncLegacyBill, invoiceView, accountView, lockInvoice,
};
