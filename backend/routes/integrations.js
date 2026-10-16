const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const R = require('../services/integrationReadiness.cts');

// Readiness of ABDM and terminology (completion B2), for administrators.
const router = express.Router();
router.get('/readiness', protect, restrictTo('super_admin', 'admin'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: await R.readiness() });
  } catch (err) {
    console.error('Readiness check failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not check readiness.' });
  }
});

module.exports = router;
