const express = require('express');
const router = express.Router();
const { Supplier } = require('../models');
const { sequelize } = require('../models/db');
const { protect, checkPermission } = require('../middleware/auth');

router.use(protect);

// Trimmed supplier fields, or a message for the first one that will not fit the table (the columns are
// short: an over-long phone number used to fail with a 500).
function cleanSupplier(body, { partial = false } = {}) {
  const limits = { name: 200, contactPerson: 100, phone: 15, email: 100, gstin: 20 };
  const out = {};
  for (const key of ['name', 'contactPerson', 'phone', 'email', 'address', 'gstin']) {
    if (body[key] === undefined) continue;
    const v = body[key] === null ? '' : String(body[key]).trim();
    out[key] = v || null;
  }
  if (!partial || out.name !== undefined) {
    if (!out.name) return { error: 'Supplier name is required.' };
  }
  for (const [key, max] of Object.entries(limits)) {
    if (out[key] && out[key].length > max) return { error: `${key === 'contactPerson' ? 'Contact person' : key === 'gstin' ? 'GSTIN' : key[0].toUpperCase() + key.slice(1)} must be ${max} characters or fewer.` };
  }
  if (out.phone && !/^[0-9+\-\s()]{6,15}$/.test(out.phone)) return { error: 'Enter a valid phone number.' };
  if (out.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) return { error: 'Enter a valid email address.' };
  if (out.gstin) out.gstin = out.gstin.toUpperCase();
  return { data: out };
}

async function nameTaken(name, excludeId = null) {
  const { Op, fn, col, where } = require('sequelize');
  const conditions = [where(fn('UPPER', col('NAME')), String(name).toUpperCase())];
  if (excludeId) conditions.push({ id: { [Op.ne]: excludeId } });
  const found = await Supplier.findAll({ where: { [Op.and]: conditions }, limit: 1 });
  return found.length > 0;
}

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
    const { data, error } = cleanSupplier(req.body || {});
    if (error) return res.status(400).json({ success: false, message: error });
    if (await nameTaken(data.name)) {
      return res.status(409).json({ success: false, message: `A supplier named ${data.name} is already on file.` });
    }
    // The model has no autoIncrement, so Sequelize sent ID = NULL and every new supplier failed with a 500.
    const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_suppliers_seq') AS \"NEXTVAL\"");
    const supplier = await Supplier.create({ id: Number(nextId), ...data });
    
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
    const { data, error } = cleanSupplier(req.body || {}, { partial: true });
    if (error) return res.status(400).json({ success: false, message: error });
    if (data.name && await nameTaken(data.name, supplier.id)) {
      return res.status(409).json({ success: false, message: `A supplier named ${data.name} is already on file.` });
    }
    if (req.body?.isActive !== undefined) data.isActive = Number(req.body.isActive) ? 1 : 0;
    await supplier.update(data);
    res.json({ success: true, data: supplier });
  } catch (err) {
    console.error('Supplier update error:', err);
    res.status(500).json({ success: false, message: 'Failed to update supplier.' });
  }
});

module.exports = router;
