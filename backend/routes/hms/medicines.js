const express = require('express');
const router = express.Router();
const { Medicine, MedicineBatch, StockLedger } = require('../../models');
const { sequelize } = require('../../models/db');
const { protect, checkPermission } = require('../../middleware/auth');
const { body, validationResult } = require('express-validator');

function parseBrandNames(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
      if (typeof parsed === 'string') return [parsed];
    } catch {
      return trimmed.split(',').map(s => s.trim()).filter(Boolean);
    }
  }
  return [];
}

// GST is a whole percentage (HMS_MEDICINES.GST_RATE is an integer); quantities are whole units.
// New stock must carry the manufacturer's batch number and expiry from the pack.
// Inventing them (an INIT-/ADJ- batch expiring five years out) hid real expiry
// dates from FEFO picking, expiry alerts and recalls (blueprint F07).
function readLotProvenance({ batchNumber, expiryDate }) {
  const lot = typeof batchNumber === 'string' ? batchNumber.trim() : '';
  if (!lot || !/^\d{4}-\d{2}-\d{2}$/.test(String(expiryDate || ''))) {
    return { error: 'New stock needs the batch number and expiry date printed on the pack.' };
  }
  if (lot.length > 100) return { error: 'Batch number must be 100 characters or fewer.' };
  const expiry = new Date(`${expiryDate}T00:00:00Z`);
  if (Number.isNaN(expiry.getTime()) || expiry.toISOString().slice(0, 10) !== expiryDate) {
    return { error: 'Expiry date is not a valid date.' };
  }
  const today = new Date().toISOString().slice(0, 10);
  if (expiryDate <= today) return { error: 'This batch has already expired and cannot be added as stock.' };
  return { batchNumber: lot, expiryDate };
}

function validateNumbers({ gstRate, initialQuantity, perUnitPrice, quantityDelta }) {
  if (gstRate !== undefined && gstRate !== null && gstRate !== '') {
    const g = Number(gstRate);
    if (!Number.isInteger(g) || g < 0 || g > 100) return 'GST rate must be a whole percentage between 0 and 100.';
  }
  if (initialQuantity !== undefined && initialQuantity !== null && initialQuantity !== '') {
    const q = Number(initialQuantity);
    if (!Number.isInteger(q) || q < 0) return 'Quantity must be a whole number of units, 0 or more.';
  }
  if (quantityDelta !== undefined && quantityDelta !== null && !Number.isInteger(Number(quantityDelta))) {
    return 'The stock change must be a whole number of units.';
  }
  if (perUnitPrice !== undefined && perUnitPrice !== null && perUnitPrice !== '') {
    const p = Number(perUnitPrice);
    if (!Number.isFinite(p) || p < 0) return 'MRP must be 0 or more.';
  }
  return null;
}

// Another catalogue entry with the same generic name, formulation and strength (case-insensitive).
async function findDuplicate({ genericName, formulation, strength, strengthUnit }, excludeId = null) {
  const [rows] = await sequelize.query(`
    SELECT ID, GENERIC_NAME, FORMULATION, STRENGTH, STRENGTH_UNIT
    FROM HMS_MEDICINES
    WHERE UPPER(TRIM(GENERIC_NAME)) = UPPER(TRIM(:genericName))
      AND UPPER(COALESCE(FORMULATION, '')) = UPPER(COALESCE(:formulation, ''))
      AND UPPER(COALESCE(STRENGTH, '')) = UPPER(COALESCE(:strength, ''))
      AND UPPER(COALESCE(STRENGTH_UNIT, '')) = UPPER(COALESCE(:strengthUnit, ''))
      AND (:excludeId IS NULL OR ID <> :excludeId)
    LIMIT 1
  `, {
    replacements: {
      genericName: String(genericName || ''), formulation: formulation || null, strength: strength || null,
      strengthUnit: strengthUnit || null, excludeId,
    },
  });
  return rows[0] || null;
}

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
      brandNames: parseBrandNames(r.BRAND_NAMES ?? r.brand_names),
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
      brandNames: parseBrandNames(r.BRAND_NAMES ?? r.brand_names),
      category: r.CATEGORY ?? r.category,
      formulation: r.FORMULATION ?? r.formulation,
      strength: r.STRENGTH ?? r.strength,
      strengthUnit: r.STRENGTH_UNIT ?? r.strength_unit,
      unitOfSale: r.UNIT_OF_SALE ?? r.unit_of_sale,
      hsnCode: r.HSN_CODE ?? r.hsn_code,
      gstRate: r.GST_RATE ?? r.gst_rate,
      isControlled: r.IS_CONTROLLED ?? r.is_controlled,
      isActive: r.IS_ACTIVE ?? r.is_active,
      totalStock: Number(r.TOTAL_STOCK ?? r.total_stock ?? 0),
      mrp: Number(r.MRP ?? r.mrp ?? 0),
    }));
    res.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Error fetching medicines:', error);
    res.status(500).json({ error: 'Failed to fetch medicines' });
  }
});

// Create new medicine
// Names are stored as typed: React escapes them on display, and HTML-escaping here stored
// "Paracetamol/Caffeine" as "Paracetamol&#x2F;Caffeine" (edits, which were not escaped, then disagreed).
router.post('/', [
  body('genericName').trim(),
  body('category').optional({ checkFalsy: true }).trim(),
], protect, checkPermission('pharmacy', 'write'), async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
  try {
    const { genericName, brandNames, category, formulation, strength, strengthUnit,
            unitOfSale, hsnCode, gstRate, isControlled, initialQuantity, perUnitPrice } = req.body;
    if (!genericName || !formulation) {
      return res.status(400).json({ success: false, message: 'Generic name and formulation are required.' });
    }
    const numberError = validateNumbers({ gstRate, initialQuantity, perUnitPrice });
    if (numberError) return res.status(400).json({ success: false, message: numberError });
    const lot = initialQuantity > 0 ? readLotProvenance(req.body) : null;
    if (lot?.error) return res.status(400).json({ success: false, message: lot.error });
    const duplicate = await findDuplicate({ genericName, formulation, strength, strengthUnit });
    if (duplicate) {
      return res.status(409).json({ success: false, message: `${duplicate.GENERIC_NAME} ${[duplicate.STRENGTH, duplicate.STRENGTH_UNIT].filter(Boolean).join(' ')} (${duplicate.FORMULATION}) is already in the catalogue as ID ${duplicate.ID}.` });
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
        
        await MedicineBatch.create({
          id: nextBatchId,
          medicineId: nextId,
          batchNumber: lot.batchNumber,
          expiryDate: lot.expiryDate,
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
// Only the fields sent are changed (a partial update used to reset GST to 0 and clear the controlled flag).
// Stock: `quantityDelta` adds or removes units on the latest batch (by expiry); the older `initialQuantity`
// sets the latest batch's quantity. Both are logged as ADJUSTMENT with a signed quantity so a correction
// is not counted as stock issued to patients. `perUnitPrice` changes the latest batch's MRP only; the
// purchase rate from the supplier invoice is left alone.
router.put('/:id', protect, checkPermission('pharmacy', 'write'), async (req, res) => {
  const { genericName, brandNames, category, formulation, strength, strengthUnit,
          unitOfSale, hsnCode, gstRate, isControlled, initialQuantity, perUnitPrice, quantityDelta } = req.body;
  const numberError = validateNumbers({ gstRate, initialQuantity, perUnitPrice, quantityDelta });
  if (numberError) return res.status(400).json({ success: false, message: numberError });
  if (genericName !== undefined && !String(genericName).trim()) {
    return res.status(400).json({ success: false, message: 'Generic name is required.' });
  }

  const t = await sequelize.transaction();
  try {
    const medicine = await Medicine.findByPk(req.params.id, { transaction: t });
    if (!medicine) {
      await t.rollback();
      return res.status(404).json({ success: false, message: 'Medicine not found.' });
    }

    const changes = {};
    if (genericName !== undefined) changes.genericName = String(genericName).trim();
    if (category !== undefined) changes.category = category;
    if (formulation !== undefined) changes.formulation = formulation;
    if (strength !== undefined) changes.strength = strength;
    if (strengthUnit !== undefined) changes.strengthUnit = strengthUnit;
    if (unitOfSale !== undefined) changes.unitOfSale = unitOfSale;
    if (hsnCode !== undefined) changes.hsnCode = hsnCode;
    if (brandNames !== undefined) changes.brandNames = Array.isArray(brandNames) ? JSON.stringify(brandNames) : brandNames;
    if (gstRate !== undefined) changes.gstRate = Number(gstRate || 0);
    if (isControlled !== undefined) changes.isControlled = isControlled ? 1 : 0;

    const duplicate = await findDuplicate({
      genericName: changes.genericName ?? medicine.genericName,
      formulation: changes.formulation ?? medicine.formulation,
      strength: changes.strength ?? medicine.strength,
      strengthUnit: changes.strengthUnit ?? medicine.strengthUnit,
    }, medicine.id);
    if (duplicate) {
      await t.rollback();
      return res.status(409).json({ success: false, message: `Another catalogue entry (ID ${duplicate.ID}) already has this name, formulation and strength.` });
    }

    if (Object.keys(changes).length) await medicine.update(changes, { transaction: t });

    const hasDelta = quantityDelta !== undefined && quantityDelta !== null && Number(quantityDelta) !== 0;
    const hasQty = initialQuantity !== undefined && initialQuantity !== null && initialQuantity !== '';
    const hasPrice = perUnitPrice !== undefined && perUnitPrice !== null && perUnitPrice !== '';

    if (hasDelta || hasQty || hasPrice) {
      const [batches] = await sequelize.query(`
        SELECT ID, QUANTITY, MRP FROM HMS_MEDICINE_BATCHES WHERE MEDICINE_ID = :medId ORDER BY EXPIRY_DATE DESC, ID DESC
        FOR UPDATE
      `, { replacements: { medId: medicine.id }, transaction: t });

      if (batches.length > 0) {
        const latestBatch = batches[0];
        const oldQty = Number(latestBatch.QUANTITY || 0);
        let newQty = oldQty;
        if (hasDelta) newQty = oldQty + Number(quantityDelta);
        else if (hasQty) newQty = parseInt(initialQuantity, 10);
        if (newQty < 0) {
          await t.rollback();
          return res.status(400).json({ success: false, message: `The latest batch has only ${oldQty} units, so stock cannot go down by ${Math.abs(Number(quantityDelta))}.` });
        }
        const newMrp = hasPrice ? parseFloat(perUnitPrice) : latestBatch.MRP;

        await sequelize.query(`
          UPDATE HMS_MEDICINE_BATCHES SET QUANTITY = :qty, MRP = :mrp WHERE ID = :batchId
        `, { replacements: { qty: newQty, mrp: newMrp, batchId: latestBatch.ID }, transaction: t });

        const qtyDiff = newQty - oldQty;
        if (qtyDiff !== 0) {
          const [[{ NEXTVAL: nextLedgerId }]] = await sequelize.query(
            "SELECT nextval('hms_stock_led_seq') AS \"NEXTVAL\"", { transaction: t }
          );
          await StockLedger.create({
            id: nextLedgerId,
            medicineId: medicine.id,
            batchId: latestBatch.ID,
            transactionType: 'ADJUSTMENT',
            quantity: qtyDiff,
            referenceType: 'Stock Adjustment (Edit)',
            performedBy: req.user.id,
          }, { transaction: t });
        }
      } else if ((hasDelta && Number(quantityDelta) > 0) || (hasQty && Number(initialQuantity) > 0)) {
        const openingQty = hasDelta ? Number(quantityDelta) : parseInt(initialQuantity, 10);
        // No batches exist yet, so this is a first receipt: it needs real lot details like POST.
        const lot = readLotProvenance(req.body);
        if (lot.error) {
          await t.rollback();
          return res.status(400).json({ success: false, message: lot.error });
        }
        const [[{ NEXTVAL: nextBatchId }]] = await sequelize.query(
          "SELECT nextval('hms_med_batch_seq') AS \"NEXTVAL\"", { transaction: t }
        );

        await MedicineBatch.create({
          id: nextBatchId,
          medicineId: medicine.id,
          batchNumber: lot.batchNumber,
          expiryDate: lot.expiryDate,
          quantity: openingQty,
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
          quantity: openingQty,
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
