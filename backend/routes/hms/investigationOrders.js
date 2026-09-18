const express = require('express');
const router = express.Router();
const { InvestigationOrder, InvestigationOrderItem, Patient, User, Encounter } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');

// Create a new Investigation Order (from Consultation)
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { encounter_id, patient_id, investigation_type, priority, clinical_notes, items } = req.body;
    
    // Create the order header
    const [[{ NEXTVAL: orderId }]] = await sequelize.query(
      "SELECT nextval('hms_inv_orders_seq') AS \"NEXTVAL\""
    );

    const order = await InvestigationOrder.create({
      id: orderId,
      encounter_id,
      patient_id,
      doctor_id: req.user.id,
      investigation_type: investigation_type || 'Lab',
      priority: priority || 'Routine',
      clinical_notes,
      status: 'Pending'
    });

    // Create the items
    if (items && items.length > 0) {
      const nextRows = await Promise.all(
        items.map(() =>
          sequelize.query("SELECT nextval('hms_inv_items_seq') AS \"NEXTVAL\"")
        )
      );

      const orderItems = items.map((item, index) => ({
        id: nextRows[index][0][0].NEXTVAL,
        order_id: order.id,
        test_name: item.test_name || item.name,
        department: item.department || item.category || 'Pathology',
        item_type: item.item_type || 'Test',
        status: 'Pending'
      }));
      await InvestigationOrderItem.bulkCreate(orderItems);
    }
    
    // Emit real-time notification to Lab Technicians
    const io = req.app.get('io');
    if (io) {
      io.to('lab_technician').emit('new_lab_order', {
        order_id: order.id,
        patient_id,
        investigation_type: order.investigation_type
      });
    }

    res.status(201).json(order);
  } catch (error) {
    console.error('Error creating investigation order:', error);
    res.status(500).json({ error: 'Failed to create investigation order' });
  }
});

// Update order status (when linked to report)
router.patch('/:id/link-report', protect, checkPermission('lab', 'write'), async (req, res) => {
  try {
    const order = await InvestigationOrder.findByPk(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    
    await order.update({ status: 'Completed' });
    res.json({ message: 'Order linked to report' });
  } catch (error) {
    console.error('Error linking report to order:', error);
    res.status(500).json({ error: 'Failed to update order status' });
  }
});

module.exports = router;
