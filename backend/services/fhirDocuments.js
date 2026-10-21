// ABDM health documents (Phase 6D): FHIR document Bundles with a Composition,
// built from the read representations in services/fhir.js. A section is
// included only when it has content. Composition and section codes are the
// ones the ABDM guide (ndhm.in 6.5.0) defines for these record types; a lab
// report's section is coded only through an approved mapping of the lab
// section, otherwise it carries the section's own name.
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const F = require('./fhir');
const C = require('./fhirClinical.cts');
const T = require('./terminology');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const SCT = 'http://snomed.info/sct';
const base = () => (process.env.FHIR_PUBLIC_BASE_URL || 'https://hms.invalid/api/fhir').replace(/\/$/, '');
const sct = (code, display) => ({ coding: [{ system: SCT, code, display }] });
// Stable document identity: the same source version always gives the same ID.
const docId = (...parts) => {
  const h = crypto.createHash('sha256').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const entryRef = (r) => ({ reference: `${r.resourceType}/${r.id}`, type: r.resourceType });

// A document must be self-contained: add every practitioner, encounter,
// specimen and organization its resources refer to.
async function closure(resources, t) {
  const have = new Map(resources.map((r) => [`${r.resourceType}/${r.id}`, r]));
  for (let pass = 0; pass < 3; pass++) {
    const refs = new Set((JSON.stringify([...have.values()]).match(/"reference":"(Practitioner|Encounter|Specimen|Organization|MedicationRequest|Location)\/[^"]+"/g) || []).map((m) => m.slice(13, -1)));
    let added = false;
    for (const ref of refs) {
      if (have.has(ref)) continue;
      const [type, id] = ref.split('/');
      const r = type === 'Practitioner' ? await F.practitioner(id, t)
        : type === 'Encounter' ? (await F.encounter(id, t)).resource
          : type === 'Specimen' ? (await F.specimen(id, t)).resource
            : type === 'MedicationRequest' ? (await C.medicationById(type,id,t)).resource
              : type === 'Location' ? await C.location(id,t) : await F.organization(t);
      have.set(ref, r); added = true;
    }
    if (!added) break;
  }
  return [...have.values()];
}

function bundle({ id, profile, title, type, patient, encounter, author, sections, resources, date }) {
  const composition = {
    resourceType: 'Composition', id, meta: { profile: [F.P(profile)] }, language: 'en-IN',
    identifier: { system: F.local('document'), value: id }, status: 'final', type,
    subject: { reference: `Patient/${patient.id}` }, encounter: encounter ? { reference: `Encounter/${encounter.id}` } : undefined,
    date, author: [{ reference: `Practitioner/${author.id}` }], title, custodian: { reference: 'Organization/hospital' },
    section: sections.filter((s) => s.entry.length),
  };
  // Traceability (blueprint 3.11, completion B1): who authored the document, for which hospital,
  // and when. The recorded time is the document's own (signature, finalization or release).
  const provenance = {
    resourceType: 'Provenance', id: `prov-${id}`, target: [{ reference: `Composition/${id}` }], recorded: date || new Date().toISOString(),
    agent: [{
      type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/provenance-participant-type', code: 'author', display: 'Author' }] },
      who: { reference: `Practitioner/${author.id}` }, onBehalfOf: { reference: 'Organization/hospital' },
    }],
  };
  const all = [composition, ...resources, provenance];
  const seen = new Set();
  return JSON.parse(JSON.stringify({
    resourceType: 'Bundle', id, meta: { versionId: '1', lastUpdated: new Date().toISOString(), profile: [F.P('DocumentBundle')], security: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'V', display: 'very restricted' }] },
    identifier: { system: F.local('document-bundle'), value: id }, type: 'document', timestamp: new Date().toISOString(),
    entry: all.filter((r) => { const k = `${r.resourceType}/${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .map((r) => ({ fullUrl: `${base()}/${r.resourceType}/${r.id}`, resource: r })),
  }));
}

const withClosure = async (args, t) => bundle({ ...args, resources: await closure(args.resources, t) });

// OP consultation note for one finalized OPD encounter.
async function opConsultation(encounterId, t) {
  const { resource: encounter, patientId } = await F.encounter(`opd-${encounterId}`, t);
  const [e] = await rows('SELECT * FROM hms_encounters WHERE id = :id', { id: encounterId }, t);
  let signature=null;
  if(e.notes_document_id){
    [signature]=await rows('SELECT * FROM hms_document_signatures WHERE document_id=:id ORDER BY version DESC LIMIT 1',{id:e.notes_document_id},t);
    if(!signature)throw Object.assign(new Error('The consultation note has no verified signature.'),{status:409,code:'SIGNATURE_REQUIRED'});
    const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
    if(crypto.createHash('sha256').update(JSON.stringify(canonical(signature.content))).digest('hex')!==signature.digest)
      throw Object.assign(new Error('The consultation signature digest does not match.'),{status:409,code:'SIGNATURE_INTEGRITY_FAILED'});
    Object.assign(e,signature.content);
  }
  const patient = await F.patient(patientId, t);
  const author = await F.practitioner(e.doctor_id, t);
  const org = await F.organization(t);
  const conditions = (await F.conditions(patientId, t)).filter((c) => c.encounter?.reference === `Encounter/opd-${encounterId}`);
  const allergies = await F.allergies(patientId, t);
  const complaint = e.chief_complaint ? [{
    resourceType: 'Condition', id: `cc-${encounterId}`, meta: { profile: [F.P('Condition')] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item', display: 'Problem List Item' }] }],
    code: { text: e.chief_complaint }, subject: { reference: `Patient/${patientId}` }, encounter: { reference: `Encounter/opd-${encounterId}` }, recordedDate: F.instant(e.encounter_date || e.created_at),
  }] : [];
  const history = e.past_medical_history ? [{
    resourceType: 'Condition', id: `pmh-${encounterId}`, meta: { profile: [F.P('Condition')] },
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'problem-list-item', display: 'Problem List Item' }] }],
    code: { text: e.past_medical_history }, subject: { reference: `Patient/${patientId}` }, encounter: { reference: `Encounter/opd-${encounterId}` },
  }] : [];
  const id = docId('OPConsultation', encounterId, signature?.digest || e.updated_at || e.created_at);
  return {
    id, hiType: 'OPConsultation',
    bundle: await withClosure({
      id, profile: 'OPConsultRecord', title: 'Consultation Report', type: { ...sct('371530004', 'Clinical consultation report'), text: 'Clinical consultation report' },
      patient, encounter, author, date: F.instant(signature?.signed_at || e.updated_at || e.created_at),
      sections: [
        { title: 'Chief complaints', code: sct('422843007', 'Chief complaint section'), entry: complaint.map(entryRef) },
        { title: 'Allergies', code: sct('722446000', 'Allergy record'), entry: allergies.map(entryRef) },
        { title: 'Medical History', code: sct('371529009', 'History and physical report'), entry: [...history, ...conditions].map(entryRef) },
      ],
      resources: [patient, author, org, encounter, ...complaint, ...history, ...conditions, ...allergies],
    }, t),
  };
}

// Laboratory report: one released report version.
async function diagnosticReport(reportVersionId, t) {
  const { resource: report, observations, patientId } = await F.diagnosticReport(reportVersionId, t);
  const patient = await F.patient(patientId, t);
  const author = await F.practitioner(report.resultsInterpreter[0].reference.split('/')[1], t);
  const org = await F.organization(t);
  const specimens = [];
  for (const s of report.specimen || []) specimens.push((await F.specimen(s.reference.split('/')[1], t)).resource);
  const section = report.category?.[0]?.text || 'Laboratory';
  const mapped = await T.approvedMapping('LOCAL-LAB-SECTION-REPORT', section, 'SNOMEDCT', t);
  const id = docId('DiagnosticReport', reportVersionId);
  return {
    id, hiType: 'DiagnosticReport',
    bundle: await withClosure({
      id, profile: 'DiagnosticReportRecord', title: 'Diagnostic Report - Laboratory', type: { ...sct('721981007', 'Diagnostic studies report'), text: 'Diagnostic Report- Lab' },
      patient, encounter: null, author, date: report.issued,
      sections: [{ title: section, code: mapped ? { coding: [{ system: mapped.system, code: mapped.code, display: mapped.display }] } : undefined, entry: [entryRef(report)] }],
      resources: [patient, author, org, report, ...observations, ...specimens],
    }, t),
  };
}

// Only independently signed order versions enter a prescription export.
async function prescription(encounterId,t) {
  const {resource:encounter,patientId}=await F.encounter(`opd-${encounterId}`,t);
  const versions=(await C.medications('MedicationRequest',patientId,t)).filter(r=>r.encounter.reference===`Encounter/opd-${encounterId}`);
  if(!versions.length)throw Object.assign(new Error('No signed medication orders for this encounter.'),{status:409,code:'SIGNED_PRESCRIPTION_REQUIRED'});
  const patient=await F.patient(patientId,t);
  const author=await F.practitioner(versions[0].requester.reference.split('/')[1],t);
  const org=await F.organization(t);
  const date=versions.map(v=>v.authoredOn).sort().at(-1);
  const id=docId('Prescription',encounterId,...versions.map(v=>v.id).sort());
  return {id,hiType:'Prescription',patientId,bundle:await withClosure({
    id,profile:'PrescriptionRecord',title:'Prescription',type:sct('440545006','Prescription record'),patient,encounter,author,date,
    sections:[{title:'Medications',code:sct('440545006','Prescription record'),entry:versions.map(entryRef)}],
    resources:[patient,author,org,encounter,...versions],
  },t)};
}
// An immutable signature supplies discharge content and its identity. A draft
// or an unsigned historical summary is never promoted to a signed export.
async function dischargeSummary(signatureId,t) {
  const [s]=await rows(`SELECT s.*,d.patient_id,d.admission_id,d.doc_type FROM hms_document_signatures s
    JOIN hms_clinical_documents d ON d.id=s.document_id WHERE s.id=:id AND d.doc_type='discharge_summary'`,{id:Number(signatureId)||0},t);
  if(!s)throw Object.assign(new Error('Signed discharge summary not found.'),{status:404,code:'not-found'});
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  if(crypto.createHash('sha256').update(JSON.stringify(canonical(s.content))).digest('hex')!==s.digest)
    throw Object.assign(new Error('The discharge signature digest could not be verified.'),{status:409,code:'SIGNATURE_INTEGRITY_FAILED'});
  const patient=await F.patient(s.patient_id,t);
  const {resource:encounter}=await F.encounter(`ipd-${s.admission_id}`,t);
  if(encounter.status!=='finished')throw Object.assign(new Error('The admission has not completed discharge.'),{status:409,code:'DISCHARGE_NOT_COMPLETED'});
  const author=await F.practitioner(s.signed_by,t);
  const org=await F.organization(t);
  const id=docId('DischargeSummary',s.document_id,s.version,s.digest);
  const sections=Object.entries(s.content).filter(([,v])=>typeof v==='string'&&v.trim()).map(([key,value])=>({
    title:key,text:{status:'generated',div:`<div xmlns="http://www.w3.org/1999/xhtml"><p>${String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</p></div>`},
  }));
  const b=await withClosure({id,profile:'DischargeSummaryRecord',title:'Discharge summary',type:sct('373942005','Discharge summary'),
    patient,encounter,author,date:F.instant(s.signed_at),sections:[],resources:[patient,author,org,encounter]},t);
  b.entry[0].resource.section=sections;
  b.entry[0].resource.status=s.amends_version?'amended':'final';
  b.entry[0].resource.meta.versionId=String(s.version);
  return {id,hiType:'DischargeSummary',patientId:s.patient_id,bundle:b};
}

module.exports = { opConsultation, diagnosticReport, prescription, dischargeSummary, docId };
