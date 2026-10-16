const express = require('express');
const logAction = require('../utils/auditLogger');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { patientInCare, NOT_IN_CARE } = require('../utils/careTeam');
const A = require('../services/abdm');

// ABDM for staff (Phase 6C-6E), mounted at /api/abdm. Front desk verifies or
// creates ABHAs and handles profiles shared at the counter; doctors request
// records from other facilities and review what arrives. Commands need an
// Idempotency-Key.
const router = express.Router();
const DESK = ['super_admin', 'admin', 'receptionist'];
const CLINIC = ['super_admin', 'admin', 'doctor'];

const handle = (fallback, fn, status = 200) => async (req, res) => {
  try {
    const data = await fn(req);
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
    if ((err.original || err.parent)?.code === '22P02') return res.status(400).json({ success: false, message: 'That identifier is not valid.' });
    console.error(`${fallback}:`, err.original?.message || err.message);
    return res.status(500).json({ success: false, message: fallback });
  }
};
const tx = (fn) => (req) => sequelize.transaction((t) => fn(req, t));
async function inCare(req) {
  if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, Number(req.params.id)))) throw Object.assign(new Error(NOT_IN_CARE), { status: 403, code: 'PATIENT_NOT_IN_CARE' });
}

router.use(protect);

// M1
router.get('/patients/:id/abha', restrictTo(...DESK, 'doctor'), handle('Could not load ABHA status', tx(async (req, t) => ({
  verified: await A.verifiedAbha(Number(req.params.id), t),
  verifications: await A.rows('SELECT id, purpose, method, login_hint, status, abha_number, abha_address, differences, requested_at, completed_at FROM hms_abha_verifications WHERE patient_id = :p ORDER BY requested_at DESC LIMIT 20', { p: Number(req.params.id) }, t),
}))));
router.post('/patients/:id/abha/otp', restrictTo(...DESK), handle('Could not start ABHA verification', (req) => A.startVerification({ ...req.body, patientId: Number(req.params.id) }, req.user), 201));
router.post('/abha/verifications/:vid/verify', restrictTo(...DESK), handle('Could not verify the OTP', (req) => A.completeVerification(req.params.vid, req.body || {}, req.user)));
router.get('/shares', restrictTo(...DESK), handle('Could not load shared profiles', tx((req, t) => A.rows(`SELECT * FROM hms_abdm_profile_shares WHERE (:s::text IS NULL OR status = :s) ORDER BY received_at DESC LIMIT 200`, { s: req.query.status === 'all' ? null : (req.query.status || 'Waiting') }, t))));
router.post('/shares/:sid/link', restrictTo(...DESK), handle('Could not link the shared profile', (req) => A.linkShare(req.params.sid, req.body?.patientId, req.user)));
router.post('/shares/:sid/dismiss', restrictTo(...DESK), handle('Could not dismiss', tx(async (req, t) => (await A.dismissShare(req.params.sid, req.user, t)) || A.fail(409, 'Already handled.'))));

// M2
router.get('/patients/:id/care-contexts', restrictTo(...DESK, 'doctor'), handle('Could not load care contexts', tx((req, t) => A.rows('SELECT * FROM hms_abdm_care_contexts WHERE patient_id = :p ORDER BY created_at DESC', { p: Number(req.params.id) }, t))));
router.post('/patients/:id/care-contexts/link', restrictTo(...DESK), handle('Could not link the visits', (req) => {
  const ids = Array.isArray(req.body?.encounterIds) ? req.body.encounterIds : [];
  if (!ids.length) A.fail(400, 'Choose the visits to link.');
  return A.linkCareContexts(Number(req.params.id), ids, req.user);
}, 202));
router.get('/consents', restrictTo('super_admin', 'admin'), handle('Could not load consents', tx((req, t) => A.rows(`SELECT id, role, consent_id, patient_id, abha_address, purpose, hi_types, date_from, date_to, data_erase_at, status, received_at, status_changed_at
  FROM hms_abdm_consents WHERE (:role::text IS NULL OR role = :role) ORDER BY received_at DESC LIMIT 500`, { role: req.query.role || null }, t))));
router.get('/transfers', restrictTo('super_admin', 'admin'), handle('Could not load transfers', tx((req, t) => A.rows(`SELECT tr.*, COALESCE(json_agg(json_build_object('care_context', d.care_context_ref, 'hi_type', d.hi_type, 'document_id', d.document_id, 'sha256', d.sha256)) FILTER (WHERE d.id IS NOT NULL), '[]') AS documents
  FROM hms_abdm_hi_transfers tr LEFT JOIN hms_abdm_hi_documents d ON d.transfer_id = tr.id GROUP BY tr.id ORDER BY tr.received_at DESC LIMIT 200`, {}, t))));

// M3
router.post('/patients/:id/consent-requests', restrictTo(...CLINIC), handle('Could not request consent', async (req) => { await inCare(req); return A.requestConsent({ ...req.body, patientId: Number(req.params.id) }, req.user); }, 201));
router.get('/patients/:id/consent-requests', restrictTo(...CLINIC), handle('Could not load consent requests', async (req) => { await inCare(req); return A.rows('SELECT * FROM hms_abdm_consent_requests WHERE patient_id = :p ORDER BY requested_at DESC', { p: Number(req.params.id) }); }));
// Consent is checked at each use (B2); every view of outside records is in the audit log.
router.get('/patients/:id/imports', restrictTo(...CLINIC), handle('Could not load outside records', async (req) => {
  await inCare(req);
  const list = await sequelize.transaction((t) => A.imports(Number(req.params.id), t));
  await logAction(req.user.id, 'READ', 'abdm_import', Number(req.params.id), null, { imports: list.filter((i) => i.status === 'Available').length }, req.ip);
  return list;
}));
router.post('/import-items/:itemId/decision', restrictTo('doctor'), handle('Could not record the decision', tx(async (req, t) => {
  const [item] = await A.rows('SELECT i.patient_id FROM hms_abdm_import_items it JOIN hms_abdm_imports i ON i.id = it.import_id WHERE it.id = :id', { id: req.params.itemId }, t);
  if (!item) A.fail(404, 'Item not found.');
  req.params.id = item.patient_id; await inCare(req);
  return A.decideItem(req.params.itemId, req.body || {}, req.user, t);
})));

module.exports = router;
