// Insurance (Phase 5, migration 0075): payers, coverage, eligibility,
// pre-authorisation, the payer's share of an account, claims, remittance and
// denials. Insurer authorisation is not payment: an approved pre-authorisation
// only caps the payer's share; money arrives as a remittance.
const B = require('./billing');

const { fail, rows, one, run, money, post } = B;
const text = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isoDate = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null);

async function createPayer({ code, name, kind }, user, t) {
  if (!B.isAdmin(user)) fail(403, 'Payers are set up by an administrator.');
  if (!/^[A-Za-z0-9:_.-]{1,40}$/.test(String(code || ''))) fail(400, 'Payer code: letters, digits and : _ . - (up to 40).');
  if (!text(name)) fail(400, 'Payer name is required.');
  if (!['insurer', 'tpa', 'government', 'corporate'].includes(kind)) fail(400, 'Payer kind must be insurer, tpa, government or corporate.');
  return one(`INSERT INTO hms_payers (code, name, kind, created_by) VALUES (:code, :name, :kind, :user) RETURNING *`,
    { code, name: text(name), kind, user: user.id }, t);
}

async function createCoverage(body, user, t) {
  const patientId = Number(body.patientId);
  if (!Number.isInteger(patientId) || !(await one('SELECT id FROM hms_patients WHERE id = :id', { id: patientId }, t))) fail(404, 'Patient not found.');
  const payer = await one('SELECT * FROM hms_payers WHERE id::text = :id AND is_active', { id: String(body.payerId || '') }, t);
  if (!payer) fail(404, 'Payer not found.');
  const from = isoDate(body.validFrom); const to = isoDate(body.validTo);
  if (!text(body.policyNumber, 60) || !text(body.memberId, 60)) fail(400, 'Policy number and member ID are required.');
  if (!from || !to || to < from) fail(400, 'Give the policy dates (valid to on or after valid from).');
  return one(`INSERT INTO hms_coverages (patient_id, payer_id, policy_number, member_id, plan_name, valid_from, valid_to, created_by)
    VALUES (:pid, :payer, :policy, :member, :plan, :from, :to, :user) RETURNING *`, {
    pid: patientId, payer: payer.id, policy: text(body.policyNumber, 60), member: text(body.memberId, 60), plan: text(body.planName),
    from, to, user: user.id,
  }, t);
}

async function lockCoverage(id, t) {
  const c = await one('SELECT * FROM hms_coverages WHERE id::text = :id FOR UPDATE', { id: String(id || '') }, t);
  if (!c) fail(404, 'Coverage not found.');
  return c;
}

// The payer's answer to an eligibility check, as staff received it.
async function recordEligibility(coverageId, body, user, t) {
  const cov = await lockCoverage(coverageId, t);
  if (!['Eligible', 'NotEligible', 'Unknown'].includes(body.outcome)) fail(400, 'Outcome must be Eligible, NotEligible or Unknown.');
  let accountId = null;
  if (body.accountId) {
    const acc = await one('SELECT id, patient_id FROM hms_billing_accounts WHERE id::text = :id', { id: String(body.accountId) }, t);
    if (!acc || acc.patient_id !== cov.patient_id) fail(400, 'The account belongs to another patient.');
    accountId = acc.id;
  }
  return one(`INSERT INTO hms_eligibility_checks (coverage_id, account_id, outcome, response_reference, notes, checked_by)
    VALUES (:cov, :acc, :outcome, :ref, :notes, :user) RETURNING *`,
  { cov: cov.id, acc: accountId, outcome: body.outcome, ref: text(body.responseReference, 100), notes: text(body.notes, 1000), user: user.id }, t);
}

async function requestPreauth(accountId, { coverageId, requestedAmount, note }, user, t) {
  const acc = await B.lockAccount(accountId, t);
  const cov = await lockCoverage(coverageId, t);
  if (cov.patient_id !== acc.patient_id) fail(400, 'The coverage belongs to another patient.');
  if (cov.status !== 'Active') fail(409, 'This coverage is not active.');
  const amount = money(requestedAmount);
  if (!(amount > 0)) fail(400, 'Enter the amount requested.');
  const pa = await one(`INSERT INTO hms_preauthorizations (account_id, coverage_id, requested_amount, requested_by)
    VALUES (:acc, :cov, :amount, :user) RETURNING *`, { acc: acc.id, cov: cov.id, amount, user: user.id }, t);
  await run(`INSERT INTO hms_preauth_revisions (preauth_id, revision, status, requested_amount, approved_amount, note, recorded_by)
    VALUES (:id, 1, 'Requested', :amount, 0, :note, :user)`, { id: pa.id, amount, note: text(note, 1000), user: user.id }, t);
  return pa;
}

// Record the payer's decision or an enhancement. Each is a new revision.
async function decidePreauth(preauthId, body, user, t) {
  const first = await one('SELECT account_id FROM hms_preauthorizations WHERE id::text = :id', { id: String(preauthId) }, t);
  if (!first) fail(404, 'Pre-authorisation not found.');
  await B.lockAccount(first.account_id, t);
  const pa = await one('SELECT * FROM hms_preauthorizations WHERE id::text = :id FOR UPDATE', { id: String(preauthId) }, t);
  if (pa.status === 'Cancelled') fail(409, 'This pre-authorisation is cancelled.');
  const status = body.status;
  if (!['Approved', 'PartiallyApproved', 'Denied', 'Cancelled', 'Requested'].includes(status)) fail(400, 'Status must be Approved, PartiallyApproved, Denied, Cancelled or Requested (enhancement).');
  const requested = body.requestedAmount != null ? money(body.requestedAmount) : money(pa.requested_amount);
  const approved = ['Approved', 'PartiallyApproved'].includes(status) ? money(body.approvedAmount) : 0;
  if (!(requested > 0)) fail(400, 'Requested amount must be positive.');
  if (status === 'Approved' && !(approved > 0)) fail(400, 'Enter the approved amount.');
  if (status === 'PartiallyApproved' && !(approved > 0 && approved < requested)) fail(400, 'A partial approval is more than zero and less than the amount requested.');
  if (status === 'Approved' && approved > requested) fail(400, 'Approved amount cannot exceed the amount requested.');
  if (['Approved', 'PartiallyApproved', 'Denied'].includes(status) && !text(body.payerReference, 100)) fail(400, "Enter the payer's reference for the decision.");
  // The approved limit cannot fall below what invoices already put on the payer.
  const used = await one(`SELECT COALESCE(sum(payer_amount), 0) AS used FROM hms_invoices WHERE account_id = :acc AND status NOT IN ('Draft', 'Void')`, { acc: pa.account_id }, t);
  if (money(used.used) > approved && (await one('SELECT 1 AS x FROM hms_account_payers WHERE preauth_id = :id', { id: pa.id }, t))) {
    fail(409, `Invoices already bill Rs. ${money(used.used).toFixed(2)} to the payer; the approval cannot be lower. Correct those invoices with credit notes first.`);
  }
  const updated = await one(`UPDATE hms_preauthorizations SET status = :status, requested_amount = :requested, approved_amount = :approved,
      payer_reference = COALESCE(:ref, payer_reference), valid_until = COALESCE(CAST(:until AS date), valid_until), revision = revision + 1
    WHERE id = :id RETURNING *`,
  { id: pa.id, status, requested, approved, ref: text(body.payerReference, 100), until: isoDate(body.validUntil) }, t);
  await run(`INSERT INTO hms_preauth_revisions (preauth_id, revision, status, requested_amount, approved_amount, payer_reference, note, recorded_by)
    VALUES (:id, :rev, :status, :requested, :approved, :ref, :note, :user)`, {
    id: pa.id, rev: updated.revision, status, requested, approved, ref: text(body.payerReference, 100), note: text(body.note, 1000), user: user.id,
  }, t);
  await B.refreshDraft(pa.account_id, user, t);
  return updated;
}

// Name the payer responsible for part of the account's bills.
async function setAccountPayer(accountId, { coverageId, preauthId, copayPercent }, user, t) {
  const acc = await B.lockAccount(accountId, t);
  const cov = await lockCoverage(coverageId, t);
  if (cov.patient_id !== acc.patient_id) fail(400, 'The coverage belongs to another patient.');
  const pa = await one('SELECT * FROM hms_preauthorizations WHERE id::text = :id AND account_id = :acc', { id: String(preauthId || ''), acc: acc.id }, t);
  if (!pa || pa.coverage_id !== cov.id) fail(400, 'Choose a pre-authorisation of this account under this coverage.');
  const copay = Number(copayPercent ?? 0);
  if (!(copay >= 0 && copay <= 100)) fail(400, 'Co-pay is a percentage from 0 to 100.');
  const issued = await one(`SELECT count(*)::int AS n FROM hms_invoices WHERE account_id = :acc AND status NOT IN ('Draft', 'Void') AND payer_amount > 0`, { acc: acc.id }, t);
  if (issued.n > 0) fail(409, 'Invoices on this account already bill the payer; the payer cannot be changed now.');
  const row = await one(`INSERT INTO hms_account_payers (account_id, coverage_id, preauth_id, copay_percent, set_by) VALUES (:acc, :cov, :pa, :copay, :user)
    ON CONFLICT (account_id) DO UPDATE SET coverage_id = EXCLUDED.coverage_id, preauth_id = EXCLUDED.preauth_id,
      copay_percent = EXCLUDED.copay_percent, set_by = EXCLUDED.set_by, set_at = now() RETURNING *`,
  { acc: acc.id, cov: cov.id, pa: pa.id, copay, user: user.id }, t);
  await B.refreshDraft(acc.id, user, t);
  return row;
}

// ── Claims ──────────────────────────────────────────────────
// A claim for the payer's share of an issued invoice, spread over its lines
// in proportion (the last line takes the rounding).
async function createClaim(invoiceId, user, t) {
  const first = await one('SELECT account_id FROM hms_invoices WHERE id::text = :id', { id: String(invoiceId) }, t);
  if (!first) fail(404, 'Invoice not found.');
  await B.lockAccount(first.account_id, t);
  const inv = await B.lockInvoice(invoiceId, t);
  if (['Draft', 'Void'].includes(inv.status)) fail(409, 'Claims are made for an issued invoice.');
  if (!(Number(inv.payer_amount) > 0)) fail(409, 'Nothing on this invoice is billed to a payer.');
  if (await one('SELECT id FROM hms_claims WHERE invoice_id = :id', { id: inv.id }, t)) fail(409, 'This invoice already has a claim.', 'CLAIM_EXISTS');
  const ap = await one('SELECT * FROM hms_account_payers WHERE account_id = :acc', { acc: inv.account_id }, t);
  if (!ap) fail(409, 'The account has no payer.');
  const credits = await one(`SELECT COALESCE(sum(payer_amount) FILTER (WHERE kind = 'credit'), 0) - COALESCE(sum(payer_amount) FILTER (WHERE kind = 'debit'), 0) AS net
    FROM hms_invoice_notes WHERE invoice_id = :id`, { id: inv.id }, t);
  const claimed = money(Number(inv.payer_amount) - Number(credits.net));
  if (!(claimed > 0)) fail(409, "Credit notes have removed the payer's share.");
  const number = `CLM-${new Date().getFullYear()}-${String((await one("SELECT nextval('hms_claim_seq') AS n", {}, t)).n).padStart(6, '0')}`;
  const claim = await one(`INSERT INTO hms_claims (claim_number, invoice_id, coverage_id, preauth_id, claimed_amount, created_by)
    VALUES (:number, :inv, :cov, :pa, :amount, :user) RETURNING *`,
  { number, inv: inv.id, cov: ap.coverage_id, pa: ap.preauth_id, amount: claimed, user: user.id }, t);
  const lines = (await rows('SELECT id, amount, gst_amount FROM hms_invoice_lines WHERE invoice_id = :id ORDER BY line_no', { id: inv.id }, t))
    .filter((l) => Number(l.amount) + Number(l.gst_amount) > 0);
  const base = lines.reduce((s, l) => s + Number(l.amount) + Number(l.gst_amount), 0);
  let left = claimed;
  for (let i = 0; i < lines.length; i += 1) {
    const share = i === lines.length - 1 ? left : money(claimed * (Number(lines[i].amount) + Number(lines[i].gst_amount)) / base);
    left = money(left - share);
    await run('INSERT INTO hms_claim_lines (claim_id, invoice_line_id, claimed_amount) VALUES (:claim, :line, :amount)', { claim: claim.id, line: lines[i].id, amount: share }, t);
  }
  return claim;
}

async function lockClaim(claimId, t) {
  const c = await one('SELECT * FROM hms_claims WHERE id::text = :id FOR UPDATE', { id: String(claimId) }, t);
  if (!c) fail(404, 'Claim not found.');
  return c;
}

async function moveClaim(claimId, to, { payerReference } = {}, user, t) {
  const c = await lockClaim(claimId, t);
  const allowed = { Submitted: ['Prepared'], Acknowledged: ['Submitted'] };
  if (!allowed[to] || !allowed[to].includes(c.status)) fail(409, `A ${c.status.toLowerCase()} claim cannot be marked ${to.toLowerCase()}.`, 'CLAIM_STATE');
  return one(`UPDATE hms_claims SET status = :to, payer_reference = COALESCE(:ref, payer_reference),
      submitted_at = CASE WHEN :to = 'Submitted' THEN now() ELSE submitted_at END,
      acknowledged_at = CASE WHEN :to = 'Acknowledged' THEN now() ELSE acknowledged_at END
    WHERE id = :id RETURNING *`, { id: c.id, to, ref: text(payerReference, 100) }, t);
}

// The payer's adjudication, line by line. Denied amounts open denials.
async function adjudicateClaim(claimId, { lines }, user, t) {
  const c = await lockClaim(claimId, t);
  if (!['Submitted', 'Acknowledged'].includes(c.status)) fail(409, 'Only a submitted claim can be adjudicated.', 'CLAIM_STATE');
  const claimLines = await rows('SELECT * FROM hms_claim_lines WHERE claim_id = :id', { id: c.id }, t);
  if (!Array.isArray(lines)) fail(400, 'Give the adjudication for each claim line.');
  let approved = 0; let denied = 0;
  for (const cl of claimLines) {
    const a = lines.find((x) => x.claimLineId === cl.id) || {};
    const ok = money(a.approvedAmount ?? cl.claimed_amount);
    const no = money(Number(cl.claimed_amount) - ok);
    if (ok < 0 || no < 0) fail(400, 'Approved amount on a line must be between zero and what was claimed.');
    if (no > 0 && !text(a.denialReason, 500)) fail(400, 'Give the payer\'s reason for each denied amount.');
    await run(`UPDATE hms_claim_lines SET approved_amount = :ok, denied_amount = :no, denial_code = :code, denial_reason = :reason WHERE id = :id`,
      { id: cl.id, ok, no, code: no > 0 ? text(a.denialCode, 40) : null, reason: no > 0 ? text(a.denialReason, 500) : null }, t);
    if (no > 0) {
      await run(`INSERT INTO hms_denials (claim_id, claim_line_id, amount, code, reason, owner_user_id) VALUES (:claim, :line, :amount, :code, :reason, :user)`,
        { claim: c.id, line: cl.id, amount: no, code: text(a.denialCode, 40), reason: text(a.denialReason, 500), user: user.id }, t);
    }
    approved += ok; denied += no;
  }
  return one(`UPDATE hms_claims SET status = 'Adjudicated', approved_amount = :ok, denied_amount = :no, adjudicated_at = now()
    WHERE id = :id RETURNING *`, { id: c.id, ok: money(approved), no: money(denied) }, t);
}

// Money from the payer for a claim; settles the claim once all approved
// amounts (and recovered denials) are paid.
async function recordRemittance(claimId, { remittanceReference, amount }, user, t) {
  const c = await lockClaim(claimId, t);
  if (!['Adjudicated', 'Appealed'].includes(c.status)) fail(409, 'A remittance is recorded against an adjudicated claim.', 'CLAIM_STATE');
  const ref = text(remittanceReference, 100);
  const value = money(amount);
  if (!ref) fail(400, 'Enter the remittance reference.');
  if (!(value > 0)) fail(400, 'Enter the amount received.');
  const cov = await one('SELECT payer_id, patient_id FROM hms_coverages WHERE id = :id', { id: c.coverage_id }, t);
  const dup = await one('SELECT claim_id FROM hms_remittances WHERE payer_id = :payer AND remittance_reference = :ref', { payer: cov.payer_id, ref }, t);
  if (dup) fail(409, 'That remittance reference is already recorded.', 'DUPLICATE_REMITTANCE');
  const recovered = await one(`SELECT COALESCE(sum(amount), 0) AS v FROM hms_denials WHERE claim_id = :id AND status = 'Recovered'`, { id: c.id }, t);
  const paid = await one('SELECT COALESCE(sum(amount), 0) AS v FROM hms_remittances WHERE claim_id = :id', { id: c.id }, t);
  const payable = money(Number(c.approved_amount) + Number(recovered.v) - Number(paid.v));
  if (value > payable + 0.001) fail(400, `Only Rs. ${payable.toFixed(2)} is approved and unpaid on this claim.`, 'MORE_THAN_APPROVED');
  const rem = await one(`INSERT INTO hms_remittances (claim_id, payer_id, remittance_reference, amount, recorded_by)
    VALUES (:claim, :payer, :ref, :amount, :user) RETURNING *`, { claim: c.id, payer: cov.payer_id, ref, amount: value, user: user.id }, t);
  const inv = await one('SELECT account_id, invoice_number FROM hms_invoices WHERE id = :id', { id: c.invoice_id }, t);
  await post(t, { sourceType: 'remittance', sourceKey: rem.id, accountId: inv.account_id, patientId: cov.patient_id, user,
    memo: `Remittance ${ref} for claim ${c.claim_number}`, lines: [{ gl: '1020', debit: value }, { gl: '1110', credit: value }] });
  if (value >= payable - 0.001) {
    const openDenials = await one(`SELECT count(*)::int AS n FROM hms_denials WHERE claim_id = :id AND status IN ('Open', 'Appealed')`, { id: c.id }, t);
    if (!openDenials.n) await run(`UPDATE hms_claims SET status = 'Settled', closed_at = now() WHERE id = :id`, { id: c.id }, t);
  }
  return rem;
}

// Resolve a denial: appeal it, write it off, pass it to the patient, or (after
// an appeal) record that the payer will pay it after all.
async function resolveDenial(denialId, { action, note }, user, t) {
  const d0 = await one('SELECT * FROM hms_denials WHERE id::text = :id', { id: String(denialId) }, t);
  if (!d0) fail(404, 'Denial not found.');
  const c = await lockClaim(d0.claim_id, t);
  const inv0 = await one('SELECT account_id FROM hms_invoices WHERE id = :id', { id: c.invoice_id }, t);
  await B.lockAccount(inv0.account_id, t);
  const inv = await B.lockInvoice(c.invoice_id, t);
  const d = await one('SELECT * FROM hms_denials WHERE id = :id FOR UPDATE', { id: d0.id }, t);
  const why = text(note, 1000);
  if (!why || why.length < 5) fail(400, 'Record what was decided (at least 5 characters).');
  const next = { appeal: 'Appealed', write_off: 'WrittenOff', transfer: 'TransferredToPatient', recover: 'Recovered' }[action];
  if (!next) fail(400, 'Action must be appeal, write_off, transfer or recover.');
  const ok = (d.status === 'Open' && ['Appealed', 'WrittenOff', 'TransferredToPatient'].includes(next))
    || (d.status === 'Appealed' && ['Recovered', 'WrittenOff', 'TransferredToPatient'].includes(next));
  if (!ok) fail(409, `A ${d.status.toLowerCase()} denial cannot be ${next.toLowerCase()}.`, 'DENIAL_STATE');
  if (next !== 'Appealed' && !B.isAdmin(user)) fail(403, 'An administrator closes a denial.');
  const final = next !== 'Appealed';
  const updated = await one(`UPDATE hms_denials SET status = :next, resolution_note = :why,
      resolved_by = CASE WHEN :final THEN CAST(:user AS integer) END, resolved_at = CASE WHEN :final THEN now() END
    WHERE id = :id RETURNING *`, { id: d.id, next, why, final, user: user.id }, t);
  if (next === 'Appealed' && c.status === 'Adjudicated') await run(`UPDATE hms_claims SET status = 'Appealed' WHERE id = :id`, { id: c.id }, t);
  if (next === 'WrittenOff') {
    await post(t, { sourceType: 'denial_write_off', sourceKey: d.id, accountId: inv.account_id, patientId: inv.patient_id, user,
      memo: `Denial written off on claim ${c.claim_number}`, lines: [{ gl: '5900', debit: Number(d.amount) }, { gl: '1110', credit: Number(d.amount) }] });
  }
  if (next === 'TransferredToPatient') {
    // The patient now owes it: the payer's share moves to the patient by a
    // linked credit (payer) and debit (patient) note pair.
    await B.createNote(inv.id, { kind: 'credit', reason: `Denied by payer: ${d.reason}`, payerAmount: Number(d.amount),
      lines: [{ category: 'Service', description: `Denied by payer (${c.claim_number})`, amount: Number(d.amount), gstAmount: 0 }],
      sourceType: 'denial_payer', sourceKey: d.id }, user, t);
    await B.createNote(inv.id, { kind: 'debit', reason: `Payer denied; patient responsible: ${why}`, payerAmount: 0,
      lines: [{ category: 'Service', description: `Payer denial passed to patient (${c.claim_number})`, amount: Number(d.amount), gstAmount: 0 }],
      sourceType: 'denial_patient', sourceKey: d.id }, user, t);
  }
  // A claim with no open denials and nothing left to pay is closed.
  const open = await one(`SELECT count(*)::int AS n FROM hms_denials WHERE claim_id = :id AND status IN ('Open', 'Appealed')`, { id: c.id }, t);
  const paid = await one('SELECT COALESCE(sum(amount), 0) AS v FROM hms_remittances WHERE claim_id = :id', { id: c.id }, t);
  const recovered = await one(`SELECT COALESCE(sum(amount), 0) AS v FROM hms_denials WHERE claim_id = :id AND status = 'Recovered'`, { id: c.id }, t);
  const cur = await one('SELECT status, approved_amount FROM hms_claims WHERE id = :id', { id: c.id }, t);
  if (!open.n && ['Adjudicated', 'Appealed'].includes(cur.status)) {
    const unpaid = money(Number(cur.approved_amount) + Number(recovered.v) - Number(paid.v));
    if (unpaid <= 0) await run(`UPDATE hms_claims SET status = :s, closed_at = now() WHERE id = :id`, { id: c.id, s: Number(paid.v) > 0 ? 'Settled' : 'Denied' }, t);
  }
  return updated;
}

module.exports = {
  createPayer, createCoverage, recordEligibility, requestPreauth, decidePreauth, setAccountPayer,
  createClaim, moveClaim, adjudicateClaim, recordRemittance, resolveDenial,
};
