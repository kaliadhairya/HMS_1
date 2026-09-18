const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

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

// Search ICD-10 local dataset
router.get('/search', async (req, res) => {
  try {
    const q = req.query.q?.toLowerCase();
    if (!q || q.length < 2) return res.json([]);
    
    const results = icd10Data.filter(item => 
      item.code.toLowerCase().includes(q) || 
      item.description.toLowerCase().includes(q)
    );
    
    // Return top 15 matches
    res.json(results.slice(0, 15));
  } catch (error) {
    console.error('Error searching ICD-10:', error);
    res.status(500).json({ error: 'Failed to search diagnoses' });
  }
});

module.exports = router;
