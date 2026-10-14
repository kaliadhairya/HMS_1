const express = require('express');
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const DT = require('../services/downtime');
const ST = require('../services/downtimeStations.cts');

// Downtime kit and reconciliation (Phase 6I), mounted at /api/downtime.
// Administrators declare and close a downtime; every staff role logs the
// paper records they made; a second person checks what was entered.
const router = express.Router();
const ADMIN = ['super_admin', 'admin'];
const STAFF = [...ADMIN, 'doctor', 'nurse', 'lab_technician', 'pharmacist', 'receptionist'];
const handle = (fallback, fn, status = 200) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
    const code = (err.original || err.parent)?.code;
    if (code === '22P02') return res.status(400).json({ success: false, message: 'That identifier is not valid.' });
    if (['23505', '23514'].includes(code)) return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
    console.error(`${fallback}:`, err.original?.message || err.message);
    return res.status(500).json({ success: false, message: fallback });
  }
};

// Ward machines (completion C6) authenticate with their own token, not a
// staff session: they fetch the newest kit and confirm each one they stored.
const station = async (req, res, next) => {
  try {
    req.station = await ST.authenticate(req.get('authorization'));
    if (!req.station) return res.status(401).json({ success: false, code: 'STATION_UNKNOWN', message: 'This machine is not registered, or was revoked.' });
    return next();
  } catch (err) { return next(err); }
};
router.get('/station/kit', station, async (req, res) => {
  try {
    const { snapshot, content } = await ST.latestKit(req.station);
    res.set({ 'Cache-Control': 'no-store', 'Content-Type': 'application/json', 'X-Kit-Sha256': snapshot.sha256, 'X-Kit-Snapshot': snapshot.id, 'X-Kit-File': snapshot.file_name });
    return res.send(content);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    console.error('Downtime kit pull failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not send the kit.' });
  }
});
router.post('/station/ack', station, handle('Could not record the stored kit', (req, t) => ST.acknowledge(req.station, req.body || {}, t)));

router.use(protect, restrictTo(...STAFF));
router.get('/status', handle('Could not load downtime status', (req, t) => DT.status(t)));
router.post('/snapshots', restrictTo(...ADMIN), async (req, res) => {
  try {
    const made = await DT.snapshot(req.user);
    await ST.checkBehind().catch((err) => console.error('Ward machine check failed:', err.message));
    res.status(201).json({ success: true, data: made });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    console.error('Downtime kit failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not refresh the downtime kit.' });
  }
});
// The newest kit, still encrypted, for copying to ward machines.
router.get('/kit/latest', restrictTo(...ADMIN), (req, res) => {
  const file = path.join(process.env.DOWNTIME_KIT_DIR || '/nonexistent', 'downtime-latest.hmskit.json');
  if (!fs.existsSync(file)) return res.status(404).json({ success: false, message: 'No downtime kit has been made yet.' });
  res.set('Cache-Control', 'no-store').download(file);
});
router.get('/stations', restrictTo(...ADMIN), handle('Could not list ward machines', (req, t) => ST.list(t)));
router.post('/stations', restrictTo(...ADMIN), handle('Could not register the machine', (req, t) => ST.register(req.body || {}, req.user, t), 201));
router.post('/stations/:id/revoke', restrictTo(...ADMIN), handle('Could not revoke the machine', (req, t) => ST.revoke(req.params.id, req.body || {}, req.user, t)));
router.get('/episodes', handle('Could not load downtimes', (req, t) => DT.episodes(t)));
router.post('/episodes', restrictTo(...ADMIN), handle('Could not declare the downtime', (req, t) => DT.declare(req.body || {}, req.user, t), 201));
router.post('/episodes/:id/end', restrictTo(...ADMIN), handle('Could not end the downtime', (req, t) => DT.end(req.params.id, req.user, t)));
router.post('/episodes/:id/close', restrictTo(...ADMIN), handle('Could not close the downtime', (req, t) => DT.close(req.params.id, req.user, t)));
router.post('/episodes/:id/entries', handle('Could not log the paper record', (req, t) => DT.logEntry(req.params.id, req.body || {}, req.user, t), 201));
router.post('/entries/:id/entered', handle('Could not link the entered record', (req, t) => DT.markEntered(req.params.id, req.body || {}, req.user, t)));
router.post('/entries/:id/reconcile', handle('Could not record the check', (req, t) => DT.reconcile(req.params.id, req.body || {}, req.user, t)));
router.post('/entries/:id/void', handle('Could not void the entry', (req, t) => DT.voidEntry(req.params.id, req.body || {}, req.user, t)));

module.exports = router;
