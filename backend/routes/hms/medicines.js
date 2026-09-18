const express = require('express');
const router = express.Router();
const { Medicine, MedicineBatch, StockLedger } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');
const { body, validationResult } = require('express-validator');

router.get('/rxnav/search', protect, checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) {
      return res.json({ success: true, data: [] });
    }

    const rxNavUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(q)}`;
    const response = await fetch(rxNavUrl);

    if (!response.ok) {
      return res.status(502).json({ success: false, message: 'Failed to fetch RxNav suggestions.' });
    }

    const payload = await response.json();
    const groups = payload?.drugGroup?.conceptGroup || [];
    const seen = new Set();
    const suggestions = [];

    for (const group of groups) {
      for (const concept of group?.conceptProperties || []) {
        const name = String(concept.name || '').trim();
        if (!name) continue;

        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);

        suggestions.push({
          name,
          rxnormTty: concept.tty || null,
          rxnormId: concept.rxcui || null,
          synonym: concept.synonym || null,
        });
      }
    }

    res.json({ success: true, data: suggestions.slice(0, 12) });
  } catch (error) {
    console.error('Error fetching RxNav suggestions:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch RxNav suggestions.' });
  }
});

// Search medicines for autocomplete (used by prescription + pharmacy)
router.get('/search', protect, async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.length < 2) return res.json([]);

    const [rows] = await sequelize.query(`
      SELECT ID, GENERIC_NAME, BRAND_NAMES,
             FORMULATION, STRENGTH, STRENGTH_UNIT, UNIT_OF_SALE, GST_RATE
      FROM HMS_MEDICINES
      WHERE IS_ACTIVE = 1
      AND (
        UPPER(GENERIC_NAME) LIKE UPPER(:q)
        OR UPPER(BRAND_NAMES) LIKE UPPER(:q)
      )
      LIMIT 10
    `, { replacements: { q: `%${q}%` } });

    // Map to camelCase for frontend compat
    const mapped = rows.map(r => ({
      id: r.ID ?? r.id,
      genericName: r.GENERIC_NAME ?? r.generic_name,
      brandNames: r.BRAND_NAMES ?? r.brand_names,
      formulation: r.FORMULATION ?? r.formulation,
      strength: r.STRENGTH ?? r.strength,
      strengthUnit: r.STRENGTH_UNIT ?? r.strength_unit,
      unitOfSale: r.UNIT_OF_SALE ?? r.unit_of_sale,
      gstRate: r.GST_RATE ?? r.gst_rate,
    }));
    res.json(mapped);
  } catch (error) {
    console.error('Error searching medicines:', error);
    res.status(500).json({ error: 'Failed to search medicines' });
  }
});

// Get all medicines with stock totals
router.get('/', protect, checkPermission('pharmacy', 'read'), async (req, res) => {
  try {
    const search = req.query.search;
    let whereClause = '';
    const replacements = {};
    if (search) {
      whereClause = `AND (
        UPPER(m.GENERIC_NAME) LIKE UPPER(:search)
        OR UPPER(m.BRAND_NAMES) LIKE UPPER(:search)
      )`;
      replacements.search = `%${search}%`;
    }

    const [rows] = await sequelize.query(`
      SELECT m.ID, m.GENERIC_NAME, m.BRAND_NAMES, m.CATEGORY, m.FORMULATION,
             m.STRENGTH, m.STRENGTH_UNIT, m.UNIT_OF_SALE, m.HSN_CODE,
             m.GST_RATE, m.IS_CONTROLLED, m.IS_ACTIVE,
             COALESCE(SUM(b.QUANTITY), 0) as TOTAL_STOCK,
             MAX(b.MRP) as MRP
      FROM HMS_MEDICINES m
      LEFT JOIN HMS_MEDICINE_BATCHES b ON b.MEDICINE_ID = m.ID
      WHERE 1=1 ${whereClause}
      GROUP BY m.ID, m.GENERIC_NAME, m.BRAND_NAMES, m.CATEGORY, m.FORMULATION,
               m.STRENGTH, m.STRENGTH_UNIT, m.UNIT_OF_SALE, m.HSN_CODE,
               m.GST_RATE, m.IS_CONTROLLED, m.IS_ACTIVE
      ORDER BY m.GENERIC_NAME ASC
    `, { replacements });

    const mapped = rows.map(r => ({
      id: r.ID ?? r.id,
      genericName: r.GENERIC_NAME ?? r.generic_name,
      brandNames: r.BRAND_NAMES ?? r.brand_names,
      category: r.CATEGORY ?? r.category,
      formulation: r.FORMULATION ?? r.formulation,
      strength: r.STRENGTH ?? r.strength,
      strengthUnit: r.STRENGTH_UNIT ?? r.strength_unit,
      unitOfSale: r.UNIT_OF_SALE ?? r.unit_of_sale,
      hsnCode: r.HSN_CODE ?? r.hsn_code,
      gstRate: r.GST_RATE ?? r.gst_rate,
      isControlled: r.IS_CONTROLLED ?? r.is_controlled,
      isActive: r.IS_ACTIVE ?? r.is_active,
      totalStock: r.TOTAL_STOCK ?? r.total_stock ?? 0,
      mrp: r.MRP ?? r.mrp ?? 0,
    }));
    res.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// Create new medicine
router.post('/', [
  body('genericName').trim().escape(),
  body('category').optional({ checkFalsy: true }).trim().escape(),
], protect, checkPermission('pharmacy', 'write'), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { genericName, brandNames, category, formulation, strength, strengthUnit,
            unitOfSale, hsnCode, gstRate, isControlled, initialQuantity, perUnitPrice } = req.body;
    if (!genericName || !formulation) {
      return res.status(400).json({ success: false, message: 'Generic name and formulation are required.' });
    }
    
    const t = await sequelize.transaction();
    try {
      const [[{ NEXTVAL: nextId }]] = await sequelize.query(
        "SELECT nextval('hms_medicines_seq') AS \"NEXTVAL\"", { transaction: t }
      );
      const medicine = await Medicine.create({
        id: nextId,
        genericName,
        brandNames: Array.isArray(brandNames) ? JSON.stringify(brandNames) : brandNames,
        category, formulation, strength, strengthUnit,
        unitOfSale, hsnCode,
        gstRate: gstRate || 0,
        isControlled: isControlled ? 1 : 0,
        isActive: 1,
      }, { transaction: t });

      // Create opening stock if initialQuantity > 0 and perUnitPrice is provided
      if (initialQuantity > 0) {
        const [[{ NEXTVAL: nextBatchId }]] = await sequelize.query(
          "SELECT nextval('hms_med_batch_seq') AS \"NEXTVAL\"", { transaction: t }
        );
        
        // Expiry date set to 5 years from now
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 5);
        
        const batchNumber = `INIT-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        await MedicineBatch.create({
          id: nextBatchId,
          medicineId: nextId,
          batchNumber,
          expiryDate,
          quantity: initialQuantity,
          mrp: perUnitPrice || 0,
          purchaseRate: perUnitPrice || 0,
        }, { transaction: t });

        const [[{ NEXTVAL: nextLedgerId }]] = await sequelize.query(
          "SELECT nextval('hms_stock_led_seq') AS \"NEXTVAL\"", { transaction: t }
        );

        await StockLedger.create({
          id: nextLedgerId,
          medicineId: nextId,
          batchId: nextBatchId,
          transactionType: 'IN',
          quantity: initialQuantity,
          referenceType: 'Opening Stock',
          performedBy: req.user.id,
        }, { transaction: t });
      }

      await t.commit();
      res.status(201).json({ success: true, data: medicine });
    } catch (dbError) {
      await t.rollback();
      throw dbError;
    }
  } catch (error) {
    console.error('Error creating medicine:', error);
    res.status(500).json({ error: 'Failed to create medicine', message: error.message });
  }
});

// Update medicine
router.put('/:id', protect, checkPermission('pharmacy', 'write'), async (req, res) => {
  const t = await sequelize.transaction();
  try {
    const medicine = await Medicine.findByPk(req.params.id, { transaction: t });
    if (!medicine) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }
    const { genericName, brandNames, category, formulation, strength, strengthUnit,
            unitOfSale, hsnCode, gstRate, isControlled, initialQuantity, perUnitPrice } = req.body;
    
    await medicine.update({
      genericName, category, formulation, strength, strengthUnit,
      unitOfSale, hsnCode,
      brandNames: Array.isArray(brandNames) ? JSON.stringify(brandNames) : brandNames,
      gstRate: gstRate || 0,
      isControlled: isControlled ? 1 : 0,
    }, { transaction: t });

    // Handle Quantity and Price Updates if provided
    if (initialQuantity !== undefined || perUnitPrice !== undefined) {
      const [batches] = await sequelize.query(`
        SELECT ID, QUANTITY, MRP FROM HMS_MEDICINE_BATCHES WHERE MEDICINE_ID = :medId ORDER BY EXPIRY_DATE DESC
      `, { replacements: { medId: medicine.id }, transaction: t });

      if (batches.length > 0) {
        // Update the latest batch
        const latestBatch = batches[0];
        const newQty = initialQuantity !== undefined ? parseInt(initialQuantity) : latestBatch.QUANTITY;
        const newMrp = perUnitPrice !== undefined ? parseFloat(perUnitPrice) : latestBatch.MRP;
        
        await sequelize.query(`
          UPDATE HMS_MEDICINE_BATCHES SET QUANTITY = :qty, MRP = :mrp, PURCHASE_RATE = :mrp WHERE ID = :batchId
        `, { replacements: { qty: newQty, mrp: newMrp, batchId: latestBatch.ID }, transaction: t });

        // Calculate difference for ledger
        const qtyDiff = newQty - latestBatch.QUANTITY;
        if (qtyDiff !== 0) {
          const [[{ NEXTVAL: nextLedgerId }]] = await sequelize.query(
            "SELECT nextval('hms_stock_led_seq') AS \"NEXTVAL\"", { transaction: t }
          );
          await StockLedger.create({
            id: nextLedgerId,
            medicineId: medicine.id,
            batchId: latestBatch.ID,
            transactionType: qtyDiff > 0 ? 'IN' : 'OUT',
            quantity: Math.abs(qtyDiff),
            referenceType: 'Stock Adjustment (Edit)',
            performedBy: req.user.id,
          }, { transaction: t });
        }
      } else if (initialQuantity > 0) {
        // No batches exist, create one like in POST
        const [[{ NEXTVAL: nextBatchId }]] = await sequelize.query(
          "SELECT nextval('hms_med_batch_seq') AS \"NEXTVAL\"", { transaction: t }
        );
        const expiryDate = new Date();
        expiryDate.setFullYear(expiryDate.getFullYear() + 5);
        const batchNumber = `ADJ-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}`;

        await MedicineBatch.create({
          id: nextBatchId,
          medicineId: medicine.id,
          batchNumber,
          expiryDate,
          quantity: initialQuantity,
          mrp: perUnitPrice || 0,
          purchaseRate: perUnitPrice || 0,
        }, { transaction: t });

        const [[{ NEXTVAL: nextLedgerId }]] = await sequelize.query(
          "SELECT nextval('hms_stock_led_seq') AS \"NEXTVAL\"", { transaction: t }
        );
        await StockLedger.create({
          id: nextLedgerId,
          medicineId: medicine.id,
          batchId: nextBatchId,
          transactionType: 'IN',
          quantity: initialQuantity,
          referenceType: 'Opening Stock (Edit)',
          performedBy: req.user.id,
        }, { transaction: t });
      }
    }

    await t.commit();
    res.json({ success: true, data: medicine });
  } catch (error) {
    await t.rollback();
    console.error('Error updating medicine:', error);
    res.status(500).json({ error: 'Failed to update medicine', message: error.message });
  }
});

// Toggle active/inactive
router.patch('/:id/toggle', protect, checkPermission('pharmacy', 'write'), async (req, res) => {
  try {
    const medicine = await Medicine.findByPk(req.params.id);
    if (!medicine) {
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }
    await medicine.update({ isActive: medicine.isActive === 1 ? 0 : 1 });
    res.json({ success: true, data: medicine });
  } catch (error) {
    console.error('Error toggling medicine:', error);
    res.status(500).json({ error: 'Failed to toggle medicine' });
  }
});

module.exports = router;
