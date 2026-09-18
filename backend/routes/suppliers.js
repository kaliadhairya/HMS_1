const express = require('express');
const router = express.Router();
const { Supplier } = require('../models');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// ─── GET /api/pharmacy/suppliers ────────────────────────────────
router.get('/', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({
      where: { isActive: 1 },
      order: [['name', 'ASC']],
    });
    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error('Suppliers fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers.' });
  }
});

// ─── GET /api/pharmacy/suppliers/all ────────────────────────────
router.get('/all', checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const suppliers = await Supplier.findAll({ order: [['name', 'ASC']] });
    res.json({ success: true, data: suppliers });
  } catch (err) {
    console.error('Suppliers fetch error:', err);
    res.status(500).json({ success: false, message: 'Failed to fetch suppliers.' });
  }
});

// ─── POST /api/pharmacy/suppliers ───────────────────────────────
router.post('/', checkPermission('pharmacy', 'write'), async (req, res) => {
  try {
    const { name, contactPerson, phone, email, address, gstin } = req.body;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Supplier name is required.' });
    }
    const supplier = await Supplier.create({ name, contactPerson, phone, email, address, gstin });
    
    // Generate supplierNumber using the new auto-incremented ID
    const supplierNumber = `SUP-${supplier.id.toString().padStart(3, '0')}`;
    await supplier.update({ supplierNumber });

    res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    console.error('Supplier create error:', err);
    res.status(500).json({ success: false, message: 'Failed to create supplier.' });
  }
});

// ─── PUT /api/pharmacy/suppliers/:id ────────────────────────────
router.put('/:id', checkPermission('pharmacy', 'write'), async (req, res) => {
  try {
    const supplier = await Supplier.findByPk(req.params.id);
    if (!supplier) {
      return res.status(404).json({ success: false, message: 'Supplier not found.' });
    }
    const { name, contactPerson, phone, email, address, gstin, isActive } = req.body;
    await supplier.update({ name, contactPerson, phone, email, address, gstin, isActive });
    res.json({ success: true, data: supplier });
  } catch (err) {
    console.error('Supplier update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update supplier.' });
  }
});

module.exports = router;
