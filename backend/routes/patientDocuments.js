const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { idempotencyGuard } = require('../utils/idempotency');
const D = require('../services/patientDocuments.cts');
const logAction = require('../utils/auditLogger');

// Private patient documents (completion A4), mounted at /api/patients after
// the care-team check on /api/patients/hms/:id, so a doctor reaches only the
// documents of patients in their care. Uploads land in a private folder under
// HMS_DOCUMENT_DIR and are removed once the encrypted copy is stored.
const router = express.Router();
const READ = ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist', 'lab_technician'];
const WRITE = ['super_admin', 'admin', 'doctor', 'nurse', 'receptionist'];
const ADMIN = ['super_admin', 'admin'];

const incoming = () => {
  const dir = path.join(process.env.HMS_DOCUMENT_DIR || '/nonexistent', 'incoming');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
};
const upload = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => { try { cb(null, incoming()); } catch (err) { cb(err); } } }),
  limits: { fileSize: Number(process.env.HMS_DOCUMENT_MAX_MB || 20) * 1024 * 1024 + 1, files: 1 },
});
const receive = (req, res, next) => {
  if (!process.env.HMS_DOCUMENT_DIR) return res.status(503).json({ success: false, code: 'DOCUMENTS_OFF', message: 'Document storage is not configured (HMS_DOCUMENT_DIR).' });
  return upload.single('file')(req, res, (err) => {
    if (err) {
      const tooLarge = err.code === 'LIMIT_FILE_SIZE';
      return res.status(tooLarge ? 413 : 400).json({ success: false, code: tooLarge ? 'TOO_LARGE' : 'UPLOAD_FAILED', message: tooLarge ? `The file is larger than ${process.env.HMS_DOCUMENT_MAX_MB || 20} MB.` : err.message });
    }
    // The idempotency guard runs after parsing, so a retried upload is recognised by its checksum.
    req.multipartParsed = true;
    return idempotencyGuard(req, res, next).catch(next);
  });
};
const cleanup = (req) => { if (req.file?.path) fs.rm(req.file.path, { force: true }, () => {}); };
const id = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };

const handle = (fallback, fn, status = 200) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    const code = (err.original || err.parent)?.code;
    if (code === '42501') return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
    console.error(`${fallback}:`, err.original?.message || err.message);
    return res.status(500).json({ success: false, message: fallback });
  } finally { cleanup(req); }
};

router.get('/hms/:id/documents', protect, restrictTo(...READ), handle('Could not list documents', (req, t) => D.list(id(req.params.id), t)));
router.post('/hms/:id/documents', protect, restrictTo(...WRITE), receive,
  handle('Could not store the document', (req, t) => D.upload(id(req.params.id), req.file, req.body || {}, req.user, t), 201));
router.get('/hms/:id/documents/:docId/content', protect, restrictTo(...READ), async (req, res) => {
  try {
    const doc = await sequelize.transaction((t) => D.download(id(req.params.id), id(req.params.docId), req.user, t));
    // Every opening of a patient document is in the audit log.
    await logAction(req.user.id, 'READ', 'patient_document', doc.id, null, { patient_id: id(req.params.id), sha256: doc.sha256 }, req.ip);
    res.set({
      'Content-Type': doc.media,
      'Content-Disposition': `attachment; filename="${doc.name.replace(/"/g, '')}"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
    });
    return res.send(doc.bytes);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    console.error('Document download failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not open the document.' });
  }
});
router.post('/hms/:id/documents/:docId/withdraw', protect, restrictTo(...WRITE),
  handle('Could not withdraw the document', (req, t) => D.withdraw(id(req.params.id), id(req.params.docId), req.body || {}, req.user, t)));
router.post('/hms/:id/documents/:docId/legal-hold', protect, restrictTo(...ADMIN),
  handle('Could not change the legal hold', (req, t) => D.legalHold(id(req.params.id), id(req.params.docId), req.body || {}, req.user, t)));
router.get('/documents/report', protect, restrictTo(...ADMIN), handle('Could not build the report', (req, t) => D.report(t)));

module.exports = router;
