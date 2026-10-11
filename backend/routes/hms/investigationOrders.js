const express = require('express');
const router = express.Router();
const { InvestigationOrder, InvestigationOrderItem, Patient, Encounter } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');
const { loadOrders } = require('../lab');

const PRIORITIES = ['STAT', 'Urgent', 'Routine'];
const normalizePriority = (value) => PRIORITIES.find((p) => p.toLowerCase() === String(value || '').trim().toLowerCase()) || null;

// Create a new Investigation Order (from Consultation)
// Body: encounter_id, patient_id, priority (or urgency), investigation_type (or order_type), clinical_notes,
//       items: [{ test_name | name, department | category, item_type }]
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { encounter_id, patient_id, clinical_notes, items } = req.body || {};
    // The consultation page sends `order_type` / `urgency` (the column names); accept both spellings.
    const investigationType = String(req.body?.investigation_type || req.body?.order_type || 'Lab').trim().slice(0, 50) || 'Lab';
    const requestedPriority = req.body?.priority ?? req.body?.urgency;
    const priority = requestedPriority === undefined || requestedPriority === null || requestedPriority === ''
      ? 'Routine'
      : normalizePriority(requestedPriority);
    if (!priority) {
      return res.status(400).json({ error: `priority must be one of: ${PRIORITIES.join(', ')}` });
    }

    const encounterId = Number(encounter_id);
    const patientId = Number(patient_id);
    if (!Number.isInteger(encounterId) || encounterId <= 0 || !Number.isInteger(patientId) || patientId <= 0) {
      return res.status(400).json({ error: 'encounter_id and patient_id are required' });
    }

    const tests = (Array.isArray(items) ? items : [])
      .map((item) => ({
        test_name: String(item?.test_name || item?.name || '').trim(),
        department: String(item?.department || item?.category || '').trim() || 'Pathology',
        item_type: String(item?.item_type || 'Test').trim() || 'Test',
      }))
      .filter((item) => item.test_name);
    if (tests.length === 0) {
      return res.status(400).json({ error: 'Add at least one test to the order' });
    }
    if (tests.some((item) => item.test_name.length > 255 || item.department.length > 100)) {
      return res.status(400).json({ error: 'Test names must be 255 characters or fewer' });
    }

    const [encounter, patient] = await Promise.all([
      Encounter.findByPk(encounterId, { attributes: ['id', 'patient_id', 'status'] }),
      Patient.findByPk(patientId, { attributes: ['id', 'name', 'first_name', 'last_name'] }),
    ]);
    if (!encounter) return res.status(404).json({ error: 'Encounter not found' });
    if (!patient) return res.status(404).json({ error: 'Patient not found' });
    if (Number(encounter.patient_id) !== patientId) {
      return res.status(400).json({ error: 'The encounter belongs to a different patient' });
    }
    // A finalized visit may already be billed, so a late order would never be charged or seen in it.
    if (encounter.status === 'Finalized') {
      return res.status(409).json({ error: 'This consultation is finalized. Start a new consultation to order more tests.' });
    }

    // Header and items are written together, so a failed item never leaves an empty order in the lab queue.
    const order = await sequelize.transaction(async (transaction) => {
      const [[{ NEXTVAL: orderId }]] = await sequelize.query(
        "SELECT nextval('hms_inv_orders_seq') AS \"NEXTVAL\"", { transaction }
      );

      const created = await InvestigationOrder.create({
        id: orderId,
        encounter_id: encounterId,
        patient_id: patientId,
        doctor_id: req.user.id,
        investigation_type: investigationType,
        priority,
        clinical_notes: clinical_notes ? String(clinical_notes).slice(0, 1000) : null,
        status: 'Pending',
      }, { transaction });

      const orderItems = [];
      for (const item of tests) {
        const [[{ NEXTVAL: itemId }]] = await sequelize.query(
          "SELECT nextval('hms_inv_items_seq') AS \"NEXTVAL\"", { transaction }
        );
        orderItems.push({ id: itemId, order_id: created.id, ...item, status: 'Pending' });
      }
      await InvestigationOrderItem.bulkCreate(orderItems, { transaction });
      return created;
    });

    // Emit real-time notification to Lab Technicians
    const io = req.app.get('io');
    if (io) {
      io.to('lab_technician').emit('new_lab_order', {
        order_id: order.id,
        patient_id: patientId,
        investigation_type: order.investigation_type,
        priority,
        tests: tests.map((item) => item.test_name),
      });
    }

    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating investigation order:', error);
    res.status(500).json({ error: 'Failed to create investigation order' });
  }
});

// List investigation orders with their tests and results.
// ?patient_id= -> every order for that patient; ?encounter_id= -> that encounter's orders;
// neither -> orders placed by the signed-in doctor.
router.get('/', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const clauses = ["o.STATUS <> 'Cancelled'"];
    const replacements = {};
    const patientId = req.query.patient_id ? Number(req.query.patient_id) : null;
    const encounterId = req.query.encounter_id ? Number(req.query.encounter_id) : null;
    if (patientId !== null) {
      if (!Number.isInteger(patientId)) return res.status(400).json({ error: 'Invalid patient_id' });
      clauses.push('o.PATIENT_ID = :patientId');
      replacements.patientId = patientId;
    }
    if (encounterId !== null) {
      if (!Number.isInteger(encounterId)) return res.status(400).json({ error: 'Invalid encounter_id' });
      clauses.push('o.ENCOUNTER_ID = :encounterId');
      replacements.encounterId = encounterId;
    }
    if (patientId === null && encounterId === null) {
      clauses.push('o.DOCTOR_ID = :doctorId');
      replacements.doctorId = req.user.id;
    }
    const orders = await loadOrders({ where: clauses.join(' AND '), replacements, limit: 100 });
    res.json({ success: true, data: orders });
  } catch (error) {
    console.error('Error listing investigation orders:', error);
    res.status(500).json({ error: 'Failed to load investigation orders' });
  }
});

// Update order status (when linked to report)
router.patch('/:id/link-report', protect, checkPermission('lab', 'write'), async (req, res) => {
  try {
    const order = await InvestigationOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });

    // Only an order whose tests all have results can be completed.
    const outstanding = await InvestigationOrderItem.count({
      where: { order_id: order.id, status: ['Pending', 'Collected', 'Received in Lab', 'In Progress'] },
    });
    if (outstanding > 0) {
      return res.status(409).json({ error: `${outstanding} test(s) on this order still have no result` });
    }

    await order.update({ status: 'Completed' });
    res.json({ message: 'Order linked to report' });
  } catch (error) {
    console.error('Error linking report to order:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;
