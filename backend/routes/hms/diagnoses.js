const express = require('express');
const router = express.Router();
const { Diagnosis, sequelize } = require('../../models');
const { protect, checkPermission } = require('../../middleware/auth');
const { activeRelease, concept } = require('../../services/terminology');

// Diagnoses belong to the consultation note; once it is finalized they are part of the record.
async function encounterStatus(encounterId) {
  const [rows] = await sequelize.query('SELECT STATUS FROM HMS_ENCOUNTERS WHERE ID = :id', { replacements: { id: Number(encounterId) } });
  return rows && rows.length ? rows[0].STATUS : null;
}

// Add diagnosis to encounter
router.post('/', protect, checkPermission('consultation', 'write'), async (req, res) => {
  try {
    const { encounter_id, icd10_code, icd10_description, diagnosis_type, status, clinical_notes, original_text } = req.body;
    if (!encounter_id || !icd10_code) return res.status(400).json({ error: 'encounter_id and icd10_code are required' });
    const encStatus = await encounterStatus(encounter_id);
    if (!encStatus) return res.status(404).json({ error: 'Encounter not found' });
    if (encStatus === 'Finalized') return res.status(400).json({ error: 'Cannot change a finalized encounter' });

    // With an active ICD-10 release the code must come from it, and the
    // diagnosis keeps that release (Phase 6A). Without one, the diagnosis is
    // recorded as before and marked as coded against an unknown edition.
    const release = await activeRelease('ICD10');
    let coding = { status: 'LEGACY_UNVERSIONED', releaseId: null, description: icd10_description };
    if (release) {
      const found = await concept(release.id, String(icd10_code).trim());
      if (!found) return res.status(422).json({ error: `${icd10_code} is not in ICD-10 ${release.version}.`, code: 'UNKNOWN_CONCEPT' });
      if (!found.active) return res.status(422).json({ error: `${icd10_code} is inactive in ICD-10 ${release.version}.`, code: 'INACTIVE_CONCEPT' });
      coding = { status: 'CODED', releaseId: release.id, description: found.display };
    }
    const [[diagnosis]] = await sequelize.query(`INSERT INTO hms_diagnoses
        (id, encounter_id, icd10_code, icd10_description, diagnosis_type, status, clinical_notes, coding_status, term_release_id, original_text)
      VALUES (nextval('hms_diagnoses_seq'), :encounterId, :code, :description, COALESCE(:type, 'Primary'), COALESCE(:status, 'Provisional'), :notes, :coding, :release, :original)
      RETURNING id, encounter_id, icd10_code, icd10_description, diagnosis_type, status, clinical_notes, coding_status, term_release_id, original_text`, {
      replacements: {
        encounterId: Number(encounter_id), code: String(icd10_code).trim(), description: coding.description || null, type: diagnosis_type || null,
        status: status || null, notes: clinical_notes || null, coding: coding.status, release: coding.releaseId, original: original_text || null,
      },
    });
    res.status(201).json({ ...diagnosis, icd10_release: release ? release.version : null });
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
