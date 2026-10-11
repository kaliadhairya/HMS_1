const express = require('express');
const router = express.Router();
const { sequelize, Bill, BillItem, Payment, PatientAdvance, Encounter, User, Patient } = require('../models');
const { protect, checkPermission } = require('../middleware/auth');
const logAction = require('../utils/auditLogger');

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
router.get('/advance/:patientId', protect, checkPermission('billing', 'read'), async (req, res) => {
  try {
    const { patientId } = req.params;
    const [result] = await sequelize.query(`
      SELECT SUM(AMOUNT) as TOTAL_ADVANCE,
             SUM(CASE WHEN ADJUSTED_BILL_ID IS NOT NULL OR IS_REFUNDED = 1 THEN AMOUNT ELSE 0 END) as ADJUSTED
      FROM HMS_PATIENT_ADVANCES
      WHERE PATIENT_ID = :patientId
    `, { replacements: { patientId } });

    const totalAdvance = result[0].TOTAL_ADVANCE || 0;
    const adjusted = result[0].ADJUSTED || 0;
    const availableAdvance = totalAdvance - adjusted;

    res.json({ success: true, data: { totalAdvance, adjusted, availableAdvance } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch advances' });
  }
});

// ── POST /api/billing/advance ──────────────────────────────
router.post('/advance', protect, checkPermission('billing', 'write'), async (req, res) => {
  try {
    const { patientId, admissionId, amount, paymentMode, notes } = req.body;
    const id = await nextval('HMS_PATIENT_ADVANCES_SEQ');
    const advance = await PatientAdvance.create({
      id,
      patientId,
      admissionId: admissionId || null,
      amount,
      paymentMode,
      notes,
      receivedBy: req.user.id
    });
    await logAction(req.user.id, 'CREATE', 'billing', advance.id, null, { action: 'collect_advance', amount }, req.ip);
    res.json({ success: true, data: advance });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to record advance' });
  }
});

// ── POST /api/billing/opd ──────────────────────────────────
// Consultation fee and lab charges for one finalized OPD encounter.
async function opdCharges(encounter, transaction) {
  // Consultation tariff (prefer doctor-specific, fall back to general)
  const [tariffResult] = await sequelize.query(`
    SELECT RATE, GST_RATE FROM HMS_TARIFFS
    WHERE CATEGORY = 'Consultation' AND IS_ACTIVE = 1
    AND (DOCTOR_ID = :doctorId OR DOCTOR_ID IS NULL)
    ORDER BY DOCTOR_ID DESC NULLS LAST
    LIMIT 1
  `, { replacements: { doctorId: encounter.doctor_id }, transaction });
  const consultationFee = tariffResult.length > 0 ? Number(tariffResult[0].RATE) : 200;
  const consultGst = tariffResult.length > 0 ? Number(tariffResult[0].GST_RATE) : 0;

  // Lab charges: each ordered test matched against the tariff table
  const [labItems] = await sequelize.query(`
    SELECT ioi.ITEM_NAME, ioi.ID
    FROM HMS_INVESTIGATION_ORDERS o
    JOIN HMS_INVESTIGATION_ORDER_ITEMS ioi ON ioi.ORDER_ID = o.ID
    WHERE o.ENCOUNTER_ID = :encounterId
      -- Cancelled tests are not performed, so they are not charged
      AND COALESCE(o.STATUS, '') <> 'Cancelled'
      AND COALESCE(ioi.STATUS, '') <> 'Cancelled'
  `, { replacements: { encounterId: encounter.id }, transaction });

  let labTotal = 0;
  let labGstTotal = 0;
  for (const item of labItems) {
    const [tariff] = await sequelize.query(`
      SELECT RATE, GST_RATE FROM HMS_TARIFFS
      WHERE CATEGORY = 'Lab' AND IS_ACTIVE = 1
      AND UPPER(NAME) LIKE '%' || UPPER(:testName) || '%'
      LIMIT 1
    `, { replacements: { testName: item.ITEM_NAME }, transaction });
    const rate = tariff.length > 0 ? Number(tariff[0].RATE) : 100;
    const gst = tariff.length > 0 ? Number(tariff[0].GST_RATE) : 0;
    labTotal += rate;
    labGstTotal += rate * gst / 100;
  }

  return {
    consultationFee,
    consultationGst: consultationFee * consultGst / 100,
    labCount: labItems.length,
    labTotal,
    labGstTotal,
  };
}

async function insertBillItems(billId, items, transaction) {
  for (const item of items) {
    item.billId = billId;
    item.id = await nextval('HMS_BILL_ITEMS_SEQ', transaction);
  }
  if (items.length) await BillItem.bulkCreate(items, { transaction });
}

router.post('/opd', protect, checkPermission('billing', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { encounterId } = req.body;
    // Lock the encounter row so two "generate" clicks (or two desks) cannot both create a bill.
    const encounter = await Encounter.findByPk(encounterId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!encounter) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Encounter not found.' });
    }
    // Billing staff cannot read clinical encounters, so take the patient from the encounter here
    const patientId = encounter.patient_id;

    const existingBills = await Bill.findAll({ where: { encounterId, billType: 'OPD' }, order: [['id', 'ASC']], transaction: t });
    const billIds = existingBills.map((b) => b.id);
    const [billedTypes] = billIds.length
      ? await sequelize.query('SELECT DISTINCT ITEM_TYPE FROM HMS_BILL_ITEMS WHERE BILL_ID IN (:billIds)', { replacements: { billIds }, transaction: t })
      : [[]];
    const consultationBilled = billedTypes.some((r) => r.ITEM_TYPE === 'Consultation');

    // Already billed: return the bill that carries the consultation so the billing screen reopens it
    if (consultationBilled) {
      const [withConsult] = await sequelize.query(
        "SELECT BILL_ID FROM HMS_BILL_ITEMS WHERE BILL_ID IN (:billIds) AND ITEM_TYPE = 'Consultation' ORDER BY BILL_ID LIMIT 1",
        { replacements: { billIds }, transaction: t }
      );
      const bill = existingBills.find((b) => b.id === Number(withConsult[0].BILL_ID)) || existingBills[0];
      await t.rollback();
      return res.json({ success: true, existing: true, data: bill });
    }
    // Lab orders and medicines can still change while the consultation is open; a bill raised
    // then would miss them. Bill only finalized consultations.
    if (encounter.status !== 'Finalized') {
      await t.rollback();
      return res.status(409).json({ success: false, message: 'The consultation is not finalized yet. Bill it after the doctor finalizes it.' });
    }

    const charges = await opdCharges(encounter, t);
    const labAlreadyBilled = billedTypes.some((r) => r.ITEM_TYPE === 'Lab');
    const newItems = [{ itemType: 'Consultation', itemName: 'Doctor Consultation', quantity: 1, rate: charges.consultationFee, amount: charges.consultationFee }];
    let addedGst = charges.consultationGst;
    if (charges.labCount > 0 && !labAlreadyBilled) {
      newItems.push({ itemType: 'Lab', itemName: `Lab Investigations (${charges.labCount})`, quantity: charges.labCount, rate: charges.labTotal / charges.labCount, amount: charges.labTotal });
      addedGst += charges.labGstTotal;
    }

    // The pharmacy may have dispensed first and opened a pending bill for this visit with the
    // medicines on it. Add the consultation (and lab) charges to that bill: before, the visit
    // counted as "already billed" and the consultation fee was never charged.
    const pendingBill = existingBills.find((b) => b.status === 'Pending');
    if (pendingBill) {
      await insertBillItems(pendingBill.id, newItems, t);
      const [[sums]] = await sequelize.query(
        'SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL FROM HMS_BILL_ITEMS WHERE BILL_ID = :billId',
        { replacements: { billId: pendingBill.id }, transaction: t }
      );
      const totalAmount = Math.round(Number(sums.TOTAL || 0) * 100) / 100;
      const gstAmount = Math.round((Number(pendingBill.gstAmount || 0) + addedGst) * 100) / 100;
      const netPayable = Math.max(0, Math.round((totalAmount + gstAmount - Number(pendingBill.discountAmount || 0) - Number(pendingBill.advanceAdjusted || 0)) * 100) / 100);
      await pendingBill.update({ totalAmount, gstAmount, netPayable }, { transaction: t });
      await t.commit();
      await logAction(req.user.id, 'UPDATE', 'billing', pendingBill.id, null, { action: 'add_opd_charges', billNumber: pendingBill.billNumber }, req.ip);
      return res.json({ success: true, existing: true, updated: true, data: pendingBill });
    }

    // New bill. Medicines already on another bill (dispensing records linked to a bill) are not charged again.
    const billId = await nextval('HMS_BILLS_SEQ', t);
    const year = new Date().getFullYear();
    const billNumber = `BILL-${year}-${String(billId).padStart(6, '0')}`;

    const [pharmResult] = await sequelize.query(`
      SELECT SUM(d.TOTAL_AMOUNT) as PHARM_TOTAL
      FROM HMS_PRESCRIPTIONS pr
      JOIN HMS_DISPENSING_RECORDS d ON d.PRESCRIPTION_ID = pr.ID
      WHERE pr.ENCOUNTER_ID = :encounterId AND d.BILL_ID IS NULL
    `, { replacements: { encounterId }, transaction: t });
    // SUM() of a NUMERIC column comes back as a string; without Number() it was concatenated
    // onto the total ("300" + "125.00").
    const pharmTotal = pharmResult.length > 0 ? Number(pharmResult[0].PHARM_TOTAL || 0) : 0;
    if (pharmTotal > 0) {
      newItems.push({ itemType: 'Pharmacy', itemName: 'Pharmacy Medicines', quantity: 1, rate: pharmTotal, amount: pharmTotal });
    }

    const totalAmount = newItems.reduce((sum, i) => sum + Number(i.amount), 0);
    const gstAmount = addedGst;
    const netPayable = totalAmount + gstAmount;
    await sequelize.query(`
      INSERT INTO HMS_BILLS (
        ID, PATIENT_ID, ENCOUNTER_ID, BILL_TYPE, BILL_NUMBER, STATUS,
        TOTAL_AMOUNT, DISCOUNT_AMOUNT, GST_AMOUNT, NET_PAYABLE, ADVANCE_ADJUSTED,
        CREATED_BY, CREATED_AT, UPDATED_AT
      ) VALUES (
        :id, :patientId, :encounterId, 'OPD', :billNumber, 'Pending',
        :totalAmount, 0, :gstAmount, :netPayable, 0,
        :createdBy, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, {
      replacements: { id: billId, patientId, encounterId, billNumber, totalAmount, gstAmount, netPayable, createdBy: req.user.id },
      transaction: t,
    });
    await insertBillItems(billId, newItems, t);

    await t.commit();
    await logAction(req.user.id, 'CREATE', 'billing', billId, null, { action: 'generate_opd_bill', billNumber }, req.ip);

    res.json({
      success: true,
      data: { id: billId, patientId, encounterId, billType: 'OPD', billNumber, status: 'Pending', totalAmount, gstAmount, netPayable, createdBy: req.user.id },
    });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate OPD bill' });
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
  const t = await sequelize.transaction();
  try {
    const { amount, paymentMode = 'Cash', referenceNumber, notes, applyAdvance = false } = req.body;

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
    const mode = applyAdvance ? 'Advance' : paymentMode;

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

// ── POST /api/billing/:billId/payment ─────────────────────
router.post('/:billId/payment', protect, checkPermission('billing', 'write'), (req, res) => recordPayment(req, res, req.params.billId));

// ── POST /api/billing/advance ─────────────────────────────────
router.post('/advance', protect, checkPermission('billing', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { patientId, admissionId, amount, paymentMode = 'Cash', notes } = req.body;

    if (!patientId || !amount || Number(amount) <= 0) {
      await t.rollback();
      return res.status(400).json({ success: false, message: 'Valid Patient ID and Amount required' });
    }

    const advanceId = await nextval('hms_advances_seq', t);

    const advance = await PatientAdvance.create({
      id: advanceId,
      patientId,
      admissionId: admissionId || null,
      amount: Number(amount),
      paymentMode,
      receivedBy: req.user.id,
      notes: notes || null,
      isRefunded: 0,
    }, { transaction: t });

    await t.commit();
    await logAction(req.user.id, 'CREATE', 'billing', advance.id, null, { action: 'collect_advance', amount }, req.ip);

    res.status(201).json({ success: true, data: advance });
  } catch (err) {
    await t.rollback();
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to record advance payment' });
  }
});

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
