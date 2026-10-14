const express = require('express');
const router = express.Router();
const { InvestigationOrder, InvestigationOrderItem, Patient, Encounter } = require('../../models');
const { sequelize } = require('../../models/db');
const { publish } = require('../../utils/outbox');
const { protect, checkPermission } = require('../../middleware/auth');
const { loadOrders } = require('../lab');

const PRIORITIES = ['STAT', 'Urgent', 'Routine'];
const normalizePriority = (value) => PRIORITIES.find((p) => p.toLowerCase() === String(value || '').trim().toLowerCase()) || null;

// Create a new Investigation Order (from Consultation)
// Body: encounter_id, patient_id, priority (or urgency), investigation_type (or order_type), clinical_notes,
//       items: [{ test_name | name, department | category, item_type }]
router.post('/', protect, require('../../middleware/auth').restrictTo('doctor'), async (req, res) => {
  try {
    const data = await sequelize.transaction(tx => require('../../services/laboratoryOrders').create(req.body, req.user, tx));
    res.status(201).json(data);
  } catch (e) { res.status(e.status || 500).json({ success: false, code: e.code || 'LAB_ORDER_FAILED', error: e.status ? e.message : 'Order could not be confirmed.' }); }
});

// List investigation orders with their tests and results.
// ?patient_id= -> every order for that patient; ?encounter_id= -> that encounter's orders;
// neither -> orders placed by the signed-in doctor.
router.get('/', protect, checkPermission('consultation', 'read'), async (req, res) => {
  try {
    const clauses = ["o.STATUS <> 'Cancelled'"];
    if (req.user.role === 'doctor') clauses.push('patient_in_care(:careUser, o.PATIENT_ID)');
    const replacements = { careUser: req.user.id };
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
router.patch('/:id/link-report', protect, checkPermission('lab', 'write'), (req, res) => {
  res.status(410).json({ success: false, code: 'LEGACY_REPORT_LINK_RETIRED', message: 'Release a versioned diagnostic report through the laboratory workflow.' });
});

module.exports = router;
