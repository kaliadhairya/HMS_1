const express = require('express');
const router = express.Router();
const { sequelize, Bill } = require('../models');
const { protect, checkPermission } = require('../middleware/auth');
const logAction = require('../utils/auditLogger');
const B = require('../services/billing');

// Phase 5: bills raised from now on are invoices of the episode's billing
// account (services/billing.js); hms_bills rows are their read projection.
// Bills raised before Phase 5 have no invoice and keep the old payment path.
const PAYMENT_METHOD = { Cash: 'Cash', Card: 'Card', UPI: 'UPI', Cheque: 'Cheque', Bank: 'BankTransfer', BankTransfer: 'BankTransfer', Online: 'UPI' };
function domainError(res, err, fallback) {
  const code = err.original?.code || err.parent?.code;
  if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  if (code === '55P03' || code === '40P01') return res.status(409).json({ success: false, code: 'BUSY', message: 'Someone else is changing this bill. Try again.' });
  if (code === '23514' || code === '23001' || code === '23505') return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
  console.error(`${fallback}:`, err.original?.message || err.message);
  return res.status(500).json({ success: false, message: fallback });
}
const invoiceForBill = (billId, t) => B.one('SELECT * FROM hms_invoices WHERE legacy_bill_id = :id', { id: Number(billId) || 0 }, t);

async function nextval(sequenceName, transaction) {
  const name = String(sequenceName).toLowerCase();
  try {
    const [[row]] = await sequelize.query(
      `SELECT nextval('${name}') AS "NEXTVAL"`,
      { transaction }
    );
    return row?.NEXTVAL ?? row?.nextval;
  } catch (err) {
    if (name.includes('advance')) {
      const alt = name === 'hms_advances_seq' ? 'hms_patient_advances_seq' : 'hms_advances_seq';
      const [[row]] = await sequelize.query(
        `SELECT nextval('${alt}') AS "NEXTVAL"`,
        { transaction }
      );
      return row?.NEXTVAL ?? row?.nextval;
    }
    throw err;
  }
}

// ── GET /api/billing/opd/unpaid-today ────────────────────────
router.get('/opd/unpaid-today', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT e.ID as ENCOUNTER_ID, p.NAME, p.UHID, e.ENCOUNTER_DATE, u.NAME as DOCTOR_NAME
      FROM HMS_ENCOUNTERS e
      JOIN HMS_PATIENTS p ON p.ID = e.PATIENT_ID
      JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
      WHERE trunc(e.ENCOUNTER_DATE) = trunc(CURRENT_TIMESTAMP)
      AND e.STATUS = 'Finalized'
      AND NOT EXISTS (SELECT 1 FROM HMS_BILLS b WHERE b.ENCOUNTER_ID = e.ID)
      ORDER BY e.ENCOUNTER_DATE DESC
    `);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch unpaid encounters' });
  }
});

// ── GET /api/billing/advance/:patientId ──────────────────────
// Deposits (advances) of a patient: everything taken, what is still unused.
router.get('/advance/:patientId', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const patientId = Number(req.params.patientId) || 0;
    const [[sums]] = await sequelize.query(`
      SELECT COALESCE(sum(f.amount), 0) AS total, COALESCE(sum(GREATEST(0, billing_fund_balance(f.id))), 0) AS available
        FROM hms_patient_funds f WHERE f.patient_id = :patientId AND f.kind = 'deposit'`, { replacements: { patientId } });
    // Advances used up before Phase 5 are history only.
    const [[old]] = await sequelize.query(`
      SELECT COALESCE(sum(amount), 0) AS used FROM hms_patient_advances
       WHERE patient_id = :patientId AND (adjusted_bill_id IS NOT NULL OR COALESCE(is_refunded, 0) = 1)`, { replacements: { patientId } });
    const totalAdvance = B.money(Number(sums.total) + Number(old.used));
    const availableAdvance = B.money(sums.available);
    res.json({ success: true, data: { totalAdvance, adjusted: B.money(totalAdvance - availableAdvance), availableAdvance } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch advances' });
  }
});

// ── POST /api/billing/advance ──────────────────────────────
// A deposit: money held for the patient until applied to an invoice or refunded.
router.post('/advance', protect, checkPermission('billing', 'write'), async (req, res) => {
  try {
    const { patientId, admissionId, paymentMode = 'Cash', notes, referenceNumber } = req.body || {};
    const amount = Number(req.body?.amount);
    if (!patientId || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid Patient ID and Amount required' });
    }
    const result = await sequelize.transaction(async (t) => {
      const patient = await B.one('SELECT id FROM hms_patients WHERE id = :id', { id: Number(patientId) || 0 }, t);
      if (!patient) B.fail(404, 'Patient not found');
      let accountId = null;
      if (admissionId) {
        const admission = await B.one('SELECT patient_id FROM hms_admissions WHERE id = :id', { id: Number(admissionId) || 0 }, t);
        if (!admission || Number(admission.patient_id) !== Number(patient.id)) B.fail(400, 'The admission does not belong to this patient');
        accountId = await B.accountFor({ admissionId: Number(admissionId) }, t);
      }
      const { intent, receipt } = await B.startPayment({
        patientId: patient.id, accountId, amount, method: PAYMENT_METHOD[paymentMode] || paymentMode,
        providerReference: referenceNumber, notes,
      }, req.user, t);
      const fund = await B.one('SELECT * FROM hms_patient_funds WHERE receipt_id = :r', { r: receipt.id }, t);
      return { id: fund.id, patientId: patient.id, admissionId: admissionId || null, amount: B.money(fund.amount), paymentMode: intent.method,
        receiptNumber: receipt.receipt_number, receivedAt: receipt.received_at };
    });
    await logAction(req.user.id, 'CREATE', 'billing', null, null, { action: 'collect_deposit', amount, receipt: result.receiptNumber }, req.ip);
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    domainError(res, err, 'Failed to record advance');
  }
});

// ── POST /api/billing/opd ──────────────────────────────────
// The bill for a finalized consultation: an invoice of everything charged to
// the visit and not billed yet. Asking again returns the existing bill.
router.post('/opd', protect, checkPermission('billing', 'write'), async (req, res) => {
  try {
    const encounterId = Number(req.body?.encounterId) || 0;
    const result = await sequelize.transaction(async (t) => {
      const encounter = await B.one('SELECT id, status FROM hms_encounters WHERE id = :id FOR UPDATE', { id: encounterId }, t);
      if (!encounter) B.fail(404, 'Encounter not found.');
      const latestBill = () => B.one(`SELECT * FROM hms_bills WHERE encounter_id = :id AND COALESCE(status, '') <> 'Cancelled'
        ORDER BY (EXISTS (SELECT 1 FROM hms_invoices i WHERE i.legacy_bill_id = hms_bills.id)) DESC, id DESC LIMIT 1`, { id: encounterId }, t);
      if (encounter.status !== 'Finalized') {
        const billed = await latestBill();
        if (billed) return { existing: true, bill: billed };
        B.fail(409, 'The consultation is not finalized yet. Bill it after the doctor finalizes it.');
      }
      const accountId = await B.accountFor({ encounterId }, t);
      const draft = await B.refreshDraft(accountId, req.user, t, { create: true });
      if (!draft) {
        const billed = await latestBill();
        if (billed) return { existing: true, bill: billed };
        B.fail(409, 'Nothing has been charged to this visit.', 'NOTHING_TO_BILL');
      }
      const inv = await B.issueInvoice(draft.id, {}, req.user, t);
      return { existing: false, bill: await B.one('SELECT * FROM hms_bills WHERE id = :id', { id: inv.legacy_bill_id }, t), invoiceId: inv.id };
    });
    if (!result.existing) await logAction(req.user.id, 'CREATE', 'billing', result.bill.id, null, { action: 'issue_opd_invoice', billNumber: result.bill.bill_number }, req.ip);
    const bill = result.bill;
    res.json({ success: true, existing: result.existing, data: { ...bill, id: bill.id, billNumber: bill.bill_number, billType: bill.bill_type, invoiceId: result.invoiceId } });
  } catch (err) {
    domainError(res, err, 'Failed to generate OPD bill');
  }
});

// ── GET /api/billing/recent ────────────────────────────────
router.get('/recent', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 10));
    const [rows] = await sequelize.query(`
      SELECT b.ID, b.BILL_NUMBER, b.BILL_TYPE, b.STATUS, b.TOTAL_AMOUNT, b.GST_AMOUNT,
             b.NET_PAYABLE, b.CREATED_AT, b.PATIENT_ID, b.ENCOUNTER_ID, p.NAME AS PATIENT_NAME, p.UHID,
             u.NAME AS CREATED_BY_NAME
      FROM HMS_BILLS b
      JOIN HMS_PATIENTS p ON p.ID = b.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = b.CREATED_BY
      ORDER BY b.CREATED_AT DESC, b.ID DESC
      LIMIT ${limit}
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch recent bills' });
  }
});

// ── GET /api/billing/:billId ───────────────────────────────
router.get('/:billId', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const { billId } = req.params;
    
    const [bills] = await sequelize.query(`
      SELECT b.*, p.NAME as PATIENT_NAME, p.UHID, p.PHONENUMBER as PHONE, p.AGE, p.GENDER, u.NAME as CREATED_BY_NAME
      FROM HMS_BILLS b
      JOIN HMS_PATIENTS p ON p.ID = b.PATIENT_ID
      LEFT JOIN HMS_USERS u ON u.ID = b.CREATED_BY
      WHERE b.ID = :billId
    `, { replacements: { billId } });

    if (bills.length === 0) return res.status(404).json({ success: false, message: 'Bill not found' });
    const bill = bills[0];

    const [items] = await sequelize.query(`SELECT * FROM HMS_BILL_ITEMS WHERE BILL_ID = :billId`, { replacements: { billId } });
    const [payments] = await sequelize.query(`SELECT * FROM HMS_PAYMENTS WHERE BILL_ID = :billId ORDER BY PAYMENT_DATE DESC`, { replacements: { billId } });

    bill.items = items;
    bill.payments = payments;
    const invoice = await invoiceForBill(bill.ID);
    bill.INVOICE_ID = invoice ? invoice.id : null;
    const paidAmount = payments.reduce((sum, p) => sum + Number(p.AMOUNT || 0), 0);
    bill.PAID_AMOUNT = Math.round(paidAmount * 100) / 100;
    bill.BALANCE_DUE = Math.max(0, Math.round((Number(bill.NET_PAYABLE || 0) - paidAmount) * 100) / 100);

    res.json({ success: true, data: bill });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch bill' });
  }
});

// ── GET /api/billing/patient/:patientId ───────────────────
router.get('/patient/:patientId', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const { patientId } = req.params;
    const [bills] = await sequelize.query(`
      SELECT b.*, (SELECT SUM(AMOUNT) FROM HMS_PAYMENTS WHERE BILL_ID = b.ID) as PAID_AMOUNT
      FROM HMS_BILLS b
      WHERE b.PATIENT_ID = :patientId
      ORDER BY b.CREATED_AT DESC
    `, { replacements: { patientId } });
    
    res.json({ success: true, data: bills });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch bills for patient' });
  }
});

// ── Record a payment against a bill ──────────────────────
// Used by POST /:billId/payment and POST /payment. The bill row is locked so concurrent payments
// see each other, and a payment larger than the balance due is refused (it used to be accepted,
// overstating the day's collection).
async function recordPayment(req, res, billId) {
  if (await invoiceForBill(billId)) return invoicePayment(req, res, billId);
  if (req.body?.applyAdvance) {
    // Paying "by advance" used to relabel the payment without using any deposit.
    return res.status(409).json({ success: false, code: 'ADVANCE_NOT_APPLICABLE', message: 'Deposits are applied to bills raised under the new billing. Take this payment normally.' });
  }
  const t = await sequelize.transaction();
  try {
    const { amount, paymentMode = 'Cash', referenceNumber, notes } = req.body;

    if (!billId || !amount || !(Number(amount) > 0)) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Valid Bill ID and Payment Amount required' });
    }

    const bill = await Bill.findByPk(billId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!bill) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Bill not found' });
    }

    if (bill.status === 'Paid') {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Bill is already fully paid' });
    }

    const [paidBefore] = await sequelize.query(
      'SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL_PAID FROM HMS_PAYMENTS WHERE BILL_ID = :billId',
      { replacements: { billId }, transaction: t }
    );
    const alreadyPaid = Number(paidBefore[0]?.TOTAL_PAID || 0);
    const balanceDue = Math.round((Number(bill.netPayable || 0) - alreadyPaid) * 100) / 100;
    const payAmount = Math.round(Number(amount) * 100) / 100;
    if (payAmount > balanceDue + 0.001) {
      await t.rollback();
      return res.status(400).json({ success: false, message: `Amount is more than the balance due (Rs. ${balanceDue.toFixed(2)}).` });
    }

    const paymentId = await nextval('hms_payments_seq', t);
    const receiptNumber = `REC-${paymentId}`;
    const mode = paymentMode;

    const [inserted] = await sequelize.query(`
      INSERT INTO HMS_PAYMENTS (
        ID, BILL_ID, PATIENT_ID, PAYMENT_MODE, AMOUNT, REFERENCE_NUMBER,
        RECEIVED_BY, RECEIPT_NUMBER, NOTES, PAYMENT_DATE
      ) VALUES (
        :id, :billId, :patientId, :paymentMode, :amount, :referenceNumber,
        :receivedBy, :receiptNumber, :notes, CURRENT_TIMESTAMP
      )
      RETURNING PAYMENT_DATE AS "PAYMENT_DATE"
    `, {
      replacements: {
        id: paymentId,
        billId,
        patientId: bill.patientId,
        paymentMode: mode,
        amount: payAmount,
        referenceNumber: referenceNumber || null,
        receivedBy: req.user.id,
        receiptNumber,
        notes: notes || null
      },
      transaction: t,
    });

    const payment = {
      id: paymentId,
      billId,
      patientId: bill.patientId,
      paymentMode: mode,
      amount: payAmount,
      referenceNumber,
      notes,
      receivedBy: req.user.id,
      receiptNumber,
      paymentDate: inserted?.[0]?.PAYMENT_DATE || new Date(),
    };

    const totalPaid = alreadyPaid + payAmount;
    if (totalPaid >= Number(bill.netPayable) - 0.001) {
      await bill.update({ status: 'Paid' }, { transaction: t });
    } else {
      await bill.update({ status: 'Partially Paid' }, { transaction: t });
    }

    await t.commit();
    await logAction(req.user.id, 'CREATE', 'billing', payment.id, null, { action: 'record_payment', receiptNumber, amount: payAmount }, req.ip);

    res.json({ success: true, data: payment });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Payment failed' });
  }
}

// Payment on an invoice-backed bill: a receipt allocated to the invoice, or
// (applyAdvance) the patient's deposits applied to it.
async function invoicePayment(req, res, billId) {
  try {
    const { amount, paymentMode = 'Cash', referenceNumber, notes, applyAdvance = false } = req.body || {};
    const data = await sequelize.transaction(async (t) => {
      const invoice = await invoiceForBill(billId, t);
      if (applyAdvance) {
        const applied = await B.applyAvailableFunds(invoice.id, req.user, t);
        if (!applied.length) B.fail(400, 'No deposit is available for this patient.', 'NO_DEPOSIT');
        const total = B.money(applied.reduce((s, a) => s + Number(a.amount), 0));
        return { id: applied[0].id, billId: Number(billId), paymentMode: 'Advance', amount: total, receiptNumber: null, paymentDate: applied[0].allocated_at };
      }
      if (!amount || !(Number(amount) > 0)) B.fail(400, 'Valid Bill ID and Payment Amount required');
      const { intent, receipt } = await B.startPayment({
        invoiceId: invoice.id, amount: Number(amount), method: PAYMENT_METHOD[paymentMode] || paymentMode, providerReference: referenceNumber, notes,
      }, req.user, t);
      return { id: receipt.legacy_payment_id || receipt.id, billId: Number(billId), patientId: intent.patient_id, paymentMode: paymentMode,
        amount: B.money(receipt.amount), referenceNumber: receipt.provider_reference, receivedBy: req.user.id,
        receiptNumber: receipt.receipt_number, paymentDate: receipt.received_at };
    });
    await logAction(req.user.id, 'CREATE', 'billing', data.id, null, { action: 'record_payment', receiptNumber: data.receiptNumber, amount: data.amount }, req.ip);
    res.json({ success: true, data });
  } catch (err) {
    if (err.code === 'NOTHING_DUE') return res.status(400).json({ success: false, message: 'Bill is already fully paid' });
    domainError(res, err, 'Payment failed');
  }
}

// ── POST /api/billing/:billId/payment ─────────────────────
router.post('/:billId/payment', protect, checkPermission('billing', 'write'), (req, res) => recordPayment(req, res, req.params.billId));

// ── POST /api/billing/advance ─────────────────────────────────
// ── POST /api/billing/payment ─────────────────────────────────
router.post('/payment', protect, checkPermission('billing', 'write'), (req, res) => recordPayment(req, res, req.body.billId));

// ── POST /api/billing/:billId/discount ────────────────────
router.post('/:billId/discount', protect, checkPermission('billing', 'write'), async (req, res) => {
  try {
    // Only super_admin or admin can approve discounts
    if (!['super_admin', 'admin'].includes(req.user.role)) {
       return res.status(403).json({ success: false, message: 'Only Admins can approve discounts' });
    }

    const { billId } = req.params;
    const { amount } = req.body;

    if (await invoiceForBill(billId)) {
      // After issue a reduction is a credit note for the extra discount.
      const data = await sequelize.transaction(async (t) => {
        const invoice = await invoiceForBill(billId, t);
        const [[given]] = await sequelize.query(`SELECT COALESCE(sum(amount), 0) AS v FROM hms_invoice_notes
          WHERE invoice_id = :id AND kind = 'credit' AND source_type IS NULL`, { replacements: { id: invoice.id }, transaction: t });
        const extra = B.money(Number(amount || 0) - Number(invoice.discount_amount) - Number(given.v));
        if (extra < 0) B.fail(409, 'A discount cannot be reduced after the bill is issued.');
        if (extra > 0) {
          await B.createNote(invoice.id, { kind: 'credit', reason: req.body?.reason || 'Discount approved by administrator',
            lines: [{ category: 'Service', description: 'Discount approved after the bill was issued', amount: extra, gstAmount: 0 }] }, req.user, t);
        }
        return B.one('SELECT * FROM hms_bills WHERE id = :id', { id: Number(billId) }, t);
      });
      await logAction(req.user.id, 'UPDATE', 'billing', Number(billId), null, { action: 'discount_credit_note', amount }, req.ip);
      return res.json({ success: true, data });
    }

    const bill = await Bill.findByPk(billId);
    if (!bill) return res.status(404).json({ success: false, message: 'Bill not found' });
    if (bill.status === 'Paid') return res.status(400).json({ success: false, message: 'Cannot discount a paid bill' });

    const advanceAdj = Number(bill.advanceAdjusted || 0);
    const newNetPayable = Number(bill.totalAmount || 0) + Number(bill.gstAmount || 0) - Number(amount || 0) - advanceAdj;

    await bill.update({ 
      discountAmount: Number(amount || 0), 
      discountApprovedBy: req.user.id,
      netPayable: newNetPayable < 0 ? 0 : newNetPayable
    });

    await logAction(req.user.id, 'UPDATE', 'billing', bill.id, null, { action: 'apply_discount', amount }, req.ip);

    res.json({ success: true, data: bill });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to apply discount' });
  }
});

module.exports = router;
