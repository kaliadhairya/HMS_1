const express = require('express');
const router = express.Router();
const { Diagnosis, sequelize } = require('../../models');
const { protect, checkPermission } = require('../../middleware/auth');

// Add diagnosis to encounter
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { encounter_id, icd10_code, icd10_description, diagnosis_type, status, clinical_notes } = req.body;

    // Generate ID from database sequence
    const [[{ NEXTVAL: nextId }]] = await sequelize.query("SELECT nextval('hms_diagnoses_seq') AS \"NEXTVAL\"");

    const diagnosis = await Diagnosis.create({
      id: nextId,
      encounter_id,
      icd10_code,
      icd10_description,
      diagnosis_type,
      status,
      clinical_notes
    });
    res.status(201).json(diagnosis);
  } catch (error) {
    console.error('Error adding diagnosis:', error);
    res.status(500).json({ error: 'Failed to add diagnosis' });
  }
});

// Remove diagnosis from encounter
router.delete('/:id', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const diagnosis = await Diagnosis.findByPk(req.params.id);
    if (!diagnosis) return res.status(404).json({ error: 'Diagnosis not found' });
    
    await diagnosis.destroy();
    res.json({ message: 'Diagnosis removed' });
  } catch (error) {
    console.error('Error removing diagnosis:', error);
    res.status(500).json({ error: 'Failed to remove diagnosis' });
  }
});

module.exports = router;
