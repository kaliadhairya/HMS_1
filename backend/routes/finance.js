const express = require('express');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const B = require('../services/billing');
const INS = require('../services/insurance');
const R = require('../services/reconciliation');

// Revenue cycle API (Phase 5). Mounted at /api/finance. Every command runs in
// one transaction and needs an Idempotency-Key (utils/idempotency.js), so a
// retried request returns the first answer and never posts twice.
const router = express.Router();
const ADMIN = ['super_admin', 'admin'];
const DESK = [...ADMIN, 'receptionist'];
const WARD = [...DESK, 'nurse'];

const { rows, one, money } = B;

function sendError(res, err, fallback) {
  const code = err.original?.code || err.parent?.code;
  if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  if (code === '55P03' || code === '40P01' || code === '40001') return res.status(409).json({ success: false, code: 'BUSY', message: 'Someone else is changing this account. Try again.' });
  // Integrity rules in the database (migrations 0070–0076) explain themselves.
  if (code === '23514' || code === '23001' || code === '23505' || code === '23P01') {
    return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
  }
  console.error(`${fallback}:`, err.original?.message || err.message);
  return res.status(500).json({ success: false, message: fallback });
}

// Run a command or query in a transaction and answer with its result.
const handle = (fallback, fn, { status = 200, audit } = {}) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    if (data === undefined || data === null) return res.status(404).json({ success: false, message: 'Not found.' });
    if (audit) await logAction(req.user.id, 'UPDATE', 'billing', data.id || null, null, { action: audit }, req.ip).catch(() => {});
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, fallback);
  }
};

router.use(protect);

// ── Accounts ────────────────────────────────────────────────
// The account of an episode, opened on first use.
router.get('/accounts/by-episode', restrictTo(...WARD), handle('Could not open the account', async (req, t) => {
  const encounterId = Number(req.query.encounterId) || null;
  const admissionId = Number(req.query.admissionId) || null;
  if (!encounterId === !admissionId) B.fail(400, 'Give either an encounter or an admission.');
  if (req.user.role === 'nurse' && !admissionId) B.fail(403, 'Nurses work with inpatient accounts.');
  const exists = encounterId
    ? await one('SELECT id FROM hms_encounters WHERE id = :id', { id: encounterId }, t)
    : await one('SELECT id FROM hms_admissions WHERE id = :id', { id: admissionId }, t);
  if (!exists) B.fail(404, encounterId ? 'Encounter not found.' : 'Admission not found.');
  const id = await B.accountFor({ encounterId, admissionId }, t);
  if (admissionId) await B.accrueWard(admissionId, t);
  await B.refreshDraft(id, req.user, t);
  return B.accountView(id, t);
}));

router.get('/accounts', restrictTo(...DESK), handle('Could not list accounts', async (req, t) => {
  const patientId = Number(req.query.patientId) || null;
  return rows(`SELECT a.*, p.name AS patient_name, p.uhid,
      (SELECT COALESCE(sum(GREATEST(0, billing_invoice_patient_due(i.id))), 0) FROM hms_invoices i WHERE i.account_id = a.id AND i.status NOT IN ('Draft', 'Void')) AS patient_due
    FROM hms_billing_accounts a JOIN hms_patients p ON p.id = a.patient_id
    WHERE (CAST(:pid AS integer) IS NULL OR a.patient_id = :pid)
    ORDER BY a.opened_at DESC LIMIT 100`, { pid: patientId }, t);
}));

async function accountAccess(req, accountId, t) {
  const acc = await one('SELECT id, episode_type FROM hms_billing_accounts WHERE id::text = :id', { id: String(accountId) }, t);
  if (!acc) B.fail(404, 'Billing account not found.');
  if (req.user.role === 'nurse' && acc.episode_type !== 'admission') B.fail(403, 'Nurses work with inpatient accounts.');
  return acc;
}

router.get('/accounts/:id', restrictTo(...WARD), handle('Could not load the account', async (req, t) => {
  await accountAccess(req, req.params.id, t);
  return B.accountView(req.params.id, t);
}));

router.post('/accounts/:id/charges', restrictTo(...WARD), handle('Could not add the charge', async (req, t) => {
  await accountAccess(req, req.params.id, t);
  return B.addCharge(req.params.id, req.body || {}, req.user, t);
}, { status: 201, audit: 'add_charge' }));

router.post('/charges/:id/reverse', restrictTo(...WARD), handle('Could not cancel the charge', async (req, t) => {
  const c = await one('SELECT account_id FROM hms_charge_events WHERE id::text = :id', { id: String(req.params.id) }, t);
  if (!c) B.fail(404, 'Charge not found.');
  await accountAccess(req, c.account_id, t);
  return B.reverseCharge(req.params.id, req.body?.reason, req.user, t);
}, { audit: 'reverse_charge' }));

router.post('/charges/:id/credit', restrictTo(...ADMIN), handle('Could not credit the cancelled charge', (req, t) => B.creditReversal(req.params.id, req.user, t), { status: 201, audit: 'credit_reversal' }));

router.post('/accounts/:id/packages', restrictTo(...DESK), handle('Could not apply the package', (req, t) => B.applyPackage(req.params.id, req.body?.packageCode, req.user, t), { status: 201, audit: 'apply_package' }));

// ── Invoices ────────────────────────────────────────────────
router.post('/accounts/:id/invoices/draft', restrictTo(...WARD), handle('Could not prepare the bill', async (req, t) => {
  await accountAccess(req, req.params.id, t);
  const draft = await B.draftInvoice(req.params.id, req.user, t);
  return B.invoiceView(draft.id, t);
}));

router.get('/invoices/:id', restrictTo(...WARD), handle('Could not load the invoice', async (req, t) => {
  const inv = await B.invoiceView(req.params.id, t);
  if (inv) await accountAccess(req, inv.account_id, t);
  return inv;
}));

router.put('/invoices/:id/discount', restrictTo(...ADMIN), handle('Could not apply the discount', async (req, t) => {
  const inv = await B.setDiscount(req.params.id, req.body || {}, req.user, t);
  return B.invoiceView(inv.id, t);
}, { audit: 'discount' }));

router.post('/invoices/:id/issue', restrictTo(...DESK), handle('Could not issue the invoice', async (req, t) => {
  const inv = await B.issueInvoice(req.params.id, { revision: req.body?.revision, applyDeposits: req.body?.applyDeposits === true }, req.user, t);
  return B.invoiceView(inv.id, t);
}, { audit: 'issue_invoice' }));

router.post('/invoices/:id/void', restrictTo(...ADMIN), handle('Could not void the invoice', async (req, t) => {
  const inv = await B.voidInvoice(req.params.id, req.body?.reason, req.user, t);
  return B.invoiceView(inv.id, t);
}, { audit: 'void_invoice' }));

router.post('/invoices/:id/notes', restrictTo(...ADMIN), handle('Could not record the note', (req, t) => B.createNote(req.params.id, {
  kind: req.body?.kind, reason: req.body?.reason, lines: req.body?.lines, payerAmount: req.body?.payerAmount,
}, req.user, t), { status: 201, audit: 'invoice_note' }));

// ── Payments, deposits and refunds ──────────────────────────
router.post('/payments', restrictTo(...DESK), handle('Could not record the payment', (req, t) => B.startPayment(req.body || {}, req.user, t), { status: 201, audit: 'payment' }));

router.get('/payments', restrictTo(...DESK), handle('Could not list payments', (req, t) => rows(`SELECT pi.*, p.name AS patient_name, p.uhid, i.invoice_number
    FROM hms_payment_intents pi JOIN hms_patients p ON p.id = pi.patient_id LEFT JOIN hms_invoices i ON i.id = pi.invoice_id
    WHERE (CAST(:states AS text[]) IS NULL OR pi.state = ANY(CAST(:states AS text[])))
    ORDER BY pi.created_at DESC LIMIT 200`, { states: req.query.state ? `{${String(req.query.state).split(',').filter((s) => /^[A-Za-z]+$/.test(s)).join(',')}}` : null }, t)));

for (const [path, outcome] of [['confirm', 'confirmed'], ['fail', 'failed'], ['unknown', 'unknown']]) {
  router.post(`/payments/:id/${path}`, restrictTo(...DESK), handle('Could not update the payment',
    (req, t) => B.resolvePayment(req.params.id, { outcome, providerReference: req.body?.providerReference, reason: req.body?.reason }, req.user, t),
    { audit: `payment_${outcome}` }));
}

router.get('/patients/:id/funds', restrictTo(...WARD), handle('Could not load deposits', (req, t) => B.patientFunds(req.params.id, t)));

router.post('/funds/:id/allocate', restrictTo(...DESK), handle('Could not apply the deposit',
  (req, t) => B.allocateFund({ fundId: req.params.id, invoiceId: req.body?.invoiceId, amount: req.body?.amount }, req.user, t), { status: 201, audit: 'allocate_fund' }));

router.post('/refunds', restrictTo(...DESK), handle('Could not request the refund', (req, t) => B.requestRefund(req.body || {}, req.user, t), { status: 201, audit: 'refund_request' }));
router.get('/refunds', restrictTo(...DESK), handle('Could not list refunds', (req, t) => rows(`SELECT r.*, p.name AS patient_name, p.uhid, f.kind AS fund_kind,
    u.name AS requested_by_name, a.name AS approved_by_name
    FROM hms_refunds r JOIN hms_patients p ON p.id = r.patient_id JOIN hms_patient_funds f ON f.id = r.fund_id
    JOIN hms_users u ON u.id = r.requested_by LEFT JOIN hms_users a ON a.id = r.approved_by
    WHERE (CAST(:state AS text) IS NULL OR r.state = :state) ORDER BY r.requested_at DESC LIMIT 200`, { state: req.query.state || null }, t)));
router.post('/refunds/:id/approve', restrictTo(...ADMIN), handle('Could not approve the refund', (req, t) => B.decideRefund(req.params.id, { approve: true, note: req.body?.note }, req.user, t), { audit: 'refund_approve' }));
router.post('/refunds/:id/reject', restrictTo(...ADMIN), handle('Could not reject the refund', (req, t) => B.decideRefund(req.params.id, { approve: false, note: req.body?.note }, req.user, t), { audit: 'refund_reject' }));
router.post('/refunds/:id/pay', restrictTo(...DESK), handle('Could not pay the refund', (req, t) => B.payRefund(req.params.id, req.body || {}, req.user, t), { audit: 'refund_pay' }));
router.post('/refunds/:id/confirm', restrictTo(...DESK), handle('Could not confirm the refund', (req, t) => B.completeRefund(req.params.id, { outcome: 'confirmed', providerReference: req.body?.providerReference }, req.user, t), { audit: 'refund_confirm' }));
router.post('/refunds/:id/fail', restrictTo(...DESK), handle('Could not record the failed refund', (req, t) => B.completeRefund(req.params.id, { outcome: 'failed', reason: req.body?.reason }, req.user, t), { audit: 'refund_fail' }));

// Returned medicine waiting for its financial adjustment.
router.get('/medicine-returns', restrictTo(...DESK), handle('Could not list returns', (req, t) => B.pendingReturnCredits(t)));
router.post('/medicine-returns/:id/credit', restrictTo(...ADMIN), handle('Could not credit the return', (req, t) => B.creditReturn(req.params.id, req.user, t), { status: 201, audit: 'return_credit' }));

// ── Price list and packages ─────────────────────────────────
router.get('/charge-master', restrictTo(...WARD), handle('Could not load the price list', async (req, t) => {
  const versions = await rows('SELECT * FROM hms_charge_master_versions ORDER BY version DESC', {}, t);
  for (const v of versions) v.items = await rows('SELECT * FROM hms_charge_master_items WHERE version_id = :id ORDER BY category, code', { id: v.id }, t);
  return versions;
}));

// A new draft version starts as a copy of the active one.
router.post('/charge-master/versions', restrictTo(...ADMIN), handle('Could not start a new price list', async (req, t) => {
  const provenance = typeof req.body?.provenance === 'string' ? req.body.provenance.trim() : '';
  if (provenance.length < 5) B.fail(400, 'Say where the new prices come from (at least 5 characters).');
  if (await one("SELECT id FROM hms_charge_master_versions WHERE status = 'Draft'", {}, t)) B.fail(409, 'A draft price list already exists.');
  const v = await one(`INSERT INTO hms_charge_master_versions (version, provenance, created_by)
    SELECT COALESCE(max(version), 0) + 1, :provenance, :user FROM hms_charge_master_versions RETURNING *`, { provenance, user: req.user.id }, t);
  await sequelize.query(`INSERT INTO hms_charge_master_items (version_id, code, name, category, unit_price, gst_rate, doctor_id, ward_type, match_name)
    SELECT :v, i.code, i.name, i.category, i.unit_price, i.gst_rate, i.doctor_id, i.ward_type, i.match_name
    FROM hms_charge_master_items i JOIN hms_charge_master_versions a ON a.id = i.version_id WHERE a.status = 'Active'`,
  { replacements: { v: v.id }, transaction: t });
  return v;
}, { status: 201, audit: 'charge_master_draft' }));

router.put('/charge-master/versions/:id/items/:code', restrictTo(...ADMIN), handle('Could not save the price', async (req, t) => {
  const v = await one("SELECT * FROM hms_charge_master_versions WHERE id::text = :id AND status = 'Draft' FOR UPDATE", { id: String(req.params.id) }, t);
  if (!v) B.fail(409, 'Only a draft price list can be edited.');
  const b = req.body || {};
  const price = Number(b.unitPrice);
  if (!(price >= 0) || !b.name || !['Consultation', 'Lab', 'Medicine', 'Ward', 'Procedure', 'Service'].includes(b.category)) {
    B.fail(400, 'Give a name, a category and a price of zero or more.');
  }
  return one(`INSERT INTO hms_charge_master_items (version_id, code, name, category, unit_price, gst_rate, doctor_id, ward_type, match_name)
    VALUES (:v, :code, :name, :category, :price, :gst, :doctor, :ward, :match)
    ON CONFLICT (version_id, code) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, unit_price = EXCLUDED.unit_price,
      gst_rate = EXCLUDED.gst_rate, doctor_id = EXCLUDED.doctor_id, ward_type = EXCLUDED.ward_type, match_name = EXCLUDED.match_name
    RETURNING *`, {
    v: v.id, code: req.params.code, name: String(b.name).slice(0, 200), category: b.category, price: money(price),
    gst: Number(b.gstRate || 0), doctor: Number(b.doctorId) || null, ward: b.wardType || null, match: b.matchName || null,
  }, t);
}, { audit: 'charge_master_item' }));

router.post('/charge-master/versions/:id/activate', restrictTo(...ADMIN), handle('Could not activate the price list', async (req, t) => {
  const v = await one("SELECT * FROM hms_charge_master_versions WHERE id::text = :id AND status = 'Draft' FOR UPDATE", { id: String(req.params.id) }, t);
  if (!v) B.fail(409, 'Only a draft price list can be activated.');
  await sequelize.query("UPDATE hms_charge_master_versions SET status = 'Retired', retired_at = now() WHERE status = 'Active'", { transaction: t });
  return one(`UPDATE hms_charge_master_versions SET status = 'Active', activated_by = :user, activated_at = now() WHERE id = :id RETURNING *`, { id: v.id, user: req.user.id }, t);
}, { audit: 'charge_master_activate' }));

router.get('/packages', restrictTo(...DESK), handle('Could not load packages', async (req, t) => {
  const list = await rows(`SELECT p.*, pv.id AS version_id, pv.version, pv.price, pv.gst_rate, pv.status, pv.provenance
    FROM hms_packages p JOIN hms_package_versions pv ON pv.package_id = p.id ORDER BY p.code, pv.version DESC`, {}, t);
  for (const p of list) p.rules = await rows('SELECT * FROM hms_package_rules WHERE version_id = :id ORDER BY rule, category, code', { id: p.version_id }, t);
  return list;
}));

// A package and its first version (Draft), with its rules.
router.post('/packages', restrictTo(...ADMIN), handle('Could not create the package', async (req, t) => {
  const b = req.body || {};
  if (!/^[A-Za-z0-9:_.-]{1,60}$/.test(String(b.code || '')) || !b.name) B.fail(400, 'Give the package a code and a name.');
  if (!(Number(b.price) >= 0)) B.fail(400, 'Give the package price.');
  if (typeof b.provenance !== 'string' || b.provenance.trim().length < 5) B.fail(400, 'Say where the package terms come from.');
  if (!Array.isArray(b.rules) || !b.rules.length) B.fail(400, 'A package needs at least one inclusion rule.');
  const existing = await one('SELECT id FROM hms_packages WHERE code = :code', { code: b.code }, t);
  const pkg = existing || await one('INSERT INTO hms_packages (code, name, created_by) VALUES (:code, :name, :user) RETURNING *', { code: b.code, name: String(b.name).slice(0, 200), user: req.user.id }, t);
  if (await one("SELECT id FROM hms_package_versions WHERE package_id = :p AND status = 'Draft'", { p: pkg.id }, t)) B.fail(409, 'This package already has a draft version.');
  const v = await one(`INSERT INTO hms_package_versions (package_id, version, price, gst_rate, provenance, created_by)
    SELECT :p, COALESCE(max(version), 0) + 1, :price, :gst, :provenance, :user FROM hms_package_versions WHERE package_id = :p RETURNING *`,
  { p: pkg.id, price: money(b.price), gst: Number(b.gstRate || 0), provenance: b.provenance.trim(), user: req.user.id }, t);
  for (const r of b.rules) {
    await sequelize.query(`INSERT INTO hms_package_rules (version_id, rule, category, code, allowance_quantity, allowance_amount)
      VALUES (:v, :rule, :category, :code, :qty, :amount)`, { replacements: {
      v: v.id, rule: r.rule, category: r.category, code: r.code || null,
      qty: r.allowanceQuantity != null ? Number(r.allowanceQuantity) : null, amount: r.allowanceAmount != null ? money(r.allowanceAmount) : null,
    }, transaction: t });
  }
  return { ...pkg, version: v };
}, { status: 201, audit: 'package_create' }));

router.post('/packages/versions/:id/activate', restrictTo(...ADMIN), handle('Could not activate the package', async (req, t) => {
  const v = await one("SELECT * FROM hms_package_versions WHERE id::text = :id AND status = 'Draft' FOR UPDATE", { id: String(req.params.id) }, t);
  if (!v) B.fail(409, 'Only a draft package version can be activated.');
  await sequelize.query("UPDATE hms_package_versions SET status = 'Retired' WHERE package_id = :p AND status = 'Active'", { replacements: { p: v.package_id }, transaction: t });
  return one(`UPDATE hms_package_versions SET status = 'Active', activated_by = :user, activated_at = now() WHERE id = :id RETURNING *`, { id: v.id, user: req.user.id }, t);
}, { audit: 'package_activate' }));

// ── Insurance ───────────────────────────────────────────────
router.get('/payers', restrictTo(...DESK), handle('Could not load payers', (req, t) => rows('SELECT * FROM hms_payers ORDER BY name', {}, t)));
router.post('/payers', restrictTo(...ADMIN), handle('Could not add the payer', (req, t) => INS.createPayer(req.body || {}, req.user, t), { status: 201, audit: 'payer_create' }));
router.get('/coverages', restrictTo(...DESK), handle('Could not load coverage', (req, t) => rows(`SELECT c.*, p.name AS payer_name,
    (SELECT row_to_json(e) FROM (SELECT outcome, checked_at, response_reference FROM hms_eligibility_checks WHERE coverage_id = c.id ORDER BY checked_at DESC LIMIT 1) e) AS last_eligibility
    FROM hms_coverages c JOIN hms_payers p ON p.id = c.payer_id WHERE c.patient_id = :pid ORDER BY c.created_at DESC`, { pid: Number(req.query.patientId) || 0 }, t)));
router.post('/coverages', restrictTo(...DESK), handle('Could not add the coverage', (req, t) => INS.createCoverage(req.body || {}, req.user, t), { status: 201, audit: 'coverage_create' }));
router.post('/coverages/:id/eligibility', restrictTo(...DESK), handle('Could not record eligibility', (req, t) => INS.recordEligibility(req.params.id, req.body || {}, req.user, t), { status: 201, audit: 'eligibility' }));
router.get('/accounts/:id/preauthorizations', restrictTo(...DESK), handle('Could not load pre-authorisations', async (req, t) => {
  const list = await rows('SELECT * FROM hms_preauthorizations WHERE account_id::text = :id ORDER BY requested_at', { id: String(req.params.id) }, t);
  for (const pa of list) pa.revisions = await rows('SELECT * FROM hms_preauth_revisions WHERE preauth_id = :id ORDER BY revision', { id: pa.id }, t);
  return list;
}));
router.post('/accounts/:id/preauthorizations', restrictTo(...DESK), handle('Could not request pre-authorisation', (req, t) => INS.requestPreauth(req.params.id, req.body || {}, req.user, t), { status: 201, audit: 'preauth_request' }));
router.post('/preauthorizations/:id/decision', restrictTo(...DESK), handle('Could not record the decision', (req, t) => INS.decidePreauth(req.params.id, req.body || {}, req.user, t), { audit: 'preauth_decision' }));
router.put('/accounts/:id/payer', restrictTo(...DESK), handle('Could not set the payer', (req, t) => INS.setAccountPayer(req.params.id, req.body || {}, req.user, t), { audit: 'account_payer' }));
router.post('/invoices/:id/claim', restrictTo(...DESK), handle('Could not prepare the claim', (req, t) => INS.createClaim(req.params.id, req.user, t), { status: 201, audit: 'claim_create' }));
router.get('/claims', restrictTo(...DESK), handle('Could not list claims', (req, t) => rows(`SELECT c.*, i.invoice_number, p.name AS patient_name, p.uhid, py.name AS payer_name,
    (SELECT COALESCE(sum(amount), 0) FROM hms_remittances r WHERE r.claim_id = c.id) AS paid_amount
    FROM hms_claims c JOIN hms_invoices i ON i.id = c.invoice_id JOIN hms_patients p ON p.id = i.patient_id
    JOIN hms_coverages cv ON cv.id = c.coverage_id JOIN hms_payers py ON py.id = cv.payer_id
    WHERE (CAST(:status AS text) IS NULL OR c.status = :status) ORDER BY c.created_at DESC LIMIT 200`, { status: req.query.status || null }, t)));
router.get('/claims/:id', restrictTo(...DESK), handle('Could not load the claim', async (req, t) => {
  const c = await one('SELECT * FROM hms_claims WHERE id::text = :id', { id: String(req.params.id) }, t);
  if (!c) return null;
  c.lines = await rows(`SELECT cl.*, l.description, l.category FROM hms_claim_lines cl JOIN hms_invoice_lines l ON l.id = cl.invoice_line_id
    WHERE cl.claim_id = :id ORDER BY l.line_no`, { id: c.id }, t);
  c.remittances = await rows('SELECT * FROM hms_remittances WHERE claim_id = :id ORDER BY received_at', { id: c.id }, t);
  c.denials = await rows('SELECT * FROM hms_denials WHERE claim_id = :id ORDER BY created_at', { id: c.id }, t);
  return c;
}));
router.post('/claims/:id/submit', restrictTo(...DESK), handle('Could not submit the claim', (req, t) => INS.moveClaim(req.params.id, 'Submitted', req.body || {}, req.user, t), { audit: 'claim_submit' }));
router.post('/claims/:id/acknowledge', restrictTo(...DESK), handle('Could not record the acknowledgement', (req, t) => INS.moveClaim(req.params.id, 'Acknowledged', req.body || {}, req.user, t), { audit: 'claim_ack' }));
router.post('/claims/:id/adjudication', restrictTo(...DESK), handle('Could not record the adjudication', (req, t) => INS.adjudicateClaim(req.params.id, req.body || {}, req.user, t), { audit: 'claim_adjudicate' }));
router.post('/claims/:id/remittances', restrictTo(...DESK), handle('Could not record the remittance', (req, t) => INS.recordRemittance(req.params.id, req.body || {}, req.user, t), { status: 201, audit: 'remittance' }));
router.get('/denials', restrictTo(...DESK), handle('Could not list denials', (req, t) => rows(`SELECT d.*, c.claim_number, p.name AS patient_name, u.name AS owner_name
    FROM hms_denials d JOIN hms_claims c ON c.id = d.claim_id JOIN hms_invoices i ON i.id = c.invoice_id JOIN hms_patients p ON p.id = i.patient_id
    LEFT JOIN hms_users u ON u.id = d.owner_user_id
    WHERE (CAST(:status AS text) IS NULL OR d.status = :status) ORDER BY d.created_at`, { status: req.query.status || null }, t)));
router.post('/denials/:id/resolve', restrictTo(...DESK), handle('Could not resolve the denial', (req, t) => INS.resolveDenial(req.params.id, req.body || {}, req.user, t), { audit: 'denial_resolve' }));

// ── Reconciliation ──────────────────────────────────────────
router.get('/cash-sessions/current', restrictTo(...DESK), handle('Could not load the cash drawer', async (req, t) => {
  const s = await one("SELECT id FROM hms_cash_sessions WHERE cashier_user_id = :u AND status = 'Open'", { u: req.user.id }, t);
  return s ? R.sessionView(s.id, t) : { open: false };
}));
router.get('/cash-sessions', restrictTo(...ADMIN), handle('Could not list cash drawers', (req, t) => rows(`SELECT s.*, u.name AS cashier_name FROM hms_cash_sessions s
    JOIN hms_users u ON u.id = s.cashier_user_id ORDER BY s.opened_at DESC LIMIT 100`, {}, t)));
router.post('/cash-sessions', restrictTo(...DESK), handle('Could not open the cash drawer', (req, t) => R.openSession(req.body || {}, req.user, t), { status: 201, audit: 'cash_open' }));
router.post('/cash-sessions/:id/close', restrictTo(...DESK), handle('Could not close the cash drawer', (req, t) => R.closeSession(req.params.id, req.body || {}, req.user, t), { audit: 'cash_close' }));
router.post('/settlements', restrictTo(...ADMIN), handle('Could not record the settlement', (req, t) => R.recordSettlement(req.body || {}, req.user, t), { status: 201, audit: 'settlement' }));
router.get('/settlements', restrictTo(...ADMIN), handle('Could not list settlements', (req, t) => rows('SELECT * FROM hms_settlements ORDER BY recorded_at DESC LIMIT 200', {}, t)));
router.post('/reconciliation/run', restrictTo(...ADMIN), handle('Could not run reconciliation', (req, t) => R.runChecks(t), { audit: 'reconciliation_run' }));
router.get('/reconciliation/exceptions', restrictTo(...ADMIN), handle('Could not list exceptions', (req, t) => rows(`SELECT e.*, u.name AS owner_name, r.name AS resolved_by_name
    FROM hms_recon_exceptions e LEFT JOIN hms_users u ON u.id = e.owner_user_id LEFT JOIN hms_users r ON r.id = e.resolved_by
    WHERE (CAST(:status AS text) IS NULL OR e.status = :status) ORDER BY e.opened_at DESC LIMIT 500`, { status: req.query.status || null }, t)));
router.post('/reconciliation/exceptions/:id/resolve', restrictTo(...ADMIN), handle('Could not resolve the exception', (req, t) => R.resolveException(req.params.id, req.body || {}, req.user, t), { audit: 'exception_resolve' }));
router.put('/reconciliation/exceptions/:id/owner', restrictTo(...ADMIN), handle('Could not assign the exception', (req, t) => R.assignException(req.params.id, req.body?.ownerUserId, t), { audit: 'exception_assign' }));

// Journal entries of an account, for the account page and audits.
router.get('/accounts/:id/journal', restrictTo(...ADMIN), handle('Could not load the journal', async (req, t) => {
  const entries = await rows('SELECT * FROM hms_journal_entries WHERE account_id::text = :id ORDER BY entry_no', { id: String(req.params.id) }, t);
  for (const e of entries) e.lines = await rows('SELECT gl_code, debit, credit FROM hms_journal_lines WHERE entry_id = :id ORDER BY id', { id: e.id }, t);
  return entries;
}));

module.exports = router;
