const express = require('express');
const router = express.Router();
const { Diagnosis, sequelize } = require('../../models');
const { protect, checkPermission } = require('../../middleware/auth');

// Diagnoses belong to the consultation note; once it is finalized they are part of the record.
async function encounterStatus(encounterId) {
  const [rows] = await sequelize.query('SELECT STATUS FROM HMS_ENCOUNTERS WHERE ID = :id', { replacements: { id: Number(encounterId) } });
  return rows && rows.length ? rows[0].STATUS : null;
}

// Add diagnosis to encounter
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { encounter_id, icd10_code, icd10_description, diagnosis_type, status, clinical_notes } = req.body;
    if (!encounter_id || !icd10_code) return res.status(400).json({ error: 'encounter_id and icd10_code are required' });
    const encStatus = await encounterStatus(encounter_id);
    if (!encStatus) return res.status(404).json({ error: 'Encounter not found' });
    if (encStatus === 'Finalized') return res.status(400).json({ error: 'Cannot change a finalized encounter' });

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
    if (await encounterStatus(diagnosis.encounter_id) === 'Finalized') {
      return res.status(400).json({ error: 'Cannot change a finalized encounter' });
    }
    
    await diagnosis.destroy();
    res.json({ message: 'Diagnosis removed' });
  } catch (error) {
    console.error('Error removing diagnosis:', error);
    res.status(500).json({ error: 'Failed to remove diagnosis' });
  }
});

module.exports = router;
