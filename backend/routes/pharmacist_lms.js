const express = require('express');
const router = express.Router();
const {
  Prescription, PrescriptionItem, Patient, User,
  Supplier, PurchaseOrder, PurchaseItem,
  DispensingRecord, DispensingItem, MedicineBatch, Medicine,
  Bill, BillItem, Admission, StockLedger,
} = require('../models');
const { sequelize } = require('../models/db');


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
router.get('/dispense-queue', async (req, res) => {
  try {
    const pending = await Prescription.findAll({
      where: { status: 'Pending' },
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'first_name', 'last_name', 'uhid'] },
        { model: User, as: 'doctor', attributes: ['id', 'fullName'] },
        { model: PrescriptionItem, as: 'items' },
      ],
      order: [['prescription_date', 'ASC']],
    });

    const queue = pending.map(p => ({
      PRESCRIPTION_ID: p.id,
      PATIENT_NAME: p.patient ? `${p.patient.first_name} ${p.patient.last_name}` : 'Unknown',
      UHID: p.patient?.uhid || '---',
      DOCTOR_NAME: p.doctor?.fullName || 'Unknown',
      MEDICINE_COUNT: (p.items || []).length,
      CREATED_AT: p.prescription_date,
    }));

    res.json({ status: 'success', data: queue, source: 'live' });
  } catch (err) {
    console.error('Dispense queue fetch failed:', err.message);
    res.json({ status: 'success', data: [], source: 'live' });
  }
});

// Dispense action — TRANSACTIONAL with Billing and Stock
router.post('/dispense', async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const { prescriptionId, items } = req.body; // items: [{medicineId, batchId, quantity, rate, amount, medicineName}]
    const userId = req.user?.id;

    // 1. Fetch Prescription
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
      // IPD integration: Link to active admission bill
      const [existingBill] = await Bill.findOrCreate({
        where: { admissionId: activeAdmission.id, status: 'Pending' },
        defaults: {
          patientId,
          admissionId: activeAdmission.id,
          billType: 'IPD',
          status: 'Pending',
          totalAmount: 0,
          netPayable: 0,
        },
        transaction: t,
      });
      billId = existingBill.id;
    } else {
      // OPD integration: Create a standalone bill
      const newBill = await Bill.create({
        patientId,
        encounterId: prescription.encounter_id,
        billType: 'OPD',
        status: 'Pending',
        totalAmount: 0,
        netPayable: 0,
      }, { transaction: t });
      billId = newBill.id;
    }

    // 3. Create Dispensing Record
    const totalDispenseAmount = (items || []).reduce((sum, item) => sum + parseFloat(item.amount || 0), 0);
    const dispRecord = await DispensingRecord.create({
      prescriptionId,
      patientId,
      dispensedBy: userId,
      totalAmount: totalDispenseAmount,
      billId,
    }, { transaction: t });

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
        await StockLedger.create({
          medicineId: item.medicineId,
          batchId: item.batchId,
          transactionType: 'OUT',
          quantity: item.quantity,
          referenceType: 'DISPENSING',
          referenceId: dispRecord.id,
          performedBy: userId,
        }, { transaction: t });

        // Create DispensingItem
        await DispensingItem.create({
          dispensingRecordId: dispRecord.id,
          medicineId: item.medicineId,
          batchId: item.batchId,
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        }, { transaction: t });

        // Add to Bill
        await BillItem.create({
          billId,
          itemType: 'Medicine',
          itemName: item.medicineName || 'Pharmacy Medicine',
          quantity: item.quantity,
          rate: item.rate,
          amount: item.amount,
        }, { transaction: t });
      }
    }

    // 5. Update Bill Totals
    const billItems = await BillItem.findAll({ where: { billId }, transaction: t });
    const newTotal = billItems.reduce((sum, bi) => sum + parseFloat(bi.amount || 0), 0);
    await Bill.update({ totalAmount: newTotal, netPayable: newTotal }, { where: { id: billId }, transaction: t });

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

    res.json({ status: 'success', message: 'Prescription dispensed and billing updated successfully.' });
  } catch (err) {
    if (t) await t.rollback();
    console.error('Dispensing Error:', err);
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// Get available batches for a medicine (FEFO: First Expiry First Out)
router.get('/medicines/:id/batches', async (req, res) => {
  try {
    const { id } = req.params;
    const { Op } = require('sequelize');

    const batches = await MedicineBatch.findAll({
      where: { 
        medicineId: id,
        quantity: { [Op.gt]: 0 }
      },
      order: [['EXPIRY_DATE', 'ASC']]
    });
    res.json({ status: 'success', data: batches });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 4. Returns Management
// ═══════════════════════════════════════════════════════════
router.get('/returns', async (req, res) => {
  try {
    res.json({ status: 'success', data: [] });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

router.post('/returns', (req, res) => {
  const io = req.app.get('io');
  if (io) io.to('pharmacist').emit('return_processed', req.body);
  res.status(201).json({ status: 'success', message: 'Return processed.' });
});

// ═══════════════════════════════════════════════════════════
// 5. Reports & Analytics
// ═══════════════════════════════════════════════════════════
router.get('/reports', async (req, res) => {
  try {
    const totalDispensed = await DispensingRecord.count();
    res.json({
      status: 'success',
      data: {
        dailySales: 0,
        totalDispensed: totalDispensed || 0,
        inventoryValue: 0,
        stockAlerts: 0,
        slowMoving: []
      }
    });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
// 6. Dashboard KPIs
// ═══════════════════════════════════════════════════════════
router.get('/dashboard', async (req, res) => {
  try {
    const pendingRx = await Prescription.count({ where: { status: 'Pending' } });
    res.json({
      status: 'success',
      data: {
        pendingRx: pendingRx || 0,
        lowStockAlerts: 0,
        expiringSoon: 0,
        returnsToday: 0,
        fastMovers: [],
        ipdRatio: 0,
        opdRatio: 0,
      }
    });
  } catch (err) {
    res.json({
      status: 'success',
      data: {
        pendingRx: 0, lowStockAlerts: 0, expiringSoon: 0, returnsToday: 0,
        fastMovers: [], ipdRatio: 0, opdRatio: 0,
      }
    });
  }
});

module.exports = router;
