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
    const refs = new Set((JSON.stringify([...have.values()]).match(/"reference":"(Practitioner|Encounter|Specimen|Organization)\/[^"]+"/g) || []).map((m) => m.slice(13, -1)));
    let added = false;
    for (const ref of refs) {
      if (have.has(ref)) continue;
      const [type, id] = ref.split('/');
      const r = type === 'Practitioner' ? await F.practitioner(id, t)
        : type === 'Encounter' ? (await F.encounter(id, t)).resource
          : type === 'Specimen' ? (await F.specimen(id, t)).resource : await F.organization(t);
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
  const all = [composition, ...resources];
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
  const id = docId('OPConsultation', encounterId, e.updated_at || e.created_at);
  return {
    id, hiType: 'OPConsultation',
    bundle: await withClosure({
      id, profile: 'OPConsultRecord', title: 'Consultation Report', type: { ...sct('371530004', 'Clinical consultation report'), text: 'Clinical consultation report' },
      patient, encounter, author, date: F.instant(e.updated_at || e.created_at),
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

module.exports = { opConsultation, diagnosticReport, docId };
