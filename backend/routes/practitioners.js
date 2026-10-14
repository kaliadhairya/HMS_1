const express = require('express');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { logAction } = require('../utils/auditLogger');

// Practitioners and their credentials (migration 0012). Mounted at /api/practitioners.
// Administrators record and verify registrations; front desk can see who is
// current. Doctors see their own status.
const router = express.Router();

const VIEWERS = ['super_admin', 'admin', 'receptionist'];
const ADMINS = ['super_admin', 'admin'];
const KINDS = new Set(['medical_registration', 'specialist_registration','nursing_registration','pharmacy_registration','laboratory_qualification', 'other']);

const text = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const fail = (res, status, message) => res.status(status).json({ success: false, message });
const select = (sql, replacements, transaction) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction });
const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v;

const CREDENTIAL_STATUS = `CASE
 WHEN c.ended_by IS NOT NULL THEN 'ended'
 WHEN c.verified_at IS NULL OR c.verified_at>now() OR c.verified_by IS NULL
 OR c.verified_by=c.created_by OR c.verified_by=(SELECT p.user_id FROM hms_practitioners p WHERE p.id=c.practitioner_id)
 OR length(btrim(coalesce(c.verification_evidence->>'reference',''))) < 3
 OR length(btrim(coalesce(c.verification_evidence->>'reason',''))) < 10 THEN 'unverified'
 WHEN c.valid_from>hms_service_today() THEN 'not yet valid'
 WHEN c.valid_to IS NOT NULL AND c.valid_to<hms_service_today() THEN 'expired'
 ELSE 'current' END`;

async function practitionerByUser(userId, transaction) {
  const [row] = await select('SELECT p.id, p.public_id, p.user_id, p.display_name,u.role FROM hms_practitioners p JOIN hms_users u ON u.id=p.user_id WHERE p.user_id = :userId', { userId }, transaction);
  return row || null;
}

async function credentialsOf(practitionerId) {
  return select(
    `SELECT c.id, c.kind, c.identifier, c.issuing_body, c.valid_from, c.valid_to, c.verified_at, c.verified_by,c.created_by,c.verification_evidence,c.ended_reason,
            ${CREDENTIAL_STATUS} AS status
       FROM hms_practitioner_credentials c WHERE c.practitioner_id = :practitionerId
      ORDER BY c.valid_to IS NULL DESC, c.valid_to DESC NULLS FIRST, c.id`,
    { practitionerId }
  );
}

// GET /api/practitioners — everyone with a practitioner record, and whether they may practise today.
router.get('/', protect, restrictTo(...VIEWERS), async (req, res) => {
  try {
    const rows = await select(
      `SELECT p.id, p.public_id, p.user_id, p.display_name, u.username,u.role, u.is_active,
              (SELECT count(*) FROM hms_practitioner_credentials c WHERE c.practitioner_id = p.id) AS credential_count,
              NOT hms_current_professional_credential(p.user_id,u.role) AS registration_expired
         FROM hms_practitioners p JOIN hms_users u ON u.id = p.user_id
        ORDER BY p.display_name, p.id`
    );
    res.json({ success: true, data: rows });
  } catch (err) {
    console.error('Practitioner list failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load practitioners.' });
  }
});

// GET /api/practitioners/:userId — one practitioner with credentials. A doctor may read their own.
router.get('/:userId', protect, async (req, res) => {
  try {
    const userId = posInt(req.params.userId);
    if (!userId) return fail(res, 404, 'Practitioner not found.');
    const own = req.user.id === userId;
    if (!own && !VIEWERS.includes(req.user.role)) return fail(res, 403, 'You do not have permission to view this.');
    const practitioner = await practitionerByUser(userId);
    if (!practitioner) return fail(res, 404, 'Practitioner not found.');
    const credentials = await credentialsOf(practitioner.id);
    const [{ expired }] = await select('SELECT NOT hms_current_professional_credential(:userId,:role) AS expired', { userId,role:practitioner.role });
    res.json({ success: true, data: { ...practitioner, credentials, registration_expired: Boolean(expired) } });
  } catch (err) {
    console.error('Practitioner view failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not load the practitioner.' });
  }
});

// POST /api/practitioners/:userId/credentials — record a registration (unverified until checked).
router.post('/:userId/credentials', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const kind = text(req.body.kind, 40);
    const identifier = text(req.body.identifier, 80);
    const issuingBody = text(req.body.issuingBody, 120);
    const validFrom = text(req.body.validFrom, 10);
    const validTo = text(req.body.validTo, 10);
    if (!KINDS.has(kind)) return fail(res, 400, 'Choose a supported professional registration or qualification kind.');
    if (!identifier) return fail(res, 400, 'Registration number is required.');
    if (!issuingBody) return fail(res, 400, 'Say which council or body issued it.');
    if (!isDate(validFrom)) return fail(res, 400, 'Valid-from date must be YYYY-MM-DD.');
    if (validTo && !isDate(validTo)) return fail(res, 400, 'Valid-to date must be YYYY-MM-DD.');
    if (validTo && validTo < validFrom) return fail(res, 400, 'Valid-to cannot be before valid-from.');

    const result = await sequelize.transaction(async (transaction) => {
      const userId = posInt(req.params.userId);
      const [login] = await select("SELECT id, role FROM hms_users WHERE id = :userId", { userId: userId || 0 }, transaction);
      if (!login) return { status: 404, message: 'Account not found.' };
      if (!['doctor','nurse','pharmacist','lab_technician'].includes(login.role)) return { status: 400, message: 'A clinical staff account is required.' };
      const practitioner = (await practitionerByUser(userId, transaction)) || (await select(
        'INSERT INTO hms_practitioners (user_id, display_name) SELECT u.id, COALESCE(NULLIF(btrim(u.name), \'\'), u.username) FROM hms_users u WHERE u.id = :userId RETURNING id, user_id, display_name',
        { userId }, transaction))[0];
      const [row] = await select(
        `INSERT INTO hms_practitioner_credentials (practitioner_id, kind, identifier, issuing_body, valid_from, valid_to, created_by)
         VALUES (:practitionerId, :kind, :identifier, :issuingBody, :validFrom, :validTo, :userId)
         RETURNING id, kind, identifier, issuing_body, valid_from, valid_to, verified_at`,
        { practitionerId: practitioner.id, kind, identifier, issuingBody, validFrom, validTo: validTo || null, userId: req.user.id },
        transaction
      );
      return { row };
    });
    if (result.status) return fail(res, result.status, result.message);
    await logAction(req.user.id, 'CREATE', 'practitioner_credential', result.row.id, null, { userId: req.params.userId, kind, issuingBody }, req.ip);
    res.status(201).json({ success: true, data: result.row });
  } catch (err) {
    console.error('Credential add failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not record the registration.' });
  }
});

// POST /api/practitioners/:userId/credentials/:credentialId/verify — checked against the council register.
router.post('/:userId/credentials/:credentialId/verify', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const credentialId = posInt(req.params.credentialId);
    const userId = posInt(req.params.userId);
    const reason=text(req.body.reason,500),reference=text(req.body.reference,256);
    if(!reason||reason.length<10||!reference||reference.length<3)return fail(res,422,'Record the independent verification reason and evidence reference.');
    if (!credentialId || !userId) return fail(res, 404, 'Registration not found.');
    const [candidate]=await select(`SELECT c.created_by,p.user_id FROM hms_practitioner_credentials c JOIN hms_practitioners p ON p.id=c.practitioner_id
      WHERE c.id=:credentialId AND p.user_id=:userId FOR SHARE OF c,p`,{credentialId,userId});
    if(candidate&&(candidate.created_by===req.user.id||candidate.user_id===req.user.id))return fail(res,403,'The verifier must differ from the practitioner and the person who recorded this qualification.');
    const [row] = await select(
      `UPDATE hms_practitioner_credentials c SET verified_by = :verifier, verified_at = now(),verification_evidence=CAST(:evidence AS jsonb)
         FROM hms_practitioners p
        WHERE c.id = :credentialId AND c.practitioner_id = p.id AND p.user_id = :userId
          AND (c.verified_at IS NULL OR c.verification_evidence IS NULL) AND c.ended_reason IS NULL
          AND p.user_id<>:verifier AND c.created_by IS DISTINCT FROM :verifier
        RETURNING c.id`,
      { credentialId, userId, verifier: req.user.id,evidence:JSON.stringify({reason,reference}) }
    ).catch((err) => {
      if (err.name === 'SequelizeUniqueConstraintError') throw Object.assign(new Error('duplicate'), { duplicate: true });
      throw err;
    });
    if (!row) return fail(res, 404, 'No unverified registration like that.');
    await logAction(req.user.id, 'UPDATE', 'practitioner_credential', credentialId, null, { action: 'verified' }, req.ip);
    res.json({ success: true, message: 'Registration verified.' });
  } catch (err) {
    if (err.duplicate) return fail(res, 409, 'This registration number is already verified for another practitioner.');
    console.error('Credential verify failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not verify the registration.' });
  }
});

// POST /api/practitioners/:userId/credentials/:credentialId/end — no longer valid (lapsed, struck off).
router.post('/:userId/credentials/:credentialId/end', protect, restrictTo(...ADMINS), async (req, res) => {
  try {
    const reason = text(req.body.reason, 300);
    const endOn = text(req.body.endOn, 10) || require('../utils/serviceDate').serviceDate();
    if (!reason) return fail(res, 400, 'Say why this registration ends.');
    if (!isDate(endOn)) return fail(res, 400, 'End date must be YYYY-MM-DD.');
    const [row] = await select(
      `UPDATE hms_practitioner_credentials c SET valid_to = :endOn, ended_by = :userId, ended_reason = :reason
         FROM hms_practitioners p
        WHERE c.id = :credentialId AND c.practitioner_id = p.id AND p.user_id = :practitionerUser
          AND (c.valid_to IS NULL OR c.valid_to > CAST(:endOn AS date)) AND :endOn >= c.valid_from::text
        RETURNING c.id`,
      { endOn, userId: req.user.id, reason, credentialId: posInt(req.params.credentialId) || 0, practitionerUser: posInt(req.params.userId) || 0 }
    );
    if (!row) return fail(res, 404, 'No current registration like that, or the end date is before it started.');
    await logAction(req.user.id, 'UPDATE', 'practitioner_credential', row.id, null, { action: 'ended', endOn, reason }, req.ip);
    res.json({ success: true, message: 'Registration ended.' });
  } catch (err) {
    console.error('Credential end failed:', err.message);
    res.status(500).json({ success: false, message: 'Could not end the registration.' });
  }
});

module.exports = router;
