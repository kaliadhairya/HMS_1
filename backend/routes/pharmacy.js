const express = require('express');
const router = express.Router();
const { sequelize } = require('../models/db');
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
  return row.NEXTVAL;
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

router.use(protect);

// ─── GET /api/pharmacy/medicines/:id/batches ────────────────────
router.get('/medicines/:id/batches', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const { id } = req.params;
    const { Op } = require('sequelize');
    const batches = await MedicineBatch.findAll({
      where: { 
        medicineId: id,
        quantity: { [Op.gt]: 0 }
      },
      order: [['EXPIRY_DATE', 'ASC']] // FEFO
    });
    res.json({ success: true, data: batches });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── GET /api/pharmacy/stock (Consolidated: one row per medicine NAME) ──
router.get('/stock', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const [rows] = await sequelize.query(`
      SELECT MIN(m.ID) as ID,
             m.GENERIC_NAME, m.FORMULATION, m.STRENGTH, m.STRENGTH_UNIT,
             COUNT(b.ID) as BATCH_COUNT,
             COALESCE(SUM(b.QUANTITY), 0) as TOTAL_QUANTITY,
             MIN(b.EXPIRY_DATE) as NEAREST_EXPIRY,
             MAX(b.EXPIRY_DATE) as FARTHEST_EXPIRY,
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
             b.QUANTITY, b.MRP, b.PURCHASE_RATE,
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
             b.QUANTITY, b.MRP, b.PURCHASE_RATE,
             s.NAME as SUPPLIER_NAME
      FROM HMS_MEDICINE_BATCHES b
      LEFT JOIN HMS_SUPPLIERS s ON s.ID = b.SUPPLIER_ID
      WHERE b.MEDICINE_ID = :medicineId
      ORDER BY b.EXPIRY_DATE ASC
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
             b.MRP, s.NAME as SUPPLIER_NAME
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
router.post('/grn', [
  body('invoiceNumber').optional({ checkFalsy: true }).trim().escape(),
], checkPermission('pharmacy', 'write'), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const t = await sequelize.transaction();
  try {
    const { supplierId, invoiceNumber, invoiceDate, items, prId, isPartialDelivery } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided.' });
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
    for (const item of items) {
      const itemGst = (item.quantity * item.purchaseRate * (item.gstRate || 0)) / 100;
      const itemAmount = (item.quantity * item.purchaseRate) + itemGst;
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
          gstRate: item.gstRate || 0,
          gstAmount: itemGst,
          amount: itemAmount,
        },
        transaction: t,
      });

      // Check if batch exists (same medicine + batch number)
      const existingBatches = await MedicineBatch.findAll({
        where: { medicineId: item.medicineId, batchNumber: item.batchNumber },
        transaction: t,
      });
      const existingBatch = existingBatches.length > 0 ? existingBatches[0] : null;

      let batchId;
      if (existingBatch) {
        await existingBatch.update({
          quantity: existingBatch.quantity + item.quantity,
        }, { transaction: t });
        batchId = existingBatch.id;
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

      // Stock ledger entry
      const stockLedgerId = await nextval('HMS_STOCK_LEDGER_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_STOCK_LEDGER (
          ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
          REFERENCE_TYPE, REFERENCE_ID, TRANSACTION_DATE, PERFORMED_BY
        ) VALUES (
          :id, :medicineId, :batchId, 'IN', :quantity,
          'GRN', :referenceId, CURRENT_TIMESTAMP, :performedBy
        )
      `, {
        replacements: {
          id: stockLedgerId,
          medicineId: item.medicineId,
          batchId,
          quantity: item.quantity,
          referenceId: po.id,
          performedBy: req.user.id,
        },
        transaction: t,
      });
    }

    // Update PO totals
    await sequelize.query(`
      UPDATE HMS_PURCHASE_ORDERS
      SET TOTAL_AMOUNT = :totalAmount, GST_AMOUNT = :gstAmount
      WHERE ID = :id
    `, {
      replacements: { id: po.id, totalAmount, gstAmount: totalGst },
      transaction: t,
    });

    await t.commit();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'pharmacy', po.id, null, { action: 'grn_received', itemsProcessed: items.length }, ip);

    res.json({ success: true, purchaseOrderId: po.id, itemsProcessed: items.length });
  } catch (err) {
    await t.rollback();
    console.error('GRN error:', err);
    res.status(500).json({ success: false, message: 'GRN processing failed.' });
  }
});

// ─── GET /api/pharmacy/dispense-queue ───────────────────────────
router.get('/dispense-queue', checkPermission('pharmacy', 'read'), async (req, res) => {
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
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Dispense queue error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch dispense queue.' });
  }
});

// ─── POST /api/pharmacy/dispense (Unified Transactional) ────────
router.post('/dispense', checkPermission('pharmacy', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { prescriptionId, items } = req.body;
    const userId = req.user.id;
    const { Admission } = require('../models');

    // 1. Get Prescription Context
    const prescription = await Prescription.findByPk(prescriptionId, {
      include: [{ model: Patient, as: 'patient' }],
      transaction: t,
    });
    if (!prescription) throw new Error('Prescription not found');

    const patientId = prescription.patient_id;

    // 2. Identify Billing Context (IPD vs OPD)
    const activeAdmissions = await Admission.findAll({
      where: { patientId, status: 'Active' },
      transaction: t,
    });
    const activeAdmission = activeAdmissions.length > 0 ? activeAdmissions[0] : null;

    let billId = null;
    if (activeAdmission) {
      billId = await findPendingBill({ admissionId: activeAdmission.id }, t);
    } else {
      billId = await findPendingBill({ encounterId: prescription.encounter_id }, t);
    }

    if (!billId) {
      billId = await nextval('HMS_BILLS_SEQ', t);
      const billNumber = `BILL-${billId}`;
      await sequelize.query(`
        INSERT INTO HMS_BILLS (
          ID, PATIENT_ID, ADMISSION_ID, ENCOUNTER_ID, BILL_TYPE, BILL_NUMBER, STATUS,
          TOTAL_AMOUNT, DISCOUNT_AMOUNT, GST_AMOUNT, NET_PAYABLE, ADVANCE_ADJUSTED,
          CREATED_BY, CREATED_AT, UPDATED_AT
        ) VALUES (
          :id, :patientId, :admissionId, :encounterId, :billType, :billNumber, 'Pending',
          0, 0, 0, 0, 0,
          :createdBy, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, {
        replacements: {
          id: billId,
          patientId,
          admissionId: activeAdmission?.id || null,
          encounterId: activeAdmission ? null : prescription.encounter_id,
          billType: activeAdmission ? 'IPD' : 'OPD',
          billNumber,
          createdBy: userId,
        },
        transaction: t,
      });
    }

    // 3. Create Dispensing Record
    const totalDispenseAmount = (items || []).reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const dispRecordId = await nextval('HMS_DISPENSING_RECORDS_SEQ', t);
    await sequelize.query(`
      INSERT INTO HMS_DISPENSING_RECORDS (
        ID, PRESCRIPTION_ID, PATIENT_ID, DISPENSED_BY, DISPENSED_AT, TOTAL_AMOUNT, BILL_ID
      ) VALUES (
        :id, :prescriptionId, :patientId, :dispensedBy, :dispensedAt, :totalAmount, :billId
      )
    `, {
      replacements: {
        id: dispRecordId,
        prescriptionId,
        patientId,
        dispensedBy: userId,
        dispensedAt: new Date(),
        totalAmount: totalDispenseAmount,
        billId,
      },
      transaction: t,
    });
    const dispRecord = { id: dispRecordId };

    // 4. Process Each Item (Stock + Bill Item)
    if (items && items.length > 0) {
      for (const item of items) {
        // Deduct Stock
        const batch = await MedicineBatch.findByPk(item.batchId, { transaction: t });
        if (!batch || batch.quantity < item.quantity) {
          throw new Error(`Insufficient stock for medicine: ${item.medicineName || 'ID ' + item.medicineId}`);
        }
        await batch.update({ quantity: batch.quantity - item.quantity }, { transaction: t });

        // Create Stock Ledger entry
        const stockLedgerId = await nextval('HMS_STOCK_LEDGER_SEQ', t);
        await sequelize.query(`
          INSERT INTO HMS_STOCK_LEDGER (
            ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
            REFERENCE_TYPE, REFERENCE_ID, TRANSACTION_DATE, PERFORMED_BY
          ) VALUES (
            :id, :medicineId, :batchId, 'OUT', :quantity,
            'DISPENSING', :referenceId, :transactionDate, :performedBy
          )
        `, {
          replacements: {
            id: stockLedgerId,
            medicineId: item.medicineId,
            batchId: item.batchId,
            quantity: item.quantity,
            referenceId: dispRecord.id,
            transactionDate: new Date(),
            performedBy: userId,
          },
          transaction: t,
        });

        // Create DispensingItem
        const dispensingItemId = await nextval('HMS_DISPENSING_ITEMS_SEQ', t);
        await sequelize.query(`
          INSERT INTO HMS_DISPENSING_ITEMS (
            ID, DISPENSING_RECORD_ID, MEDICINE_ID, BATCH_ID, QUANTITY, RATE, AMOUNT
          ) VALUES (
            :id, :dispensingRecordId, :medicineId, :batchId, :quantity, :rate, :amount
          )
        `, {
          replacements: {
            id: dispensingItemId,
            dispensingRecordId: dispRecord.id,
            medicineId: item.medicineId,
            batchId: item.batchId,
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
          },
          transaction: t,
        });

        // Add to Bill
        const billItemId = await nextval('HMS_BILL_ITEMS_SEQ', t);
        await sequelize.query(`
          INSERT INTO HMS_BILL_ITEMS (
            ID, BILL_ID, ITEM_TYPE, ITEM_NAME, QUANTITY, RATE, GST_RATE, GST_AMOUNT, AMOUNT, SERVICE_DATE
          ) VALUES (
            :id, :billId, :itemType, :itemName, :quantity, :rate, 0, 0, :amount, :serviceDate
          )
        `, {
          replacements: {
            id: billItemId,
            billId,
            itemType: 'Medicine',
            itemName: item.medicineName || 'Pharmacy Medicine',
            quantity: item.quantity,
            rate: item.rate,
            amount: item.amount,
            serviceDate: new Date(),
          },
          transaction: t,
        });
      }
    }

    // 5. Update Bill Totals
    const [billTotals] = await sequelize.query(`
      SELECT COALESCE(SUM(AMOUNT), 0) AS TOTAL_AMOUNT
      FROM HMS_BILL_ITEMS
      WHERE BILL_ID = :billId
    `, {
      replacements: { billId },
      transaction: t,
    });
    const newTotal = Number(billTotals[0]?.total_amount ?? billTotals[0]?.TOTAL_AMOUNT ?? 0);
    await sequelize.query(`
      UPDATE HMS_BILLS
      SET TOTAL_AMOUNT = :totalAmount,
          NET_PAYABLE = :netPayable,
          UPDATED_AT = CURRENT_TIMESTAMP
      WHERE ID = :billId
    `, {
      replacements: {
        billId,
        totalAmount: newTotal,
        netPayable: newTotal,
      },
      transaction: t,
    });

    // 6. Mark Prescription as Dispensed
    await Prescription.update({ status: 'Dispensed' }, { where: { id: prescriptionId }, transaction: t });

    await t.commit();

    // 7. Real-time Events
    const io = req.app.get('io');
    if (io) {
      io.to('pharmacist').emit('stock_updated', { reason: 'dispensed' });
      io.to('receptionist').emit('billing_updated', { patientId, billId });
      io.to('doctor').emit('prescription_dispensed', { prescriptionId });
    }

    res.json({ success: true, message: 'Prescription dispensed and billing updated successfully.' });
  } catch (err) {
    if (t) await t.rollback();
    console.error('Dispensing Error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/pharmacy/otc ────────────────────────────────────
router.post('/otc', checkPermission('pharmacy', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { patientId, items, paymentMode } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ success: false, message: 'No items provided.' });
    }

    // Generate bill number
    const billNumber = `OTC-${Date.now()}`;

    const saleId = await nextval('HMS_OTC_SALES_SEQ', t);
    await sequelize.query(`
      INSERT INTO HMS_OTC_SALES (
        ID, PATIENT_ID, SOLD_BY, SOLD_AT, TOTAL_AMOUNT, PAYMENT_MODE, BILL_NUMBER
      ) VALUES (
        :id, :patientId, :soldBy, CURRENT_TIMESTAMP, 0, :paymentMode, :billNumber
      )
    `, {
      replacements: {
        id: saleId,
        patientId: patientId || null,
        soldBy: req.user.id,
        paymentMode: paymentMode || 'Cash',
        billNumber,
      },
      transaction: t,
    });
    const sale = { id: saleId };

    let totalAmount = 0;

    for (const item of items) {
      // Get batch info for rate
      const batch = await MedicineBatch.findByPk(item.batchId, { transaction: t });
      if (!batch || batch.quantity < item.quantity) {
        await t.rollback();
        return res.status(400).json({ success: false, message: `Insufficient stock for batch ${item.batchId}.` });
      }

      const rate = batch.mrp || 0;
      const medicine = await Medicine.findByPk(item.medicineId, { transaction: t });
      const gstRate = medicine?.gstRate || 0;
      const baseAmount = item.quantity * rate;
      const gstAmount = (baseAmount * gstRate) / 100;
      const amount = baseAmount + gstAmount;
      totalAmount += amount;

      const otcItemId = await nextval('HMS_OTC_ITEMS_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_OTC_ITEMS (
          ID, OTC_SALE_ID, MEDICINE_ID, BATCH_ID, QUANTITY, RATE, GST_AMOUNT, AMOUNT
        ) VALUES (
          :id, :otcSaleId, :medicineId, :batchId, :quantity, :rate, :gstAmount, :amount
        )
      `, {
        replacements: {
          id: otcItemId,
          otcSaleId: sale.id,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: item.quantity,
          rate,
          gstAmount,
          amount,
        },
        transaction: t,
      });

      // Deduct stock
      await batch.update({ quantity: batch.quantity - item.quantity }, { transaction: t });

      // Stock ledger
      const stockLedgerId = await nextval('HMS_STOCK_LEDGER_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_STOCK_LEDGER (
          ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
          REFERENCE_TYPE, REFERENCE_ID, TRANSACTION_DATE, PERFORMED_BY
        ) VALUES (
          :id, :medicineId, :batchId, 'OUT', :quantity,
          'OTC', :referenceId, CURRENT_TIMESTAMP, :performedBy
        )
      `, {
        replacements: {
          id: stockLedgerId,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: item.quantity,
          referenceId: sale.id,
          performedBy: req.user.id,
        },
        transaction: t,
      });
    }

    await sequelize.query(`
      UPDATE HMS_OTC_SALES
      SET TOTAL_AMOUNT = :totalAmount
      WHERE ID = :id
    `, {
      replacements: { id: sale.id, totalAmount },
      transaction: t,
    });
    await t.commit();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'CREATE', 'pharmacy', sale.id, null, { action: 'otc_sale', billNumber }, ip);

    res.json({ success: true, saleId: sale.id, billNumber, totalAmount });
  } catch (err) {
    await t.rollback();
    console.error('OTC sale error:', err);
    res.status(500).json({ success: false, message: 'OTC sale failed.' });
  }
});

// ─── POST /api/pharmacy/return ──────────────────────────────────
router.post('/return', checkPermission('pharmacy', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { batchId, quantity, type, reason } = req.body;
    if (!batchId || !quantity || !type) {
      return res.status(400).json({ success: false, message: 'batchId, quantity, type are required.' });
    }

    const batch = await MedicineBatch.findByPk(batchId, { transaction: t });
    if (!batch) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Batch not found.' });
    }

    if (type === 'return') {
      await batch.update({ quantity: batch.quantity + quantity }, { transaction: t });
      const stockLedgerId = await nextval('HMS_STOCK_LEDGER_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_STOCK_LEDGER (
          ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
          REFERENCE_TYPE, TRANSACTION_DATE, PERFORMED_BY
        ) VALUES (
          :id, :medicineId, :batchId, 'RETURN', :quantity,
          'Return', CURRENT_TIMESTAMP, :performedBy
        )
      `, {
        replacements: {
          id: stockLedgerId,
          medicineId: batch.medicineId,
          batchId: batch.id,
          quantity,
          performedBy: req.user.id,
        },
        transaction: t,
      });
    } else if (type === 'discard') {
      if (batch.quantity < quantity) {
        await t.rollback();
        return res.status(400).json({ success: false, message: 'Insufficient stock to discard.' });
      }
      await batch.update({ quantity: batch.quantity - quantity }, { transaction: t });
      const stockLedgerId = await nextval('HMS_STOCK_LEDGER_SEQ', t);
      await sequelize.query(`
        INSERT INTO HMS_STOCK_LEDGER (
          ID, MEDICINE_ID, BATCH_ID, TRANSACTION_TYPE, QUANTITY,
          REFERENCE_TYPE, TRANSACTION_DATE, PERFORMED_BY
        ) VALUES (
          :id, :medicineId, :batchId, 'DISCARD', :quantity,
          'Discard', CURRENT_TIMESTAMP, :performedBy
        )
      `, {
        replacements: {
          id: stockLedgerId,
          medicineId: batch.medicineId,
          batchId: batch.id,
          quantity,
          performedBy: req.user.id,
        },
        transaction: t,
      });
    }

    await t.commit();

    const ip = req.ip || req.connection?.remoteAddress || null;
    await logAction(req.user.id, 'UPDATE', 'pharmacy', batchId, null, { action: type, quantity, reason }, ip);

    res.json({ success: true, message: `Stock ${type} processed.` });
  } catch (err) {
    await t.rollback();
    console.error('Return/discard error:', err);
    res.status(500).json({ success: false, message: 'Operation failed.' });
  }
});

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
      ORDER BY sl.TRANSACTION_DATE DESC
    `, { replacements: { medicineId } });
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Stock ledger error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch ledger.' });
  }
});

// ─── GET /api/pharmacy/issued-meds ───────────────────────────────
router.get('/issued-meds', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const { name, formulation, strength } = req.query;
    if (!name) return res.status(400).json({ success: false, message: 'name is required.' });

    const [rows] = await sequelize.query(`
      SELECT sl.ID, sl.QUANTITY, sl.TRANSACTION_DATE, sl.REFERENCE_TYPE,
             COALESCE(b.BATCH_NUMBER, 'N/A') as BATCH_NUMBER,
             u.NAME as PERFORMED_BY_NAME,
             p.FIRST_NAME || ' ' || p.LAST_NAME as PATIENT_NAME,
             p.UHID as PATIENT_UHID,
             dr.ID as DISPENSING_ID
      FROM HMS_STOCK_LEDGER sl
      JOIN HMS_MEDICINES m ON m.ID = sl.MEDICINE_ID
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.ID = sl.BATCH_ID
      LEFT JOIN HMS_USERS u ON u.ID = sl.PERFORMED_BY
      LEFT JOIN HMS_DISPENSING_RECORDS dr ON dr.ID = sl.REFERENCE_ID AND sl.REFERENCE_TYPE = 'DISPENSING'
      LEFT JOIN HMS_PATIENTS p ON p.ID = dr.PATIENT_ID
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

module.exports = router;
