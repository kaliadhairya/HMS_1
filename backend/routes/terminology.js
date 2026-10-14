const express = require('express');
const multer = require('multer');
const os = require('os');
const fs = require('fs');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const T = require('../services/terminology');
const { idempotencyGuard } = require('../utils/idempotency');

// Terminology releases and mappings (Phase 6A). Mounted at /api/terminology.
// Loading a release file and activating it are administrator commands; a
// mapping is proposed by one person and reviewed by another. Every command
// needs an Idempotency-Key (utils/idempotency.js).
const router = express.Router();
const ADMIN = ['super_admin', 'admin'];
const CLINICAL = [...ADMIN, 'doctor', 'nurse', 'lab_technician', 'pharmacist'];
const MAPPERS = [...ADMIN, 'doctor', 'lab_technician', 'pharmacist'];
// Release files can be large (SNOMED CT descriptions are a few hundred MB).
const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 1024 * 1024 * 1024, files: 1 } });
// The idempotency guard runs after the upload is parsed, so a retried upload
// is recognised by the file's checksum (utils/idempotency.js).
const uploadRelease = (req, res, next) => upload.single('file')(req, res, (err) => {
  if (err) return res.status(400).json({ success: false, message: err.message || 'Upload failed' });
  req.multipartParsed = true;
  return idempotencyGuard(req, res, next).catch(next);
});

function sendError(res, err, fallback) {
  const code = err.original?.code || err.parent?.code;
  if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
  if (code === '55P03' || code === '40P01' || code === '40001') return res.status(409).json({ success: false, code: 'BUSY', message: 'Someone else is changing this. Try again.' });
  if (code === '22P02') return res.status(400).json({ success: false, message: 'That identifier is not valid.' });
  if (['23514', '23001', '23505', '23503'].includes(code)) return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
  console.error(`${fallback}:`, err.original?.message || err.message);
  return res.status(500).json({ success: false, message: fallback });
}

const handle = (fallback, fn, { status = 200 } = {}) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    if (data === undefined || data === null) return res.status(404).json({ success: false, message: 'Not found.' });
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    return sendError(res, err, fallback);
  } finally {
    if (req.file) fs.rm(req.file.path, { force: true }, () => {});
  }
};

router.use(protect);

router.get('/systems', restrictTo(...CLINICAL), handle('Could not load code systems', (req, t) => T.listSystems(t)));

router.get('/search', restrictTo(...CLINICAL), handle('Search failed', (req, t) => T.search({
  system: String(req.query.system || ''), releaseId: req.query.release || null, q: req.query.q, limit: req.query.limit,
}, t)));

// Multipart: file + system, version, format, source, licenceAck, releasedOn.
router.post('/releases', restrictTo(...ADMIN), uploadRelease, handle('Could not load the release', async (req, t) => {
  if (!req.file) T.fail(400, 'Attach the release file.');
  return T.loadRelease({
    system: req.body.system, version: req.body.version, releasedOn: req.body.releasedOn || null, source: req.body.source,
    licenceAck: req.body.licenceAck, fileName: req.file.originalname, format: req.body.format, buffer: fs.readFileSync(req.file.path), user: req.user,
  }, t);
}, { status: 201 }));

router.post('/releases/:id/activate', restrictTo(...ADMIN), handle('Could not activate the release', (req, t) => T.activateRelease(req.params.id, req.user, t)));

router.get('/mappings', restrictTo(...CLINICAL), handle('Could not load mappings', (req, t) => T.listMappings({ status: req.query.status || null }, t)));

router.post('/mappings', restrictTo(...MAPPERS), handle('Could not propose the mapping', (req, t) => T.proposeMapping(req.body || {}, req.user, t), { status: 201 }));

router.post('/mappings/:id/review', restrictTo(...MAPPERS), handle('Could not record the review', (req, t) => T.reviewMapping(req.params.id, req.body || {}, req.user, t)));

module.exports = router;
