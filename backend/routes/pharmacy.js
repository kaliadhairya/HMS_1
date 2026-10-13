const express = require('express');
const router = express.Router();
const { sequelize } = require('../models/db');
const { publish } = require('../utils/outbox');
const { protect, checkPermission } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');
const {
  Medicine, MedicineBatch, StockLedger, Supplier,
  PurchaseOrder, PurchaseItem,
  DispensingRecord, DispensingItem,
  OtcSale, OtcItem,
  Prescription, PrescriptionItem, Patient, User,
} = require('../models');
const { body, validationResult } = require('express-validator');

async function nextval(sequenceName, transaction) {
  let name = sequenceName.toLowerCase();
  if (name === 'hms_purchase_orders_seq') name = 'hms_po_seq';
  if (name === 'hms_purchase_items_seq') name = 'hms_pi_seq';
  if (name === 'hms_medicine_batches_seq') name = 'hms_med_batch_seq';
  if (name === 'hms_stock_ledger_seq') name = 'hms_stock_led_seq';
  if (name === 'hms_dispensing_records_seq') name = 'hms_disp_rec_seq';
  if (name === 'hms_dispensing_items_seq') name = 'hms_disp_item_seq';
  if (name === 'hms_otc_sales_seq') name = 'hms_otc_sale_seq';
  if (name === 'hms_otc_items_seq') name = 'hms_otc_item_seq';

  const [[row]] = await sequelize.query(
    `SELECT nextval('${name}') AS "NEXTVAL"`,
    { transaction }
  );
  return Number(row.NEXTVAL); // bigint arrives as a string
}

async function findPendingBill({ encounterId = null, admissionId = null }, transaction) {
  const [rows] = await sequelize.query(`
    SELECT ID
    FROM HMS_BILLS
    WHERE STATUS = 'Pending'
      AND (
        (:encounterId IS NOT NULL AND ENCOUNTER_ID = :encounterId)
        OR (:admissionId IS NOT NULL AND ADMISSION_ID = :admissionId)
      )
    ORDER BY ID DESC
    LIMIT 1
  `, {
    replacements: { encounterId, admissionId },
    transaction,
  });

  return rows[0]?.ID || null;
}

// An error that carries the HTTP status to answer with (validation and conflict errors raised inside a transaction).
const httpError = (status, message) => Object.assign(new Error(message), { status });
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const toPositiveInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const isIsoDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());

// Read one batch with its medicine and lock it for the rest of the transaction, so two counters cannot
// sell or dispense the same units at the same time.
async function lockBatch(batchId, transaction) {
  const id = Number(batchId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows] = await sequelize.query(`
    SELECT b.ID, b.MEDICINE_ID, b.SUPPLIER_ID, b.BATCH_NUMBER, b.EXPIRY_DATE, b.QUANTITY, b.MRP, b.PURCHASE_RATE, b.LOT_STATUS,
           (b.EXPIRY_DATE < (current_timestamp AT TIME ZONE (SELECT timezone FROM hms_med_locations WHERE code='MAIN'))::date) AS IS_EXPIRED,
           m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT, m.GST_RATE, m.IS_CONTROLLED
    FROM HMS_MEDICINE_BATCHES b
    JOIN HMS_MEDICINES m ON m.ID = b.MEDICINE_ID
    WHERE b.ID = :id
    FOR UPDATE OF b
  `, { replacements: { id }, transaction });
  return rows[0] || null;
}

async function setBatchQuantity(batchId, quantity, transaction) {
  await sequelize.query('UPDATE HMS_MEDICINE_BATCHES SET QUANTITY = :quantity WHERE ID = :id', {
    replacements: { id: batchId, quantity }, transaction,
  });
}

// Stock ledger row. QUANTITY is positive for IN/OUT/RETURN/DISCARD (the type gives the direction) and signed
// for ADJUSTMENT, so a ledger can always be summed back to the batch quantity.
async function addLedger(transaction, { medicineId, batchId, type, quantity, referenceType, referenceId = null, userId }) {
  const id = await nextval('HMS_STOCK_LEDGER_SEQ', transaction);
  await sequelize.query(`
    INSERT INTO HMS_STOCK_LEDGER (
      ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
      REFERENCE_TYPE, REFERENCE_ID, TRANSACTION_DATE, PERFORMED_BY
    ) VALUES (
      :id, :medicineId, :batchId, :type, :quantity,
      :referenceType, :referenceId, CURRENT_TIMESTAMP, :userId
    )
  `, {
    replacements: { id, medicineId, batchId, type, quantity, referenceType, referenceId, userId },
    transaction,
  });
  return id;
}

// Audit row written inside the business transaction, so a reason or a "not dispensed" note is never lost
// while the stock change it explains is kept (logAction runs after commit and may fail silently).
async function auditInTransaction(transaction, { userId, action, module = 'pharmacy', recordId, value, ip }) {
  await sequelize.query(`
    INSERT INTO HMS_AUDIT_LOGS (USER_ID, ACTION, MODULE, RECORD_ID, OLD_VALUE, NEW_VALUE, IP_ADDRESS, CREATED_AT)
    VALUES (:userId, :action, :module, :recordId, NULL, :value, :ip, CURRENT_TIMESTAMP)
  `, {
    replacements: {
      userId, action, module, recordId: recordId ?? null, value: JSON.stringify(value), ip: ip || null,
    },
    transaction,
  });
}

const sendError = (res, err, fallback) => {
  if (err.status) return res.status(err.status).json({ success: false, status: 'error', message: err.message });
  console.error(fallback, err);
  return res.status(500).json({ success: false, status: 'error', message: fallback });
};

router.use(protect);

// ─── GET /api/pharmacy/medicines/:id/batches ────────────────────
// Batches that can be dispensed or sold: in stock and not expired, earliest expiry first (FEFO).
router.get('/medicines/:id/batches', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const { id } = req.params;
    const { Op } = require('sequelize');
    const batches = await MedicineBatch.findAll({
      where: {
        medicineId: id,
        quantity: { [Op.gt]: 0 },
        expiryDate: { [Op.gte]: sequelize.literal('CURRENT_DATE') },
        [Op.and]: sequelize.literal("LOT_STATUS = 'AVAILABLE'"),
      },
      order: [['EXPIRY_DATE', 'ASC'], ['ID', 'ASC']], // FEFO
    });
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/pharmacy/stock (Consolidated: one row per medicine NAME) ──
router.get('/stock', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    // NEAREST_EXPIRY only looks at batches that still hold stock: an empty, expired batch must not flag the
    // medicine as expired.
    const [rows] = await sequelize.query(`
      SELECT MIN(m.ID) as ID,
             m.GENERIC_NAME, m.FORMULATION, m.STRENGTH, m.STRENGTH_UNIT,
             COUNT(b.ID) as BATCH_COUNT,
             COALESCE(SUM(b.QUANTITY), 0) as TOTAL_QUANTITY,
             MIN(CASE WHEN b.QUANTITY > 0 THEN b.EXPIRY_DATE END) as NEAREST_EXPIRY,
             MAX(CASE WHEN b.QUANTITY > 0 THEN b.EXPIRY_DATE END) as FARTHEST_EXPIRY,
             MAX(b.MRP) as MRP,
             MAX(b.PURCHASE_RATE) as PURCHASE_RATE,
             COALESCE((
               SELECT SUM(sl.QUANTITY) FROM HMS_STOCK_LEDGER sl
               WHERE sl.MEDICINE_ID IN (
                 SELECT m2.ID FROM HMS_MEDICINES m2
                 WHERE UPPER(m2.GENERIC_NAME) = UPPER(m.GENERIC_NAME)
                   AND COALESCE(m2.FORMULATION, 'x') = COALESCE(m.FORMULATION, 'x')
                   AND COALESCE(m2.STRENGTH, 'x') = COALESCE(m.STRENGTH, 'x')
               )
               AND sl.TRANSACTION_TYPE = 'OUT'
             ), 0) as TOTAL_ISSUED
      FROM HMS_MEDICINES m
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
      WHERE m.IS_ACTIVE = 1
      GROUP BY m.GENERIC_NAME, m.FORMULATION, m.STRENGTH, m.STRENGTH_UNIT
      ORDER BY m.GENERIC_NAME ASC
    `);
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Stock fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch stock.' });
  }
});

// ─── GET /api/pharmacy/stock/batches-by-name (Batches for a medicine by name) ──
router.get('/stock/batches-by-name', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const { name, formulation, strength, strengthUnit } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });

    const [rows] = await sequelize.query(`
      SELECT b.ID as BATCH_ID, b.BATCH_NUMBER, b.EXPIRY_DATE,
             b.QUANTITY, b.MRP, b.PURCHASE_RATE, b.LOT_STATUS,
             s.NAME as SUPPLIER_NAME,
             m.ID as MEDICINE_ID,
             (SELECT MIN(sl.TRANSACTION_DATE) FROM HMS_STOCK_LEDGER sl
              WHERE sl.BATCH_ID = b.ID AND sl.TRANSACTION_TYPE = 'IN') as ADDED_ON
      FROM HMS_MEDICINE_BATCHES b
      JOIN HMS_MEDICINES m ON m.ID = b.MEDICINE_ID
      LEFT JOIN HMS_SUPPLIERS s ON s.ID = b.SUPPLIER_ID
      WHERE UPPER(m.GENERIC_NAME) = UPPER(:name)
        AND (m.FORMULATION = :formulation OR :formulation IS NULL)
        AND (m.STRENGTH = :strength OR :strength IS NULL)
      ORDER BY b.EXPIRY_DATE ASC
    `, { replacements: {
      name,
      formulation: formulation || null,
      strength: strength || null
    } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Batch details error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch batch details.' });
  }
});

// ─── GET /api/pharmacy/stock/batches/:medicineId (Individual batches by ID — kept for compat) ──
router.get('/stock/batches/:medicineId', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const medicineId = req.params.medicineId;
    const [rows] = await sequelize.query(`
      SELECT b.ID as BATCH_ID, b.BATCH_NUMBER, b.EXPIRY_DATE,
             b.QUANTITY, b.MRP, b.PURCHASE_RATE, b.LOT_STATUS,
             b.SUPPLIER_ID, s.NAME as SUPPLIER_NAME,
             (b.EXPIRY_DATE < CURRENT_DATE) as IS_EXPIRED
      FROM HMS_MEDICINE_BATCHES b
      LEFT JOIN HMS_SUPPLIERS s ON s.ID = b.SUPPLIER_ID
      WHERE b.MEDICINE_ID = :medicineId
      ORDER BY b.EXPIRY_DATE ASC, b.ID ASC
    `, { replacements: { medicineId } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Batch details error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch batch details.' });
  }
});

// ─── GET /api/pharmacy/stock/low ────────────────────────────────
router.get('/stock/low', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const threshold = parseInt(req.query.threshold) || 10;
    const [rows] = await sequelize.query(`
      SELECT m.ID, m.GENERIC_NAME, m.FORMULATION, m.STRENGTH,
             COALESCE(SUM(b.QUANTITY), 0) as TOTAL_QTY
      FROM HMS_MEDICINES m
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
      WHERE m.IS_ACTIVE = 1
      GROUP BY m.ID, m.GENERIC_NAME, m.FORMULATION, m.STRENGTH
      HAVING COALESCE(SUM(b.QUANTITY), 0) <= :threshold
      ORDER BY TOTAL_QTY ASC
    `, { replacements: { threshold } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Low stock error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch low stock.' });
  }
});

// ─── GET /api/pharmacy/stock/expiring ───────────────────────────
router.get('/stock/expiring', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const [rows] = await sequelize.query(`
      SELECT m.ID as MEDICINE_ID, m.GENERIC_NAME, m.FORMULATION, m.STRENGTH,
             b.ID as BATCH_ID, b.BATCH_NUMBER, b.EXPIRY_DATE, b.QUANTITY,
             b.MRP, b.SUPPLIER_ID, s.NAME as SUPPLIER_NAME
      FROM HMS_MEDICINES m
      JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
      LEFT JOIN HMS_SUPPLIERS s ON s.ID = b.SUPPLIER_ID
      WHERE trunc(b.EXPIRY_DATE) <= trunc(CURRENT_TIMESTAMP) + :days
        AND b.QUANTITY > 0
      ORDER BY b.EXPIRY_DATE ASC
    `, { replacements: { days } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Expiring stock error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch expiring stock.' });
  }
});

// ─── POST /api/pharmacy/grn ────────────────────────────────────
// Invoice numbers are stored as typed (React escapes them on display); HTML-escaping them here turned
// "INV/2026/14" into "INV&#x2F;2026&#x2F;14".
router.post('/grn', [
  body('invoiceNumber').optional({ checkFalsy: true }).trim(),
], checkPermission('pharmacy', 'write'), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { supplierId, invoiceNumber, invoiceDate, prId, isPartialDelivery } = req.body;
  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (rawItems.length === 0) {
    return res.status(400).json({ success: false, message: 'No items provided.' });
  }
  if (invoiceDate && !isIsoDate(invoiceDate)) {
    return res.status(400).json({ success: false, message: 'Enter the invoice date as YYYY-MM-DD.' });
  }

  // Validate every line before touching stock: whole-number quantity, a batch number, a real expiry date that
  // has not passed, and non-negative rates.
  const items = [];
  for (const [i, raw] of rawItems.entries()) {
    const row = i + 1;
    const medicineId = toPositiveInt(raw.medicineId);
    const quantity = toPositiveInt(raw.quantity);
    const batchNumber = String(raw.batchNumber || '').trim();
    const purchaseRate = Number(raw.purchaseRate);
    const mrp = Number(raw.mrp);
    const gstRate = Number(raw.gstRate || 0);
    if (!medicineId) return res.status(400).json({ success: false, message: `Row ${row}: select a medicine.` });
    if (!batchNumber) return res.status(400).json({ success: false, message: `Row ${row}: enter the batch number.` });
    if (!isIsoDate(raw.expiryDate)) return res.status(400).json({ success: false, message: `Row ${row}: enter a valid expiry date.` });
    if (raw.expiryDate < new Date().toISOString().slice(0, 10)) {
      return res.status(400).json({ success: false, message: `Row ${row}: batch ${batchNumber} has already expired and cannot be received.` });
    }
    if (!quantity) return res.status(400).json({ success: false, message: `Row ${row}: enter a whole-number quantity above zero.` });
    if (!Number.isFinite(purchaseRate) || purchaseRate < 0) return res.status(400).json({ success: false, message: `Row ${row}: enter a valid purchase rate.` });
    if (!Number.isFinite(mrp) || mrp < 0) return res.status(400).json({ success: false, message: `Row ${row}: enter a valid MRP.` });
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) return res.status(400).json({ success: false, message: `Row ${row}: enter a valid GST rate.` });
    items.push({ medicineId, quantity, batchNumber, expiryDate: raw.expiryDate, purchaseRate, mrp, gstRate });
  }

  const t = await sequelize.transaction();
  try {
    if (supplierId) {
      const [sup] = await sequelize.query('SELECT ID FROM HMS_SUPPLIERS WHERE ID = :id', { replacements: { id: Number(supplierId) || 0 }, transaction: t });
      if (!sup.length) throw httpError(400, 'Select a supplier that is on file.');
    }

    let poId;

    if (prId) {
      // Linked to existing Purchase Request — reuse that PO record
      poId = prId;
      const newStatus = isPartialDelivery ? 'Partial Delivery' : 'Delivered';
      await sequelize.query(
        `UPDATE HMS_PURCHASE_ORDERS SET STATUS = :status, INVOICE_NUMBER = :invoiceNumber, INVOICE_DATE = TO_DATE(:invoiceDate, 'YYYY-MM-DD') WHERE ID = :id`,
        { replacements: { id: poId, status: newStatus, invoiceNumber: invoiceNumber || null, invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10) }, transaction: t }
      );
    } else {
      // Direct Purchase — create a new PO record
      poId = await nextval('HMS_PURCHASE_ORDERS_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_PURCHASE_ORDERS (
          ID, SUPPLIER_ID, INVOICE_NUMBER, INVOICE_DATE, TOTAL_AMOUNT, GST_AMOUNT, STATUS, CREATED_BY, ORDER_DATE
        ) VALUES (
          :id, :supplierId, :invoiceNumber, TO_DATE(:invoiceDate, 'YYYY-MM-DD'), 0, 0, 'Received', :createdBy, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: poId,
          supplierId: supplierId || null,
          invoiceNumber: invoiceNumber || null,
          invoiceDate: invoiceDate || new Date().toISOString().slice(0, 10),
          createdBy: req.user.id,
        },
        transaction: t,
      });
    }

    const po = { id: poId };

    let totalAmount = 0;
    let totalGst = 0;

    // 2. Process each item
    for (const item of [...items].sort((a, b) => a.medicineId - b.medicineId || a.batchNumber.localeCompare(b.batchNumber))) {
      await sequelize.query('SELECT pg_advisory_xact_lock(727285, :medicine)', { replacements: { medicine: item.medicineId }, transaction: t });
      const [med] = await sequelize.query('SELECT ID FROM HMS_MEDICINES WHERE ID = :id', { replacements: { id: item.medicineId }, transaction: t });
      if (!med.length) throw httpError(400, `Medicine ${item.medicineId} is not in the catalogue.`);

      const itemGst = round2((item.quantity * item.purchaseRate * item.gstRate) / 100);
      const itemAmount = round2((item.quantity * item.purchaseRate) + itemGst);
      totalAmount += itemAmount;
      totalGst += itemGst;

      // Create purchase item
      const purchaseItemId = await nextval('HMS_PURCHASE_ITEMS_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_PURCHASE_ITEMS (
          ID, PURCHASE_ORDER_ID, MEDICINE_ID, BATCH_NUMBER, EXPIRY_DATE,
          QUANTITY, PURCHASE_RATE, MRP, GST_RATE, GST_AMOUNT, AMOUNT
        ) VALUES (
          :id, :purchaseOrderId, :medicineId, :batchNumber, TO_DATE(:expiryDate, 'YYYY-MM-DD'),
          :quantity, :purchaseRate, :mrp, :gstRate, :gstAmount, :amount
        )
      `, {
        replacements: {
          id: purchaseItemId,
          purchaseOrderId: po.id,
          medicineId: item.medicineId,
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          quantity: item.quantity,
          purchaseRate: item.purchaseRate,
          mrp: item.mrp,
          gstRate: item.gstRate,
          gstAmount: itemGst,
          amount: itemAmount,
        },
        transaction: t,
      });

      // Same medicine + batch number: top up that batch (locked), as long as the expiry matches.
      const [existing] = await sequelize.query(`
        SELECT ID, QUANTITY, TO_CHAR(EXPIRY_DATE, 'YYYY-MM-DD') AS EXPIRY
        FROM HMS_MEDICINE_BATCHES
        WHERE MEDICINE_ID = :medicineId AND BATCH_NUMBER = :batchNumber
        ORDER BY ID
        LIMIT 1
        FOR UPDATE
      `, { replacements: { medicineId: item.medicineId, batchNumber: item.batchNumber }, transaction: t });
      const existingBatch = existing[0] || null;

      let batchId;
      if (existingBatch) {
        if (existingBatch.EXPIRY !== item.expiryDate) {
          throw httpError(400, `Batch ${item.batchNumber} is already on file with expiry ${existingBatch.EXPIRY}. Check the batch number or expiry date.`);
        }
        await setBatchQuantity(existingBatch.ID, Number(existingBatch.QUANTITY || 0) + item.quantity, t);
        batchId = existingBatch.ID;
      } else {
        batchId = await nextval('HMS_MEDICINE_BATCHES_SEQ', t);
        await sequelize.query(`
          INSERT INTO HMS_MEDICINE_BATCHES (
            ID, MEDICINE_ID, SUPPLIER_ID, BATCH_NUMBER, EXPIRY_DATE,
            QUANTITY, PURCHASE_RATE, MRP, GST_AMOUNT
          ) VALUES (
            :id, :medicineId, :supplierId, :batchNumber, TO_DATE(:expiryDate, 'YYYY-MM-DD'),
            :quantity, :purchaseRate, :mrp, :gstAmount
          )
        `, {
          replacements: {
            id: batchId,
            medicineId: item.medicineId,
            supplierId: supplierId || null,
            batchNumber: item.batchNumber,
            expiryDate: item.expiryDate,
            quantity: item.quantity,
            purchaseRate: item.purchaseRate,
            mrp: item.mrp,
            gstAmount: itemGst,
          },
          transaction: t,
        });
      }

      await addLedger(t, {
        medicineId: item.medicineId, batchId, type: 'IN', quantity: item.quantity,
        referenceType: 'GRN', referenceId: po.id, userId: req.user.id,
      });
    }

    // Update PO totals
    await sequelize.query(`
      UPDATE HMS_PURCHASE_ORDERS
      SET TOTAL_AMOUNT = :totalAmount, GST_AMOUNT = :gstAmount
      WHERE ID = :id
    `, {
      replacements: { id: po.id, totalAmount: round2(totalAmount), gstAmount: round2(totalGst) },
      transaction: t,
    });

    await publish('stock_updated', 'pharmacist', { reason: 'grn' }, { transaction: t });
    await t.commit();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'pharmacy', po.id, null, { action: 'grn_received', itemsProcessed: items.length }, ip);

    res.json({ success: true, purchaseOrderId: po.id, itemsProcessed: items.length });
  } catch (err) {
    await t.rollback();
    sendError(res, err, 'GRN processing failed.');
  }
});

// ─── GET /api/pharmacy/dispense-queue ───────────────────────────
async function dispenseQueueHandler(req, res) {
  try {
    const [rows] = await sequelize.query(`
      SELECT p.NAME as PATIENT_NAME, p.UHID,
             pr.ID as PRESCRIPTION_ID, pr.CREATED_AT,
             u.NAME as DOCTOR_NAME,
             (SELECT COUNT(*) FROM HMS_PRESCRIPTION_ITEMS pi WHERE pi.PRESCRIPTION_ID = pr.ID) as MEDICINE_COUNT
      FROM HMS_PRESCRIPTIONS pr
      JOIN HMS_PATIENTS p ON p.ID = pr.PATIENT_ID
      JOIN HMS_USERS u ON u.ID = pr.DOCTOR_ID
      WHERE pr.STATUS = 'Finalized'
      ORDER BY pr.CREATED_AT ASC
    `);
    res.json({ success: true, status: 'success', data: rows });
  } catch (err) {
    console.error('Dispense queue error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dispense queue.' });
  }
}
router.get('/dispense-queue', checkPermission('pharmacy', 'read'), dispenseQueueHandler);

// ─── POST /api/pharmacy/dispense (Unified Transactional) ────────
// Body: { prescriptionId, items: [{ prescriptionItemId, medicineId, batchId, quantity, medicineName }],
//         notDispensed: [{ prescriptionItemId, medicineName, reason }] }
// - Only a Finalized prescription can be dispensed, once: the prescription row is locked and must still be
//   Finalized, so a second click or a second counter gets 409 instead of taking stock twice.
// - The rate is the batch MRP read here; amounts sent by the client are ignored.
// - Prescription lines that are not dispensed (free text not in the catalogue, out of stock, declined) are
//   recorded with their reason in HMS_AUDIT_LOGS (module 'pharmacy', action 'DISPENSE', record = dispensing
//   record), because HMS_DISPENSING_ITEMS needs a medicine and a batch for every row.
async function dispenseHandler(req, res) {
  // Free-text legacy lines cannot authorize medication supply. Both namespaces
  // share this boundary; the new endpoint requires the exact coded order version.
  return res.status(409).json({ success: false, code: 'CODED_ORDER_REQUIRED',
    message: 'This legacy prescription needs a coded signed order and pharmacist verification. Open Medication workflows → Pharmacist verification & supply.' });
}

router.post('/dispense', checkPermission('pharmacy', 'write'), dispenseHandler);

// ─── POST /api/pharmacy/otc ────────────────────────────────────
// Rate is the batch MRP and GST is the medicine's GST rate on top, both read here; the client sends only
// batch and quantity. Unknown UHIDs and patient IDs are rejected rather than stored.
router.post('/otc', checkPermission('pharmacy', 'write'), async (req, res) => {
  const { paymentMode } = req.body;
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (items.length === 0) {
    return res.status(400).json({ success: false, message: 'No items provided.' });
  }
  if (paymentMode && !['Cash', 'Card', 'UPI'].includes(paymentMode)) {
    return res.status(400).json({ success: false, message: 'Choose cash, card or UPI as the payment mode.' });
  }

  // The counter enters a UHID; a numeric patient ID is still accepted.
  let patientId = null;
  const patientRef = String(req.body.patientId ?? '').trim();
  if (patientRef) {
    const byId = /^\d+$/.test(patientRef);
    const [rows] = await sequelize.query(
      byId ? 'SELECT ID FROM HMS_PATIENTS WHERE ID = :ref' : 'SELECT ID FROM HMS_PATIENTS WHERE UPPER(UHID) = UPPER(:ref)',
      { replacements: { ref: byId ? Number(patientRef) : patientRef } }
    );
    if (!rows.length) {
      return res.status(400).json({ success: false, message: `No patient found with ${byId ? 'ID' : 'UHID'} ${patientRef}. Check the UHID, or leave it blank for a walk-in sale.` });
    }
    patientId = rows[0].ID;
  }

  const t = await sequelize.transaction();
  try {
    const saleId = await nextval('HMS_OTC_SALES_SEQ', t);
    const billNumber = `OTC-${Date.now()}`;
    await sequelize.query(`
      INSERT INTO HMS_OTC_SALES (
        ID, PATIENT_ID, SOLD_BY, SOLD_AT, TOTAL_AMOUNT, PAYMENT_MODE, BILL_NUMBER
      ) VALUES (
        :id, :patientId, :soldBy, CURRENT_TIMESTAMP, 0, :paymentMode, :billNumber
      )
    `, {
      replacements: {
        id: saleId,
        patientId,
        soldBy: req.user.id,
        paymentMode: paymentMode || 'Cash',
        billNumber,
      },
      transaction: t,
    });

    let totalAmount = 0;
    let totalGst = 0;
    const lines = [];

    for (const item of items) {
      const quantity = toPositiveInt(item.quantity);
      if (!quantity) throw httpError(400, 'Enter a whole-number quantity above zero for every medicine.');
      const batch = await lockBatch(item.batchId, t);
      if (!batch) throw httpError(400, 'Select a batch for every medicine.');
      if (item.medicineId && Number(item.medicineId) !== Number(batch.MEDICINE_ID)) {
        throw httpError(400, `Batch ${batch.BATCH_NUMBER} does not belong to the selected medicine.`);
      }
      if (batch.IS_EXPIRED || batch.LOT_STATUS !== 'AVAILABLE') throw httpError(400, `Batch ${batch.BATCH_NUMBER} is expired or unavailable and cannot be sold.`);
      if (batch.IS_CONTROLLED === 1) throw httpError(409, 'Controlled drugs require a coded order and independently witnessed supply.');
      if (Number(batch.QUANTITY) < quantity) {
        throw httpError(400, `Insufficient stock for ${batch.GENERIC_NAME}: batch ${batch.BATCH_NUMBER} has ${batch.QUANTITY} left.`);
      }

      const rate = round2(batch.MRP || 0);
      const gstRate = Number(batch.GST_RATE || 0);
      const baseAmount = round2(quantity * rate);
      const gstAmount = round2((baseAmount * gstRate) / 100);
      const amount = round2(baseAmount + gstAmount);
      totalAmount += amount;
      totalGst += gstAmount;

      const otcItemId = await nextval('HMS_OTC_ITEMS_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_OTC_ITEMS (
          ID, OTC_SALE_ID, MEDICINE_ID, BATCH_ID, QUANTITY, RATE, GST_AMOUNT, AMOUNT
        ) VALUES (
          :id, :otcSaleId, :medicineId, :batchId, :quantity, :rate, :gstAmount, :amount
        )
      `, {
        replacements: {
          id: otcItemId, otcSaleId: saleId, medicineId: batch.MEDICINE_ID, batchId: batch.ID,
          quantity, rate, gstAmount, amount,
        },
        transaction: t,
      });

      await setBatchQuantity(batch.ID, Number(batch.QUANTITY) - quantity, t);
      await addLedger(t, {
        medicineId: batch.MEDICINE_ID, batchId: batch.ID, type: 'OUT', quantity,
        referenceType: 'OTC', referenceId: saleId, userId: req.user.id,
      });

      lines.push({
        medicineId: batch.MEDICINE_ID, medicineName: batch.GENERIC_NAME, batchNumber: batch.BATCH_NUMBER,
        quantity, rate, gstRate, gstAmount, amount,
      });
    }

    totalAmount = round2(totalAmount);
    await sequelize.query(`
      UPDATE HMS_OTC_SALES
      SET TOTAL_AMOUNT = :totalAmount
      WHERE ID = :id
    `, {
      replacements: { id: saleId, totalAmount },
      transaction: t,
    });
    await publish('stock_updated', 'pharmacist', { reason: 'otc' }, { transaction: t });
    await t.commit();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'pharmacy', saleId, null, { action: 'otc_sale', billNumber }, ip);

    res.json({ success: true, saleId, billNumber, patientId, totalAmount, gstAmount: round2(totalGst), items: lines });
  } catch (err) {
    await t.rollback();
    sendError(res, err, 'OTC sale failed.');
  }
});

// ─── POST /api/pharmacy/return ──────────────────────────────────
// Stock movements that are not sales: { batchId, quantity, type, reason, patientId? }
//   patient_return  stock back from a patient     ledger RETURN  (+)  ref 'Patient Return', patient ID
//   vendor_return   stock sent back to supplier   ledger DISCARD (-)  ref 'Vendor Return', supplier ID
//   discard         disposal (expired, damaged)   ledger DISCARD (-)  ref 'Disposal'
//   adjust_in/out   count correction              ledger ADJUSTMENT, signed quantity, ref 'Stock Adjustment'
//   return          older clients: same as adjust_in
// The reason and details go to HMS_AUDIT_LOGS (module 'pharmacy_stock', record = ledger ID) in the same transaction.
const STOCK_MOVES = {
  patient_return: { sign: 1, type: 'RETURN', ref: 'Patient Return', action: 'PATIENT_RETURN', reasonRequired: true },
  vendor_return: { sign: -1, type: 'DISCARD', ref: 'Vendor Return', action: 'VENDOR_RETURN', reasonRequired: true },
  discard: { sign: -1, type: 'DISCARD', ref: 'Disposal', action: 'DISPOSAL', reasonRequired: true },
  adjust_in: { sign: 1, type: 'ADJUSTMENT', ref: 'Stock Adjustment', action: 'ADJUSTMENT' },
  adjust_out: { sign: -1, type: 'ADJUSTMENT', ref: 'Stock Adjustment', action: 'ADJUSTMENT' },
};
STOCK_MOVES.return = STOCK_MOVES.adjust_in;

async function stockMoveHandler(req, res) {
  const { batchId, type } = req.body;
  const move = STOCK_MOVES[type];
  const quantity = toPositiveInt(req.body.quantity);
  const reason = String(req.body.reason || '').trim().slice(0, 500);
  if (!batchId || !move) {
    return res.status(400).json({ success: false, message: 'batchId and a valid type are required.' });
  }
  if (!quantity) return res.status(400).json({ success: false, message: 'Enter a whole-number quantity above zero.' });
  if (move.reasonRequired && !reason) return res.status(400).json({ success: false, message: 'Enter the reason.' });

  const t = await sequelize.transaction();
  try {
    const batch = await lockBatch(batchId, t);
    if (!batch) throw httpError(404, 'Batch not found.');
    if (batch.IS_CONTROLLED === 1) throw httpError(409, 'Controlled-drug movements require the witnessed Medication workflows.');
    const current = Number(batch.QUANTITY || 0);
    if (move.sign < 0 && current < quantity) {
      throw httpError(400, `Only ${current} left in batch ${batch.BATCH_NUMBER}.`);
    }

    let referenceId = null;
    const details = { type, reason: reason || move.ref, batchNumber: batch.BATCH_NUMBER, medicineName: batch.GENERIC_NAME, quantity };

    if (type === 'vendor_return') {
      if (!batch.SUPPLIER_ID) throw httpError(400, `Batch ${batch.BATCH_NUMBER} has no supplier on record, so it cannot be returned to one.`);
      referenceId = batch.SUPPLIER_ID;
      details.supplierId = batch.SUPPLIER_ID;
    }

    if (type === 'patient_return') {
      // A return must match what left this batch for that patient (or for walk-in counter customers),
      // less what they already returned, so returns cannot inflate stock.
      const ref = String(req.body.patientId ?? '').trim();
      let patientId = null;
      if (ref) {
        const byId = /^\d+$/.test(ref);
        const [rows] = await sequelize.query(
          byId ? 'SELECT ID, UHID FROM HMS_PATIENTS WHERE ID = :ref' : 'SELECT ID, UHID FROM HMS_PATIENTS WHERE UPPER(UHID) = UPPER(:ref)',
          { replacements: { ref: byId ? Number(ref) : ref }, transaction: t }
        );
        if (!rows.length) throw httpError(400, `No patient found with UHID ${ref}.`);
        patientId = rows[0].ID;
        details.patientId = patientId;
        details.uhid = rows[0].UHID;
      }
      const [[issued]] = await sequelize.query(`
        SELECT
          COALESCE((SELECT SUM(di.QUANTITY) FROM HMS_DISPENSING_ITEMS di
                    JOIN HMS_DISPENSING_RECORDS dr ON dr.ID = di.DISPENSING_RECORD_ID
                    WHERE di.BATCH_ID = :batchId AND :patientId IS NOT NULL AND dr.PATIENT_ID = :patientId), 0)
          + COALESCE((SELECT SUM(oi.QUANTITY) FROM HMS_OTC_ITEMS oi
                    JOIN HMS_OTC_SALES os ON os.ID = oi.OTC_SALE_ID
                    WHERE oi.BATCH_ID = :batchId
                      AND ((:patientId IS NULL AND os.PATIENT_ID IS NULL) OR os.PATIENT_ID = :patientId)), 0) AS ISSUED,
          COALESCE((SELECT SUM(sl.QUANTITY) FROM HMS_STOCK_LEDGER sl
                    WHERE sl.BATCH_ID = :batchId AND sl.TRANSACTION_TYPE = 'RETURN' AND sl.REFERENCE_TYPE = 'Patient Return'
                      AND ((:patientId IS NULL AND sl.REFERENCE_ID IS NULL) OR sl.REFERENCE_ID = :patientId)), 0) AS RETURNED
      `, { replacements: { batchId: batch.ID, patientId }, transaction: t });
      const returnable = Number(issued.ISSUED || 0) - Number(issued.RETURNED || 0);
      if (quantity > returnable) {
        throw httpError(400, returnable > 0
          ? `Only ${returnable} from batch ${batch.BATCH_NUMBER} can be returned for ${patientId ? 'this patient' : 'walk-in customers'}.`
          : `Nothing from batch ${batch.BATCH_NUMBER} was issued to ${patientId ? 'this patient' : 'walk-in customers'}, so it cannot be returned.`);
      }
      referenceId = patientId;
    }

    // Patient-returned stock is quarantined, never returned to the pickable main balance.
    if (type !== 'patient_return') await setBatchQuantity(batch.ID, current + move.sign * quantity, t);
    const ledgerId = await addLedger(t, {
      medicineId: batch.MEDICINE_ID,
      batchId: batch.ID,
      type: move.type,
      quantity: move.type === 'ADJUSTMENT' ? move.sign * quantity : quantity,
      referenceType: move.ref,
      referenceId,
      userId: req.user.id,
    });
    if (type === 'patient_return') {
      const I = require('../services/medicationInventory');
      const [[quarantine]] = await sequelize.query("SELECT * FROM hms_med_locations WHERE code = 'QUARANTINE'", { transaction: t });
      await I.move(batch.ID, quarantine, String(quantity), 'LEGACY_RETURN', String(ledgerId), reason || 'Legacy patient return', req.user, t);
    }
    await auditInTransaction(t, { userId: req.user.id, action: move.action, module: 'pharmacy_stock', recordId: ledgerId, value: details, ip: req.ip });

    await publish('stock_updated', 'pharmacist', { reason: type }, { transaction: t });
    if (type === 'patient_return' || type === 'vendor_return') {
      await publish('return_processed', 'pharmacist', { ledgerId }, { transaction: t });
    }
    await t.commit();

    res.json({ success: true, status: 'success', message: `Stock ${type.replace('_', ' ')} recorded.`, ledgerId, batchQuantity: type === 'patient_return' ? current : current + move.sign * quantity, disposition: type === 'patient_return' ? 'QUARANTINED' : batch.LOT_STATUS });
  } catch (err) {
    await t.rollback();
    sendError(res, err, 'Operation failed.');
  }
}
router.post('/return', checkPermission('pharmacy', 'write'), stockMoveHandler);

// ─── GET /api/pharmacy/returns ──────────────────────────────────
// Patient and vendor returns, newest first, with the reason recorded at the time.
async function returnsListHandler(req, res) {
  try {
    const [rows] = await sequelize.query(`
      SELECT sl.ID, sl.TRANSACTION_TYPE, sl.QUANTITY, sl.REFERENCE_TYPE, sl.REFERENCE_ID, sl.TRANSACTION_DATE,
             b.BATCH_NUMBER, b.MRP, b.PURCHASE_RATE,
             m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT,
             s.NAME AS SUPPLIER_NAME, p.NAME AS PATIENT_NAME, p.UHID,
             u.NAME AS PERFORMED_BY_NAME,
             (SELECT a.NEW_VALUE FROM HMS_AUDIT_LOGS a
              WHERE a.MODULE = 'pharmacy_stock' AND a.RECORD_ID = sl.ID
              ORDER BY a.ID DESC LIMIT 1) AS DETAILS
      FROM HMS_STOCK_LEDGER sl
      JOIN HMS_MEDICINE_BATCHES b ON b.ID = sl.BATCH_ID
      JOIN HMS_MEDICINES m ON m.ID = sl.MEDICINE_ID
      LEFT JOIN HMS_SUPPLIERS s ON s.ID = sl.REFERENCE_ID AND sl.REFERENCE_TYPE = 'Vendor Return'
      LEFT JOIN HMS_PATIENTS p ON p.ID = sl.REFERENCE_ID AND sl.REFERENCE_TYPE = 'Patient Return'
      LEFT JOIN HMS_USERS u ON u.ID = sl.PERFORMED_BY
      WHERE (sl.TRANSACTION_TYPE = 'RETURN' AND sl.REFERENCE_TYPE = 'Patient Return')
         OR (sl.TRANSACTION_TYPE = 'DISCARD' AND sl.REFERENCE_TYPE = 'Vendor Return')
      ORDER BY sl.TRANSACTION_DATE DESC, sl.ID DESC
      LIMIT 500
    `);
    const data = rows.map((r) => {
      const isVendor = r.REFERENCE_TYPE === 'Vendor Return';
      let details = {};
      try { details = r.DETAILS ? JSON.parse(r.DETAILS) : {}; } catch { details = {}; }
      const qty = Number(r.QUANTITY || 0);
      const unit = Number((isVendor ? r.PURCHASE_RATE : r.MRP) || 0);
      const strength = [r.STRENGTH, r.STRENGTH_UNIT].filter(Boolean).join(' ');
      return {
        id: `RET-${r.ID}`,
        ledgerId: r.ID,
        date: r.TRANSACTION_DATE,
        type: isVendor ? 'Vendor return' : 'Patient return',
        entity: isVendor
          ? (r.SUPPLIER_NAME || 'Supplier')
          : (r.PATIENT_NAME ? `${r.PATIENT_NAME}${r.UHID ? ` (${r.UHID})` : ''}` : 'Walk-in customer'),
        medicineName: r.GENERIC_NAME,
        batchNumber: r.BATCH_NUMBER,
        quantity: qty,
        items: `${r.GENERIC_NAME}${strength ? ` ${strength}` : ''} · batch ${r.BATCH_NUMBER} · ${qty}`,
        reason: details.reason || '',
        value: round2(qty * unit),
        status: isVendor ? 'Returned to supplier' : 'Restocked',
        recordedBy: r.PERFORMED_BY_NAME || null,
      };
    });
    res.json({ success: true, status: 'success', data });
  } catch (err) {
    console.error('Returns list error:', err);
    res.status(500).json({ success: false, status: 'error', message: 'Failed to fetch returns.' });
  }
}
router.get('/returns', checkPermission('pharmacy', 'read'), returnsListHandler);

// ─── GET /api/pharmacy/stock-ledger/:medicineId ─────────────────
router.get('/stock-ledger/:medicineId', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const medicineId = req.params.medicineId;
    const [rows] = await sequelize.query(`
      SELECT sl.ID, sl.TRANSACTION_TYPE, sl.QUANTITY, sl.REFERENCE_TYPE,
             sl.REFERENCE_ID, sl.TRANSACTION_DATE,
             COALESCE(b.BATCH_NUMBER, 'N/A') as BATCH_NUMBER, u.NAME as PERFORMED_BY_NAME
      FROM HMS_STOCK_LEDGER sl
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.ID = sl.BATCH_ID
      LEFT JOIN HMS_USERS u ON u.ID = sl.PERFORMED_BY
      WHERE sl.MEDICINE_ID = :medicineId
      ORDER BY sl.TRANSACTION_DATE DESC, sl.ID DESC
    `, { replacements: { medicineId } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Stock ledger error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger.' });
  }
});

// ─── GET /api/pharmacy/issued-meds ───────────────────────────────
// Patients are stored with NAME (FIRST_NAME/LAST_NAME are often empty), and counter sales carry the
// patient on HMS_OTC_SALES, so both are looked up.
router.get('/issued-meds', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const { name, formulation, strength } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });

    const [rows] = await sequelize.query(`
      SELECT sl.ID, sl.QUANTITY, sl.TRANSACTION_DATE, sl.REFERENCE_TYPE,
             COALESCE(b.BATCH_NUMBER, 'N/A') as BATCH_NUMBER,
             u.NAME as PERFORMED_BY_NAME,
             COALESCE(p.NAME, TRIM(COALESCE(p.FIRST_NAME, '') || ' ' || COALESCE(p.LAST_NAME, ''))) as PATIENT_NAME,
             p.UHID as PATIENT_UHID,
             dr.ID as DISPENSING_ID
      FROM HMS_STOCK_LEDGER sl
      JOIN HMS_MEDICINES m ON m.ID = sl.MEDICINE_ID
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.ID = sl.BATCH_ID
      LEFT JOIN HMS_USERS u ON u.ID = sl.PERFORMED_BY
      LEFT JOIN HMS_DISPENSING_RECORDS dr ON dr.ID = sl.REFERENCE_ID AND sl.REFERENCE_TYPE = 'DISPENSING'
      LEFT JOIN HMS_OTC_SALES os ON os.ID = sl.REFERENCE_ID AND sl.REFERENCE_TYPE = 'OTC'
      LEFT JOIN HMS_PATIENTS p ON p.ID = COALESCE(dr.PATIENT_ID, os.PATIENT_ID)
      WHERE sl.TRANSACTION_TYPE = 'OUT'
        AND UPPER(m.GENERIC_NAME) = UPPER(:name)
        AND (m.FORMULATION = :formulation OR :formulation IS NULL)
        AND (m.STRENGTH = :strength OR :strength IS NULL)
      ORDER BY sl.TRANSACTION_DATE DESC
    `, { replacements: {
      name,
      formulation: formulation || null,
      strength: strength || null,
    } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Issued meds error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch issued meds.' });
  }
});

// Shared with the legacy /api/pharmacist_lms namespace so both paths apply the same checks.
router.handlers = { dispenseHandler, dispenseQueueHandler, stockMoveHandler, returnsListHandler };

module.exports = router;
