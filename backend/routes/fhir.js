const express = require('express');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { patientInCare, NOT_IN_CARE } = require('../utils/careTeam');
const F = require('../services/fhir');
const C = require('../services/fhirClinical.cts');
const Documents = require('../services/fhirDocuments');

// FHIR R4 read boundary (Phase 6B). Mounted at /api/fhir. Same sign-in,
// roles and care-team scope as the application; every read is audited with
// its purpose (middleware/accessAudit.js). There are no FHIR writes: changes
// go through the application's clinical commands.
const router = express.Router();
const READERS = ['super_admin', 'admin', 'doctor', 'nurse', 'lab_technician'];
// ABDM purpose-of-use codes accepted on a read; care management by default.
const PURPOSES = ['CAREMGT', 'BTG', 'PUBHLTH', 'HPAYMT', 'DSRCH', 'PATRQT'];
const FHIR_JSON = 'application/fhir+json; fhirVersion=4.0';

const base = (req) => `${req.protocol}://${req.get('host')}${req.baseUrl}`;
const send = (res, status, body) => res.status(status).set('Cache-Control', 'no-store').type(FHIR_JSON).send(JSON.stringify(body));
const issue = (res, status, code, message) => send(res, status, F.outcome(status >= 500 ? 'fatal' : 'error', code, message));

// The capability statement holds no patient data.
router.get('/metadata', (req, res) => send(res, 200, F.capabilityStatement(base(req))));

router.use(protect, restrictTo(...READERS));
router.use((req, res, next) => {
  if (req.method !== 'GET') return issue(res, 405, 'not-supported', 'This FHIR server is read-only. Use the application to record or change care.');
  const purpose = String(req.get('x-purpose-of-use') || 'CAREMGT').toUpperCase();
  if (!PURPOSES.includes(purpose)) return issue(res, 400, 'invalid', `X-Purpose-Of-Use must be one of ${PURPOSES.join(', ')}.`);
  res.locals.auditDetail = `fhir purpose=${purpose}`;
  return next();
});

// Resolves the request to one patient, checks scope, then answers.
const read = (fn) => async (req, res) => {
  try {
    const out = await sequelize.transaction({ readOnly: true }, async (t) => {
      const result = await fn(req, t);
      if (result.patientId) {
        res.locals.auditPatientId = result.patientId;
        if (req.user.role === 'doctor' && !(await patientInCare(req.user.id, result.patientId, t))) {
          throw Object.assign(new Error(NOT_IN_CARE), { status: 403, code: 'forbidden' });
        }
      }
      return result.body;
    });
    return send(res, 200, out);
  } catch (err) {
    if (err.status) return issue(res, err.status, err.code || 'processing', err.message);
    if ((err.original || err.parent)?.code === '22P02') return issue(res, 404, 'not-found', 'Not found.');
    console.error('FHIR read failed:', err.original?.message || err.message);
    return issue(res, 500, 'exception', 'The resource could not be read.');
  }
};

// A search needs the patient (?patient=123 or Patient/123).
function patientParam(req) {
  const raw = String(req.query.patient || req.query.subject || '').replace(/^Patient\//, '');
  if (!/^\d+$/.test(raw)) throw Object.assign(new Error('Search by patient: ?patient=<id>.'), { status: 400, code: 'required' });
  return Number(raw);
}
const search = (type, load) => read(async (req, t) => {
  const patientId = patientParam(req);
  await F.patientRow(patientId, t);
  return { patientId, body: F.searchset(base(req), await load(patientId, req, t)) };
});

router.get('/Patient/:id', read(async (req, t) => ({ patientId: (await F.patientRow(req.params.id, t)).id, body: await F.patient(req.params.id, t) })));
router.get('/Patient', read(async (req, t) => {
  // identifier=system|value: the hospital UHID or a verified ABHA number.
  const [system, value] = String(req.query.identifier || '').split('|');
  if (!value) throw Object.assign(new Error('Search patients by identifier=system|value.'), { status: 400, code: 'required' });
  const found = system === 'https://healthid.ndhm.gov.in'
    ? await sequelize.query(`SELECT patient_id AS id FROM hms_patient_identifiers WHERE system = 'ABHA_NUMBER' AND value = :v AND verification_status = 'verified' AND verified_via = 'abdm'`, { replacements: { v: value.replace(/-/g, '') }, type: 'SELECT', transaction: t })
    : system === F.local('uhid') ? await sequelize.query('SELECT id FROM hms_patients WHERE uhid = :v', { replacements: { v: value }, type: 'SELECT', transaction: t }) : [];
  if (found.length > 1) throw Object.assign(new Error('More than one patient has this identifier; resolve it in duplicate review.'), { status: 409, code: 'multiple-matches' });
  if (!found.length) return { body: F.searchset(base(req), []) };
  return { patientId: found[0].id, body: F.searchset(base(req), [await F.patient(found[0].id, t)]) };
}));

router.get('/Practitioner/:id', read(async (req, t) => ({ body: await F.practitioner(req.params.id, t) })));
router.get('/PractitionerRole/:id', read(async (req,t)=>({body:await C.practitionerRole(req.params.id,t)})));
router.get('/Location/:id', read(async (req,t)=>({body:await C.location(req.params.id,t)})));
for (const type of ['MedicationRequest','MedicationDispense','MedicationAdministration']) {
  router.get(`/${type}`, search(type,(p,req,t)=>C.medications(type,p,t)));
  router.get(`/${type}/:id`,read(async(req,t)=>{const r=await C.medicationById(type,req.params.id,t);return {patientId:r.patientId,body:r.resource};}));
}
router.get('/ServiceRequest',search('ServiceRequest',(p,req,t)=>C.serviceRequests(p,t)));
router.get('/ServiceRequest/:id',read(async(req,t)=>{const r=await C.serviceRequestById(req.params.id,t);return {patientId:r.patientId,body:r.resource};}));
router.get('/Organization/:id', read(async (req, t) => {
  if (req.params.id !== 'hospital') throw Object.assign(new Error(`Organization/${req.params.id} not found.`), { status: 404, code: 'not-found' });
  return { body: await F.organization(t) };
}));

router.get('/Encounter/:id', read(async (req, t) => { const r = await F.encounter(req.params.id, t); return { patientId: r.patientId, body: r.resource }; }));
router.get('/Encounter', search('Encounter', (p, req, t) => F.encounters(p, t)));
router.get('/Condition/:id', read(async (req, t) => { const r = await F.conditionById(req.params.id, t); return { patientId: r.patientId, body: r.resource }; }));
router.get('/Condition', search('Condition', (p, req, t) => F.conditions(p, t)));
router.get('/AllergyIntolerance', search('AllergyIntolerance', (p, req, t) => F.allergies(p, t)));
router.get('/Observation', search('Observation', async (p, req, t) => {
  const category = String(req.query.category || '').split('|').pop();
  if (category && !['vital-signs', 'laboratory'].includes(category)) throw Object.assign(new Error('category must be vital-signs or laboratory.'), { status: 400, code: 'not-supported' });
  return [...(category !== 'laboratory' ? await F.vitals(p, t) : []), ...(category !== 'vital-signs' ? await F.labResults(p, t) : [])];
}));
router.get('/Observation/:id', read(async (req, t) => {
  const [, kind, rest] = String(req.params.id).match(/^(vs|lab)-(.+)$/) || [];
  if (!kind) throw Object.assign(new Error(`Observation/${req.params.id} not found.`), { status: 404, code: 'not-found' });
  if (kind === 'lab') {
    const [row] = await sequelize.query(`SELECT o.patient_id FROM hms_lab_result_versions rv JOIN hms_lab_report_results rr ON rr.result_version_id = rv.id
      JOIN hms_investigation_order_items i ON i.id = rv.item_id JOIN hms_investigation_orders o ON o.id = i.order_id WHERE rv.id = :id LIMIT 1`, { replacements: { id: rest }, type: 'SELECT', transaction: t });
    const obs = row && (await F.labResults(row.patient_id, t)).find((o) => o.id === req.params.id);
    if (!obs) throw Object.assign(new Error(`Observation/${req.params.id} not found.`), { status: 404, code: 'not-found' });
    return { patientId: row.patient_id, body: obs };
  }
  const vitalId = Number(rest.split('-')[0]);
  const [row] = await sequelize.query('SELECT patient_id FROM hms_vitals WHERE id = :id', { replacements: { id: vitalId || 0 }, type: 'SELECT', transaction: t });
  const obs = row && (await F.vitals(row.patient_id, t)).find((o) => o.id === req.params.id);
  if (!obs) throw Object.assign(new Error(`Observation/${req.params.id} not found.`), { status: 404, code: 'not-found' });
  return { patientId: row.patient_id, body: obs };
}));
router.get('/DiagnosticReport/:id', read(async (req, t) => { const r = await F.diagnosticReport(req.params.id, t); return { patientId: r.patientId, body: r.resource }; }));
router.get('/DiagnosticReport', search('DiagnosticReport', (p, req, t) => F.diagnosticReports(p, t)));
router.get('/Specimen/:id', read(async (req, t) => { const r = await F.specimen(req.params.id, t); return { patientId: r.patientId, body: r.resource }; }));

router.get('/documents/prescription/:id',read(async(req,t)=>{const r=await Documents.prescription(req.params.id,t);return {patientId:r.patientId,body:r.bundle};}));
router.get('/documents/discharge/:signatureId',read(async(req,t)=>{const r=await Documents.dischargeSummary(req.params.signatureId,t);return {patientId:r.patientId,body:r.bundle};}));
router.get('/documents/consultation/:id',read(async(req,t)=>{
  const e=await F.encounter(`opd-${req.params.id}`,t);
  if(e.resource.status!=='finished')throw Object.assign(new Error('Only finalized consultations can be exported.'),{status:409,code:'NOT_FINALIZED'});
  const r=await Documents.opConsultation(req.params.id,t);return {patientId:e.patientId,body:r.bundle};
}));
router.get('/documents/laboratory/:id',read(async(req,t)=>{
  const r=await F.diagnosticReport(req.params.id,t);return {patientId:r.patientId,body:(await Documents.diagnosticReport(req.params.id,t)).bundle};
}));
router.use((req, res) => issue(res, 404, 'not-supported', `${req.path} is not supported. See ${base(req)}/metadata.`));

module.exports = router;
