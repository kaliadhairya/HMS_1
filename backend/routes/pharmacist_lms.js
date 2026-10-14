const express = require('express');
const router = express.Router();
const {
  Prescription, PrescriptionItem, Patient, User,
  Supplier, PurchaseOrder, PurchaseItem,
  DispensingRecord, DispensingItem, MedicineBatch, Medicine,
  Bill, BillItem, Admission, StockLedger,
} = require('../models');
const { sequelize } = require('../models/db');
const { checkPermission } = require('../middleware/auth');
const pharmacy = require('./pharmacy');


// ═══════════════════════════════════════════════════════════
// 1. Supplier Master — LIVE DB
// ═══════════════════════════════════════════════════════════
router.get('/suppliers', async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({ order: [['ID', 'DESC']] });
    const mapped = suppliers.map((supplier) => ({
      id: supplier.id ?? supplier.ID,
      name: supplier.name ?? supplier.NAME,
      contact: supplier.contact_person ?? supplier.CONTACT_PERSON ?? supplier.phone ?? supplier.PHONE ?? '-',
      license: supplier.license_no ?? supplier.LICENSE_NO ?? '-',
      paymentTerms: supplier.payment_terms ?? supplier.PAYMENT_TERMS ?? '-',
      leadTime: supplier.lead_time_days ?? supplier.LEAD_TIME_DAYS ?? '-',
      rating: supplier.rating ?? 0,
    }));
    res.json({ status: 'success', data: mapped, source: 'live' });
  } catch (err) {
    console.error('Suppliers fetch failed:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 2. Purchase Orders — LIVE DB
// ═══════════════════════════════════════════════════════════
router.get('/purchase-orders', async (req, res) => {
  try {
    const orders = await PurchaseOrder.findAll({
      include: [{ model: Supplier, as: 'supplier', attributes: ['ID', 'NAME'] }],
      order: [['ID', 'DESC']],
    });
    const mapped = orders.map(o => ({
      id: `PR-2026-${String(o.id).padStart(3, '0')}`,
      date: o.orderDate ? new Date(o.orderDate).toISOString().split('T')[0] : '---',
      supplier: o.supplier?.NAME || 'Unknown',
      value: o.totalAmount?.toLocaleString() || '0',
      expectedDelivery: o.expectedDelivery ? new Date(o.expectedDelivery).toISOString().split('T')[0] : 'N/A',
      status: o.status || 'Pending Approval',
    }));
    res.json({ status: 'success', data: mapped, source: 'live' });
  } catch (err) {
    console.error('PO fetch failed:', err.message);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/purchase-orders', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { supplierId, expectedDelivery, notes, items, grandTotal } = req.body;
    
    // Get next ID
    const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_po_seq') AS \"NEXTVAL\"");
    
    // Create Purchase Order (Purchase Request)
    const pr = await PurchaseOrder.create({
      id: nextId,
      supplierId: supplierId,
      orderDate: new Date(),
      expectedDelivery: expectedDelivery ? new Date(expectedDelivery) : null,
      remarks: notes,
      totalAmount: grandTotal,
      status: 'Pending Approval',
      createdBy: req.user?.id || 1
    }, { transaction: t });

    // Create Items
    if (items && items.length > 0) {
      for (const item of items) {
        const [[{ NEXTVAL: itemNextId }]] = await sequelize.query("SELECT nextval('hms_pi_seq') AS \"NEXTVAL\"");
        await PurchaseItem.create({
          id: itemNextId,
          purchaseOrderId: pr.id,
          medicineId: item.id,
          quantity: item.qty,
          purchaseRate: item.unitPrice,
          gstRate: item.gstRate,
          amount: item.total
        }, { transaction: t });
      }
    }

    await t.commit();
    res.status(201).json({ status: 'success', message: 'Purchase Request created successfully', data: pr });
  } catch (err) {
    await t.rollback();
    console.error('Error creating PR:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});


// ═══════════════════════════════════════════════════════════
// 2b. Single Purchase Request — Fetch details for GRN
// ═══════════════════════════════════════════════════════════
router.get('/purchase-orders/:id', async (req, res) => {
  try {
    const prId = req.params.id;

    // Fetch the PR with supplier
    const pr = await PurchaseOrder.findByPk(prId, {
      include: [
        { model: Supplier, as: 'supplier', attributes: ['id', 'name', 'contactPerson', 'phone', 'supplierNumber'] },
        { model: PurchaseItem, as: 'items', include: [{ model: Medicine, as: 'medicine', attributes: ['id', 'genericName', 'formulation', 'strength', 'strengthUnit', 'gstRate'] }] },
      ],
    });

    if (!pr) {
      return res.status(404).json({ status: 'error', message: 'Purchase Request not found.' });
    }

    const mapped = {
      id: pr.id,
      prNumber: `PR-2026-${String(pr.id).padStart(3, '0')}`,
      date: pr.orderDate ? new Date(pr.orderDate).toISOString().split('T')[0] : '---',
      status: pr.status,
      totalAmount: pr.totalAmount,
      expectedDelivery: pr.expectedDelivery ? new Date(pr.expectedDelivery).toISOString().split('T')[0] : null,
      remarks: pr.remarks,
      supplier: pr.supplier ? {
        id: pr.supplier.id,
        name: pr.supplier.name,
        contactPerson: pr.supplier.contactPerson,
        phone: pr.supplier.phone,
        supplierNumber: pr.supplier.supplierNumber,
      } : null,
      items: (pr.items || []).map(item => ({
        id: item.id,
        medicineId: item.medicineId,
        genericName: item.medicine?.genericName || 'Unknown',
        formulation: item.medicine?.formulation || '',
        strength: item.medicine?.strength || '',
        strengthUnit: item.medicine?.strengthUnit || '',
        quantity: item.quantity,
        purchaseRate: item.purchaseRate,
        gstRate: item.gstRate,
        amount: item.amount,
      })),
    };

    res.json({ status: 'success', data: mapped });
  } catch (err) {
    console.error('Error fetching PR:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 3. Dispense Queue — LIVE from Prescriptions table
// ═══════════════════════════════════════════════════════════
// Same queue as GET /api/pharmacy/dispense-queue. (This copy looked for status 'Pending' and a
// PRESCRIPTION_DATE column that does not exist, so it always answered an empty list.)
router.get('/dispense-queue', checkPermission('pharmacy', 'read'), pharmacy.handlers.dispenseQueueHandler);

// Dispense action — same handler as POST /api/pharmacy/dispense (prescription lock, one dispense per
// prescription, MRP from the batch, not-dispensed lines recorded). This copy used to dispense any
// prescription any number of times and trusted the client's rate and amount.
router.post('/dispense', checkPermission('pharmacy', 'write'), pharmacy.handlers.dispenseHandler);

// Get available batches for a medicine (FEFO: First Expiry First Out)
router.get('/medicines/:id/batches', async (req, res) => {
  try {
    const { id } = req.params;
    const { Op } = require('sequelize');

    const batches = await MedicineBatch.findAll({
      where: {
        medicineId: id,
        quantity: { [Op.gt]: 0 },
        expiryDate: { [Op.gte]: sequelize.literal('hms_service_today()') },
        [Op.and]: sequelize.literal("LOT_STATUS = 'AVAILABLE'"),
      },
      order: [['EXPIRY_DATE', 'ASC'], ['ID', 'ASC']]
    });
    res.json({ status: 'success', data: batches });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 4. Returns Management — stock ledger rows (see POST /api/pharmacy/return)
// ═══════════════════════════════════════════════════════════
router.get('/returns', checkPermission('pharmacy', 'read'), pharmacy.handlers.returnsListHandler);

// { batchId, quantity, type: 'patient_return' | 'vendor_return', reason, patientId? }
router.post('/returns', checkPermission('pharmacy', 'write'), (req, res, next) => {
  if (!['patient_return', 'vendor_return'].includes(req.body?.type)) {
    return res.status(400).json({ success: false, status: 'error', message: 'type must be patient_return or vendor_return.' });
  }
  return pharmacy.handlers.stockMoveHandler(req, res, next);
});

// ═══════════════════════════════════════════════════════════
// 5. Reports & Analytics — computed from dispensing, counter sales, batches and the stock ledger
// ═══════════════════════════════════════════════════════════
const LOW_STOCK_THRESHOLD = 10;
const EXPIRY_WINDOW_DAYS = 30;
const SLOW_MOVING_DAYS = 30;
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

async function buildPharmacyReport(days) {
  const run = async (sql, replacements = {}) => (await sequelize.query(sql, { replacements }))[0];
  const since = { days };

  const [[dispPeriod], [dispToday], [otcPeriod], [otcToday]] = await Promise.all([
    run(`SELECT COUNT(*) AS RECORDS, COALESCE(SUM(dr.TOTAL_AMOUNT), 0) AS AMOUNT,
                COALESCE((SELECT SUM(di.QUANTITY) FROM HMS_DISPENSING_ITEMS di
                          JOIN HMS_DISPENSING_RECORDS d2 ON d2.ID = di.DISPENSING_RECORD_ID
                          WHERE d2.DISPENSED_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)), 0) AS UNITS
         FROM HMS_DISPENSING_RECORDS dr WHERE dr.DISPENSED_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)`, since),
    run(`SELECT COUNT(*) AS RECORDS, COALESCE(SUM(TOTAL_AMOUNT), 0) AS AMOUNT
         FROM HMS_DISPENSING_RECORDS WHERE DISPENSED_AT >= hms_service_day_start()`),
    run(`SELECT COUNT(*) AS RECORDS, COALESCE(SUM(os.TOTAL_AMOUNT), 0) AS AMOUNT,
                COALESCE((SELECT SUM(oi.QUANTITY) FROM HMS_OTC_ITEMS oi
                          JOIN HMS_OTC_SALES o2 ON o2.ID = oi.OTC_SALE_ID
                          WHERE o2.SOLD_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)), 0) AS UNITS
         FROM HMS_OTC_SALES os WHERE os.SOLD_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)`, since),
    run(`SELECT COUNT(*) AS RECORDS, COALESCE(SUM(TOTAL_AMOUNT), 0) AS AMOUNT
         FROM HMS_OTC_SALES WHERE SOLD_AT >= hms_service_day_start()`),
  ]);

  const topMedicines = await run(`
    SELECT m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT,
           SUM(x.QTY) AS UNITS, SUM(x.AMOUNT) AS AMOUNT
    FROM (
      SELECT di.MEDICINE_ID, di.QUANTITY AS QTY, di.AMOUNT
      FROM HMS_DISPENSING_ITEMS di
      JOIN HMS_DISPENSING_RECORDS dr ON dr.ID = di.DISPENSING_RECORD_ID
      WHERE dr.DISPENSED_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)
      UNION ALL
      SELECT oi.MEDICINE_ID, oi.QUANTITY AS QTY, oi.AMOUNT
      FROM HMS_OTC_ITEMS oi
      JOIN HMS_OTC_SALES os ON os.ID = oi.OTC_SALE_ID
      WHERE os.SOLD_AT >= hms_service_day_start() - make_interval(days => (:days - 1)::integer)
    ) x
    JOIN HMS_MEDICINES m ON m.ID = x.MEDICINE_ID
    GROUP BY m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT
    ORDER BY UNITS DESC, AMOUNT DESC, m.GENERIC_NAME ASC
    LIMIT 10
  `, since);

  // Same rule as the pharmacist dashboard: active medicines with 10 or fewer units across all batches.
  const lowStock = await run(`
    SELECT m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT, COALESCE(SUM(b.QUANTITY), 0) AS TOTAL_QTY
    FROM HMS_MEDICINES m
    LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
    WHERE m.IS_ACTIVE = 1
    GROUP BY m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT
    HAVING COALESCE(SUM(b.QUANTITY), 0) <= :threshold
    ORDER BY TOTAL_QTY ASC, m.GENERIC_NAME ASC
  `, { threshold: LOW_STOCK_THRESHOLD });

  // Batches with stock that have expired or expire within 30 days.
  const expiring = await run(`
    SELECT b.ID AS BATCH_ID, b.BATCH_NUMBER, b.EXPIRY_DATE, b.QUANTITY, m.ID AS MEDICINE_ID, m.GENERIC_NAME,
           (b.EXPIRY_DATE < hms_service_today()) AS IS_EXPIRED
    FROM HMS_MEDICINE_BATCHES b
    JOIN HMS_MEDICINES m ON m.ID = b.MEDICINE_ID
    WHERE b.QUANTITY > 0 AND b.EXPIRY_DATE <= hms_service_today() + :window
    ORDER BY b.EXPIRY_DATE ASC, b.ID ASC
  `, { window: EXPIRY_WINDOW_DAYS });

  const [[inventory]] = await Promise.all([
    run(`SELECT COALESCE(SUM(QUANTITY * COALESCE(PURCHASE_RATE, 0)), 0) AS AT_COST,
                COALESCE(SUM(QUANTITY * COALESCE(MRP, 0)), 0) AS AT_MRP,
                COALESCE(SUM(QUANTITY), 0) AS UNITS
         FROM HMS_MEDICINE_BATCHES WHERE QUANTITY > 0 AND EXPIRY_DATE >= hms_service_today()`),
  ]);

  // In-stock medicines that nothing has been dispensed or sold from in the last 30 days.
  const slowMoving = await run(`
    SELECT m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT,
           SUM(b.QUANTITY) AS STOCK,
           (SELECT MAX(sl.TRANSACTION_DATE) FROM HMS_STOCK_LEDGER sl
            WHERE sl.MEDICINE_ID = m.ID AND sl.TRANSACTION_TYPE = 'OUT') AS LAST_MOVED
    FROM HMS_MEDICINES m
    JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID AND b.QUANTITY > 0
    WHERE m.IS_ACTIVE = 1
    GROUP BY m.ID, m.GENERIC_NAME, m.STRENGTH, m.STRENGTH_UNIT
    HAVING NOT EXISTS (
      SELECT 1 FROM HMS_STOCK_LEDGER sl
      WHERE sl.MEDICINE_ID = m.ID AND sl.TRANSACTION_TYPE = 'OUT'
        AND sl.TRANSACTION_DATE >= hms_service_day_start() - make_interval(days => :slowDays::integer)
    )
    ORDER BY STOCK DESC, m.GENERIC_NAME ASC
    LIMIT 50
  `, { slowDays: SLOW_MOVING_DAYS });

  const nameOf = (r) => [r.GENERIC_NAME, [r.STRENGTH, r.STRENGTH_UNIT].filter(Boolean).join(' ')].filter(Boolean).join(' ');
  const expiredCount = expiring.filter((b) => b.IS_EXPIRED).length;
  const expiringCount = expiring.length - expiredCount;
  const dispensedAmount = money(dispPeriod.AMOUNT);
  const otcAmount = money(otcPeriod.AMOUNT);

  return {
    period: { days },
    dispensed: { prescriptions: Number(dispPeriod.RECORDS || 0), units: Number(dispPeriod.UNITS || 0), amount: dispensedAmount },
    otc: { sales: Number(otcPeriod.RECORDS || 0), units: Number(otcPeriod.UNITS || 0), amount: otcAmount },
    salesAmount: money(dispensedAmount + otcAmount),
    today: {
      dispensedAmount: money(dispToday.AMOUNT),
      dispensedPrescriptions: Number(dispToday.RECORDS || 0),
      otcAmount: money(otcToday.AMOUNT),
      otcSales: Number(otcToday.RECORDS || 0),
    },
    // Fields the page has always read (kept for compatibility).
    dailySales: money(Number(dispToday.AMOUNT || 0) + Number(otcToday.AMOUNT || 0)),
    totalDispensed: Number(dispPeriod.UNITS || 0),
    inventoryValue: money(inventory.AT_COST),
    inventoryValueMrp: money(inventory.AT_MRP),
    inventoryUnits: Number(inventory.UNITS || 0),
    lowStockThreshold: LOW_STOCK_THRESHOLD,
    lowStockCount: lowStock.length,
    expiringCount,
    expiredCount,
    stockAlerts: lowStock.length + expiring.length,
    topMedicines: topMedicines.map((r) => ({ id: r.ID, name: nameOf(r), units: Number(r.UNITS || 0), amount: money(r.AMOUNT) })),
    lowStock: lowStock.slice(0, 50).map((r) => ({ id: r.ID, name: nameOf(r), stock: Number(r.TOTAL_QTY || 0) })),
    expiringSoon: expiring.slice(0, 50).map((r) => ({
      batchId: r.BATCH_ID, medicineId: r.MEDICINE_ID, name: r.GENERIC_NAME, batchNumber: r.BATCH_NUMBER,
      expiryDate: r.EXPIRY_DATE, quantity: Number(r.QUANTITY || 0), expired: Boolean(r.IS_EXPIRED),
    })),
    slowMoving: slowMoving.map((r) => ({
      id: r.ID, name: nameOf(r), stock: Number(r.STOCK || 0),
      lastMoved: r.LAST_MOVED ? new Date(r.LAST_MOVED).toISOString().slice(0, 10) : null,
    })),
  };
}

// GET /reports?days=1|7|30|90 (default 1 = today)
router.get('/reports', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 1));
    res.json({ status: 'success', success: true, data: await buildPharmacyReport(days) });
  } catch (err) {
    console.error('Pharmacy report failed:', err);
    res.status(500).json({ status: 'error', message: 'Could not build the pharmacy report.' });
  }
});

// ═══════════════════════════════════════════════════════════
// 6. Dashboard KPIs
// ═══════════════════════════════════════════════════════════
router.get('/dashboard', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const [[queue]] = await sequelize.query("SELECT COUNT(*) AS CNT FROM HMS_PRESCRIPTIONS WHERE STATUS = 'Finalized'");
    const [[returns]] = await sequelize.query(`
      SELECT COUNT(*) AS CNT FROM HMS_STOCK_LEDGER
      WHERE TRANSACTION_DATE >= hms_service_day_start()
        AND ((TRANSACTION_TYPE = 'RETURN' AND REFERENCE_TYPE = 'Patient Return')
          OR (TRANSACTION_TYPE = 'DISCARD' AND REFERENCE_TYPE = 'Vendor Return'))
    `);
    const report = await buildPharmacyReport(1);
    res.json({
      status: 'success',
      data: {
        pendingRx: Number(queue.CNT || 0),
        lowStockAlerts: report.lowStockCount,
        expiringSoon: report.expiringCount,
        returnsToday: Number(returns.CNT || 0),
        fastMovers: report.topMedicines.slice(0, 5),
        salesToday: report.dailySales,
      },
    });
  } catch (err) {
    console.error('Pharmacy dashboard KPIs failed:', err);
    res.status(500).json({ status: 'error', message: 'Could not load pharmacy KPIs.' });
  }
});

module.exports = router;
