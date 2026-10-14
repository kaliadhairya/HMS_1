const express = require('express');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const W = require('../services/worklist');

// Accountable worklist (Phase 6, migration 0091). Mounted at /api/worklist.
// Staff see the items owned by their role; administrators see all. Resolving
// needs a note saying what was done. Commands need an Idempotency-Key.
const router = express.Router();
const ROLES = ['super_admin', 'admin', 'doctor', 'nurse', 'lab_technician', 'pharmacist', 'receptionist'];
const ADMIN = ['super_admin', 'admin'];

const handle = (fallback, fn) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
    if ((err.original || err.parent)?.code === '22P02') return res.status(400).json({ success: false, message: 'That identifier is not valid.' });
    console.error(`${fallback}:`, err.original?.message || err.message);
    return res.status(500).json({ success: false, message: fallback });
  }
};

// An item can be handled by its owner role or an administrator.
async function mine(req, t) {
  const [item] = await sequelize.query('SELECT owner_role FROM hms_worklist_items WHERE id = :id', { replacements: { id: req.params.id }, type: 'SELECT', transaction: t });
  if (!item) throw Object.assign(new Error('Not found.'), { status: 404 });
  if (!ADMIN.includes(req.user.role) && item.owner_role !== req.user.role) throw Object.assign(new Error('This item belongs to another team.'), { status: 403 });
}

router.use(protect, restrictTo(...ROLES));
router.get('/', handle('Could not load the worklist', (req, t) => W.list({
  status: req.query.status === 'all' ? null : req.query.status || 'Open', kind: req.query.kind || null,
  role: ADMIN.includes(req.user.role) ? (req.query.role || null) : req.user.role,
}, t)));
router.post('/:id/assign', handle('Could not take the item', async (req, t) => { await mine(req, t); return W.assign(req.params.id, null, req.user, t); }));
router.post('/:id/resolve', handle('Could not resolve the item', async (req, t) => { await mine(req, t); return W.resolve(req.params.id, req.body?.resolution, req.user, t); }));

module.exports = router;
