const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { protect, restrictTo } = require('../../middleware/auth');
const { search } = require('../../services/terminology');

// Pre-load ICD-10 dataset
const datasetPath = path.join(__dirname, '../../data/icd10-common.json');
let icd10Data = [];

try {
  if (fs.existsSync(datasetPath)) {
    const fileData = fs.readFileSync(datasetPath, 'utf8');
    icd10Data = JSON.parse(fileData);
  }
} catch (error) {
  console.error('Failed to load ICD-10 dataset:', error);
}

// Search the active ICD-10 release (Phase 6A). Until the hospital loads and
// activates an edition, the old built-in list is searched; those results are
// marked legacy and the diagnoses made from them have no known edition.
router.get('/search', protect, restrictTo('super_admin', 'admin', 'doctor'), async (req, res) => {
  try {
    const q = req.query.q?.toLowerCase();
    if (!q || q.length < 2) return res.json([]);
    const coded = await search({ system: 'ICD10', q: req.query.q, limit: 15 });
    if (coded.release) {
      return res.json(coded.concepts.filter((c) => c.active).map((c) => ({ code: c.code, description: c.display, release: coded.release.version })));
    }
    
    const results = icd10Data.filter(item => 
      item.code.toLowerCase().includes(q) || 
      item.description.toLowerCase().includes(q)
    );
    
    // Return top 15 matches
    res.json(results.slice(0, 15).map((r) => ({ ...r, legacy: true })));
  } catch (error) {
    console.error('Error searching ICD-10:', error);
    res.status(500).json({ error: 'Failed to search diagnoses' });
  }
});

module.exports = router;
