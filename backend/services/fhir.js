// FHIR R4 (4.0.1) read representations of the domain model, profiled on the
// ABDM implementation guide ndhm.in 6.5.0 (Phase 6B). FHIR is only how data
// leaves the system; the domain tables stay the source of truth and nothing
// here writes. A coding is included only when it is real: a code from an
// active terminology release, a diagnosis coded against a recorded release,
// or a mapping a second person approved (migration 0090). Otherwise the
// clinician's text is sent as text.
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const T = require('./terminology');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };

const FHIR_VERSION = '4.0.1';
const IG = { name: 'ndhm.in', version: '6.5.0' };
const P = (name) => `https://nrces.in/ndhm/fhir/r4/StructureDefinition/${name}`;
const V2_0203 = 'http://terminology.hl7.org/CodeSystem/v2-0203';
const LOINC = 'http://loinc.org';
const UCUM = 'http://unitsofmeasure.org';
// Identifier namespaces. ABDM's are fixed by ABDM; the hospital's own are
// configured (FHIR_IDENTIFIER_BASE) and default to a URN that says so.
const ABHA_SYSTEM = 'https://healthid.ndhm.gov.in';
const HFR_SYSTEM = 'https://facility.ndhm.gov.in';
const local = (kind) => `${(process.env.FHIR_IDENTIFIER_BASE || 'urn:hms').replace(/\/$/, '')}${process.env.FHIR_IDENTIFIER_BASE ? '/' : ':'}${kind}`;

// Timestamps without a zone were written by the server in UTC.
const instant = (v) => {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(String(v)) ? v : `${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
};
const date = (v) => (v ? (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10) : undefined);
const clean = (obj) => JSON.parse(JSON.stringify(obj)); // drops undefined
const ref = (type, id, display) => clean({ reference: `${type}/${id}`, display });
const typeCode = (code, display) => ({ coding: [{ system: V2_0203, code, display }] });

// ── Patient ─────────────────────────────────────────────────
const GENDER = { Male: 'male', Female: 'female', Other: 'other', Unknown: 'unknown' };

async function patientRow(id, t) {
  const p = await one('SELECT * FROM hms_patients WHERE id = :id', { id: Number(id) || 0 }, t);
  if (!p) fail(404, `Patient/${id} not found.`, 'not-found');
  if (p.merged_into_patient_id) fail(410, `Patient/${id} was merged into Patient/${p.merged_into_patient_id}.`, 'deleted');
  return p;
}

async function patient(id, t) {
  const p = await patientRow(id, t);
  const ids = await rows(`SELECT system, value, issuer FROM hms_patient_identifiers
    WHERE patient_id = :id AND verification_status = 'verified' AND verified_via = 'abdm' AND (valid_to IS NULL OR valid_to > now())`, { id: p.id }, t);
  const identifier = [];
  if (p.uhid) identifier.push({ type: typeCode('MR', 'Medical record number'), system: local('uhid'), value: p.uhid });
  // Only ABHA numbers verified by ABDM itself are sent (blueprint 3.12).
  for (const i of ids) {
    if (i.system === 'ABHA_NUMBER') identifier.push({ type: typeCode('MR', 'Medical record number'), system: ABHA_SYSTEM, value: i.value.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, '$1-$2-$3-$4') });
  }
  if (!identifier.length) identifier.push({ type: typeCode('MR', 'Medical record number'), system: local('patient'), value: String(p.id) });
  const name = p.name || [p.first_name, p.last_name].filter(Boolean).join(' ');
  const telecom = [p.phonenumber && { system: 'phone', value: p.phonenumber, use: 'mobile' }, p.email && { system: 'email', value: p.email }].filter(Boolean);
  const address = [p.house_no, p.street, p.city, p.state, p.pin].some(Boolean)
    ? [{ line: [p.house_no, p.street].filter(Boolean), city: p.city || undefined, state: p.state || undefined, postalCode: p.pin || undefined, country: p.country || 'IN' }]
    : undefined;
  // An estimated date of birth is sent as its year only.
  const birthDate = p.dob ? (p.birth_date_estimated ? date(p.dob).slice(0, 4) : date(p.dob)) : undefined;
  return clean({
    resourceType: 'Patient', id: String(p.id),
    meta: { profile: [P('Patient')], lastUpdated: instant(p.updated_at || p.created_at) },
    identifier, active: p.is_active === 0 ? false : true, name: [{ text: name || 'Unknown' }],
    telecom: telecom.length ? telecom : undefined, gender: GENDER[p.gender] || 'unknown', birthDate, address,
  });
}

// ── Practitioner and Organization ───────────────────────────
async function practitioner(userId, t) {
  const u = await one(`SELECT u.id, u.name, u.role, u.phone, p.id AS practitioner_id, p.display_name
    FROM hms_users u LEFT JOIN hms_practitioners p ON p.user_id = u.id WHERE u.id = :id`, { id: Number(userId) || 0 }, t);
  if (!u) fail(404, `Practitioner/${userId} not found.`, 'not-found');
  const creds = u.practitioner_id ? await rows(`SELECT kind, identifier, issuing_body FROM hms_practitioner_credentials
    WHERE practitioner_id = :p AND verified_at IS NOT NULL AND ended_by IS NULL AND (valid_to IS NULL OR valid_to > now())`, { p: u.practitioner_id }, t) : [];
  const identifier = creds.filter((c) => c.kind !== 'other').map((c) => ({ type: typeCode('MD', 'Medical License number'), system: local(`registration:${c.issuing_body.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`), value: c.identifier, assigner: { display: c.issuing_body } }));
  identifier.push({ type: typeCode('EI', 'Employee number'), system: local('staff'), value: String(u.id) });
  return clean({
    resourceType: 'Practitioner', id: String(u.id), meta: { profile: [P('Practitioner')] },
    identifier, name: [{ text: u.display_name || u.name }],
    telecom: u.phone ? [{ system: 'phone', value: u.phone, use: 'work' }] : undefined,
  });
}

async function organization(t) {
  const h = await one('SELECT * FROM hms_hospital_profile LIMIT 1', {}, t).catch(() => null);
  const hfr = process.env.ABDM_HFR_ID;
  const identifier = hfr
    ? [{ type: typeCode('PRN', 'Provider number'), system: HFR_SYSTEM, value: hfr }]
    : [{ type: typeCode('PRN', 'Provider number'), system: local('facility'), value: (h && (h.reg_number || h.regnumber)) || 'hospital' }];
  return clean({
    resourceType: 'Organization', id: 'hospital', meta: { profile: [P('Organization')] },
    identifier, name: (h && h.name) || 'Hospital',
    telecom: [h?.phone && { system: 'phone', value: h.phone, use: 'work' }, h?.email && { system: 'email', value: h.email, use: 'work' }].filter(Boolean),
  });
}

// ── Encounter ───────────────────────────────────────────────
const OPD_STATUS = { Draft: 'in-progress', 'In Progress': 'in-progress', Finalized: 'finished' };
const IPD_STATUS = { Active: 'in-progress', Discharged: 'finished', Cancelled: 'cancelled' };

function opdEncounter(e) {
  return clean({
    resourceType: 'Encounter', id: `opd-${e.id}`, meta: { profile: [P('Encounter')] },
    identifier: [{ system: local('encounter'), value: `OPD-${e.id}` }],
    status: OPD_STATUS[e.status] || 'unknown',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'AMB', display: 'ambulatory' },
    subject: ref('Patient', e.patient_id),
    participant: e.doctor_id ? [{ individual: ref('Practitioner', e.doctor_id) }] : undefined,
    period: { start: instant(e.encounter_date || e.created_at), end: e.status === 'Finalized' ? instant(e.updated_at) : undefined },
    reasonCode: e.chief_complaint ? [{ text: e.chief_complaint }] : undefined,
    serviceProvider: ref('Organization', 'hospital'),
  });
}
function ipdEncounter(a) {
  return clean({
    resourceType: 'Encounter', id: `ipd-${a.id}`, meta: { profile: [P('Encounter')] },
    identifier: [{ system: local('encounter'), value: `IPD-${a.id}` }],
    status: IPD_STATUS[a.status] || 'unknown',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: ref('Patient', a.patient_id),
    participant: a.admitting_doctor_id ? [{ individual: ref('Practitioner', a.admitting_doctor_id) }] : undefined,
    period: { start: instant(a.admission_date), end: instant(a.discharge_date) },
    serviceProvider: ref('Organization', 'hospital'),
  });
}

async function encounter(id, t) {
  const [, kind, n] = String(id).match(/^(opd|ipd)-(\d+)$/) || [];
  if (!kind) fail(404, `Encounter/${id} not found.`, 'not-found');
  if (kind === 'opd') {
    const e = await one('SELECT * FROM hms_encounters WHERE id = :id', { id: Number(n) }, t);
    if (!e) fail(404, `Encounter/${id} not found.`, 'not-found');
    return { resource: opdEncounter(e), patientId: e.patient_id };
  }
  const a = await one('SELECT * FROM hms_admissions WHERE id = :id', { id: Number(n) }, t);
  if (!a) fail(404, `Encounter/${id} not found.`, 'not-found');
  return { resource: ipdEncounter(a), patientId: a.patient_id };
}

async function encounters(patientId, t) {
  const opd = await rows('SELECT * FROM hms_encounters WHERE patient_id = :p ORDER BY id DESC LIMIT 200', { p: patientId }, t);
  const ipd = await rows('SELECT * FROM hms_admissions WHERE patient_id = :p ORDER BY id DESC LIMIT 200', { p: patientId }, t);
  return [...opd.map(opdEncounter), ...ipd.map(ipdEncounter)];
}

// ── Condition (diagnoses) ───────────────────────────────────
const DX_VERIFICATION = { Provisional: 'provisional', Confirmed: 'confirmed', Differential: 'differential' };
function condition(d) {
  const coded = d.coding_status === 'CODED';
  return clean({
    resourceType: 'Condition', id: String(d.id), meta: { profile: [P('Condition')] },
    verificationStatus: DX_VERIFICATION[d.status]
      ? { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-ver-status', code: DX_VERIFICATION[d.status] }] } : undefined,
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-category', code: 'encounter-diagnosis', display: 'Encounter Diagnosis' }] }],
    code: coded
      ? { coding: [{ system: d.system_uri, version: d.release_version, code: d.icd10_code, display: d.icd10_description }], text: d.original_text || d.icd10_description }
      // A code recorded before terminology releases existed has no known
      // edition; it is sent as text so no receiver mistakes it for a coding.
      : { text: [d.icd10_code, d.icd10_description].filter(Boolean).join(' ') + (d.icd10_code ? ' (ICD-10 edition not recorded)' : '') },
    subject: ref('Patient', d.patient_id), encounter: ref('Encounter', `opd-${d.encounter_id}`),
    recordedDate: instant(d.created_at), note: d.clinical_notes ? [{ text: d.clinical_notes }] : undefined,
  });
}
const DX_SQL = `SELECT d.*, e.patient_id, r.version AS release_version, s.uri AS system_uri
  FROM hms_diagnoses d JOIN hms_encounters e ON e.id = d.encounter_id
  LEFT JOIN hms_term_releases r ON r.id = d.term_release_id LEFT JOIN hms_term_systems s ON s.id = r.system_id`;
const conditions = async (patientId, t) => (await rows(`${DX_SQL} WHERE e.patient_id = :p ORDER BY d.id DESC LIMIT 500`, { p: patientId }, t)).map(condition);
async function conditionById(id, t) {
  const d = await one(`${DX_SQL} WHERE d.id = :id`, { id: Number(id) || 0 }, t);
  if (!d) fail(404, `Condition/${id} not found.`, 'not-found');
  return { resource: condition(d), patientId: d.patient_id };
}

// ── AllergyIntolerance ──────────────────────────────────────
const ALLERGY_CLINICAL = { ACTIVE: 'active', INACTIVE: 'inactive', RESOLVED: 'resolved' };
const ALLERGY_VERIFICATION = { UNCONFIRMED: 'unconfirmed', CONFIRMED: 'confirmed', REFUTED: 'refuted', ENTERED_IN_ERROR: 'entered-in-error' };
async function allergies(patientId, t) {
  const list = await rows(`SELECT a.*, i.code_system, i.code AS ingredient_code, i.name AS ingredient_name
    FROM hms_med_allergies a LEFT JOIN hms_med_ingredients i ON i.id = a.ingredient_id WHERE a.patient_id = :p ORDER BY a.recorded_at DESC`, { p: patientId }, t);
  const out = [];
  for (const a of list) {
    const mapped = a.ingredient_code ? await T.approvedMapping('LOCAL-MED-INGREDIENT', a.ingredient_code, 'SNOMEDCT', t) : null;
    out.push(clean({
      resourceType: 'AllergyIntolerance', id: a.id, meta: { profile: [P('AllergyIntolerance')] },
      clinicalStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical', code: ALLERGY_CLINICAL[a.clinical_status] }] },
      verificationStatus: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/allergyintolerance-verification', code: ALLERGY_VERIFICATION[a.verification_status] }] },
      code: { coding: mapped ? [{ system: mapped.system, version: mapped.version, code: mapped.code, display: mapped.display }] : undefined, text: a.clinical_text || a.ingredient_name },
      patient: ref('Patient', a.patient_id), recordedDate: instant(a.recorded_at), recorder: ref('Practitioner', a.author_user_id),
      reaction: a.reaction ? [{ description: a.reaction, manifestation: [{ text: a.reaction }] }] : undefined,
    }));
  }
  return out;
}

// ── Observations: vital signs ───────────────────────────────
// LOINC codes and UCUM units fixed by the FHIR R4 vital-signs profile.
// Weight, height and BMI are body measurements in the ABDM guide.
const VITALS = [
  ['pulse', 'pulse', '8867-4', 'Heart rate', '/min', 'beats/minute', 'ObservationVitalSigns'],
  ['respiratory_rate', 'respiratory-rate', '9279-1', 'Respiratory rate', '/min', 'breaths/minute', 'ObservationVitalSigns'],
  ['spo2', 'spo2', '2708-6', 'Oxygen saturation in Arterial blood', '%', '%', 'ObservationVitalSigns'],
  ['weight_kg', 'weight', '29463-7', 'Body weight', 'kg', 'kg', 'ObservationBodyMeasurement'],
  ['height_cm', 'height', '8302-2', 'Body height', 'cm', 'cm', 'ObservationBodyMeasurement'],
  ['bmi', 'bmi', '39156-5', 'Body mass index (BMI) [Ratio]', 'kg/m2', 'kg/m2', 'ObservationBodyMeasurement'],
];
const vitalCategory = [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'vital-signs', display: 'Vital Signs' }] }];
const qty = (value, code, unit) => ({ value: Number(value), unit, system: UCUM, code });
function vitalObservations(v) {
  const base = (key, code, display, profile = 'ObservationVitalSigns') => ({
    resourceType: 'Observation', id: `vs-${v.id}-${key}`, meta: { profile: [P(profile)] }, status: 'final', category: vitalCategory,
    code: { coding: [{ system: LOINC, code, display }], text: display }, subject: ref('Patient', v.patient_id),
    effectiveDateTime: instant(v.recorded_at), performer: v.recorded_by ? [ref('Practitioner', v.recorded_by)] : undefined,
  });
  const out = [];
  for (const [col, key, code, display, ucum, unit, profile] of VITALS) {
    if (v[col] !== null && v[col] !== undefined) out.push(clean({ ...base(key, code, display, profile), valueQuantity: qty(v[col], ucum, unit) }));
  }
  // Body temperature (8310-5); the ABDM vital-signs list only names body
  // surface temperature, which is a different measurement.
  if (v.temperature !== null && v.temperature !== undefined) {
    const f = String(v.temp_unit || '').trim().toUpperCase() === 'F';
    out.push(clean({ ...base('temperature', '8310-5', 'Body temperature'), valueQuantity: qty(v.temperature, f ? '[degF]' : 'Cel', f ? '°F' : '°C') }));
  }
  if (v.bp_systolic !== null && v.bp_diastolic !== null && v.bp_systolic !== undefined) {
    out.push(clean({
      ...base('bp', '85354-9', 'Blood pressure panel with all children optional'),
      component: [
        { code: { coding: [{ system: LOINC, code: '8480-6', display: 'Systolic blood pressure' }] }, valueQuantity: qty(v.bp_systolic, 'mm[Hg]', 'mmHg') },
        { code: { coding: [{ system: LOINC, code: '8462-4', display: 'Diastolic blood pressure' }] }, valueQuantity: qty(v.bp_diastolic, 'mm[Hg]', 'mmHg') },
      ],
    }));
  }
  return out;
}
const vitals = async (patientId, t) => (await rows('SELECT * FROM hms_vitals WHERE patient_id = :p ORDER BY recorded_at DESC LIMIT 200', { p: patientId }, t)).flatMap(vitalObservations);

// ── Laboratory: released results and reports ────────────────
// Only results on a released report version leave the system.
const INTERPRETATION = { LOW: ['L', 'Low'], HIGH: ['H', 'High'], IN_RANGE: ['N', 'Normal'] };
async function labObservation(r, t) {
  const loinc = await T.approvedMapping('LOCAL-LAB', r.test_code, 'LOINC', t);
  const unit = await T.approvedMapping('LOCAL-LAB-UNIT', r.normalized_unit, 'UCUM', t);
  const numeric = /^-?\d+(\.\d+)?$/.test(String(r.normalized_value).trim());
  const interp = INTERPRETATION[r.abnormal_flag];
  return clean({
    resourceType: 'Observation', id: `lab-${r.result_id}`, meta: { profile: [P('Observation')] }, status: r.correction_of_id ? 'corrected' : 'final',
    category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: 'laboratory', display: 'Laboratory' }] }],
    // ABDM allows only LOINC or SNOMED CT codings here: the hospital's own
    // test code goes out only through an approved LOINC mapping.
    code: { coding: loinc ? [{ system: loinc.system, version: loinc.version, code: loinc.code, display: loinc.display }] : undefined, text: r.test_name },
    subject: ref('Patient', r.patient_id), encounter: r.encounter_id ? ref('Encounter', `opd-${r.encounter_id}`) : undefined,
    effectiveDateTime: instant(r.collected_at || r.created_at), issued: instant(r.released_at),
    performer: [ref('Practitioner', r.author_user_id)],
    valueQuantity: numeric ? clean({ value: Number(r.normalized_value), unit: r.normalized_unit, system: unit ? UCUM : undefined, code: unit ? unit.code : undefined }) : undefined,
    valueString: numeric ? undefined : String(r.normalized_value),
    interpretation: interp ? [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation', code: interp[0], display: interp[1] }] }] : undefined,
    method: r.method ? { text: r.method } : undefined, specimen: r.specimen_id ? ref('Specimen', r.specimen_id) : undefined,
    note: r.remarks ? [{ text: r.remarks }] : undefined,
  });
}

const RESULT_SQL = `SELECT DISTINCT ON (rv.id) rv.id AS result_id, rv.*, rpv.released_at, o.patient_id, o.encounter_id,
    t.code_system AS test_system, t.code AS test_code, tv.name AS test_name, tv.section, s.collected_at
  FROM hms_lab_report_results rr JOIN hms_lab_report_versions rpv ON rpv.id = rr.report_version_id
  JOIN hms_lab_result_versions rv ON rv.id = rr.result_version_id
  JOIN hms_investigation_order_items i ON i.id = rv.item_id JOIN hms_investigation_orders o ON o.id = i.order_id
  JOIN hms_lab_test_versions tv ON tv.id = i.lab_test_version_id JOIN hms_lab_tests t ON t.id = tv.test_id
  LEFT JOIN hms_lab_specimens s ON s.id = rv.specimen_id`;

async function labResults(patientId, t) {
  const list = await rows(`${RESULT_SQL} WHERE o.patient_id = :p ORDER BY rv.id, rpv.released_at`, { p: patientId }, t);
  return Promise.all(list.map((r) => labObservation(r, t)));
}

const REPORT_STATUS = { PRELIMINARY: 'preliminary', FINAL: 'final', AMENDED: 'amended' };
async function diagnosticReport(versionId, t) {
  const v = await one(`SELECT rv.*, r.order_id, o.patient_id, o.encounter_id FROM hms_lab_report_versions rv
    JOIN hms_lab_reports r ON r.id = rv.report_id JOIN hms_investigation_orders o ON o.id = r.order_id WHERE rv.id = :id`, { id: versionId }, t);
  if (!v) fail(404, `DiagnosticReport/${versionId} not found.`, 'not-found');
  const results = await rows(`${RESULT_SQL} WHERE rr.report_version_id = :id ORDER BY rv.id`, { id: v.id }, t);
  const ordered = (await rows('SELECT result_version_id FROM hms_lab_report_results WHERE report_version_id = :id ORDER BY position', { id: v.id }, t)).map((r) => r.result_version_id);
  const observations = await Promise.all(results.map((r) => labObservation(r, t)));
  const specimens = [...new Set(results.map((r) => r.specimen_id).filter(Boolean))];
  // Lab section (SNOMED CT service) and panel (LOINC) codings only through
  // approved mappings; otherwise the hospital's own names as text.
  const sections = [...new Set(results.map((r) => r.section).filter(Boolean))];
  const sectionCodes = (await Promise.all(sections.map((sec) => T.approvedMapping('LOCAL-LAB-SECTION', sec, 'SNOMEDCT', t)))).filter(Boolean);
  const names = [...new Set(results.map((r) => r.test_name))];
  const panel = new Set(results.map((r) => r.test_code)).size === 1 ? await T.approvedMapping('LOCAL-LAB', results[0].test_code, 'LOINC', t) : null;
  const resource = clean({
    resourceType: 'DiagnosticReport', id: v.id, meta: { profile: [P('DiagnosticReportLab')], versionId: String(v.version) },
    identifier: [{ system: local('lab-report'), value: `${v.report_id}/${v.version}` }],
    status: REPORT_STATUS[v.status] || 'unknown',
    category: [clean({ coding: sectionCodes.length ? sectionCodes.map((c) => ({ system: c.system, version: c.version, code: c.code, display: c.display })) : undefined, text: sections.join(', ') || 'Laboratory' })],
    code: clean({ coding: panel ? [{ system: panel.system, version: panel.version, code: panel.code, display: panel.display }] : undefined, text: names.join(', ') || 'Laboratory report' }),
    subject: ref('Patient', v.patient_id), encounter: v.encounter_id ? ref('Encounter', `opd-${v.encounter_id}`) : undefined,
    issued: instant(v.released_at), performer: [ref('Organization', 'hospital')], resultsInterpreter: [ref('Practitioner', v.released_by_user_id)],
    specimen: specimens.length ? specimens.map((s) => ref('Specimen', s)) : undefined,
    result: ordered.map((id) => ref('Observation', `lab-${id}`)),
    // The release records why it was released, not a clinical conclusion;
    // ABDM requires a conclusion element, so the report states its status.
    conclusion: `${v.status === 'AMENDED' ? 'Amended' : v.status === 'FINAL' ? 'Final' : 'Preliminary'} laboratory report, version ${v.version}.`,
  });
  return { resource, observations, patientId: v.patient_id };
}

async function diagnosticReports(patientId, t) {
  const ids = await rows(`SELECT rv.id FROM hms_lab_report_versions rv JOIN hms_lab_reports r ON r.id = rv.report_id
    JOIN hms_investigation_orders o ON o.id = r.order_id WHERE o.patient_id = :p ORDER BY rv.released_at DESC LIMIT 100`, { p: patientId }, t);
  return Promise.all(ids.map(async ({ id }) => (await diagnosticReport(id, t)).resource));
}

async function specimen(id, t) {
  const s = await one('SELECT * FROM hms_lab_specimens WHERE id = :id', { id }, t);
  if (!s) fail(404, `Specimen/${id} not found.`, 'not-found');
  return {
    patientId: s.patient_id,
    resource: clean({
      resourceType: 'Specimen', id: s.id, meta: { profile: [P('Specimen')] },
      accessionIdentifier: { system: local('accession'), value: s.accession },
      status: s.state === 'REJECTED' ? 'unsatisfactory' : 'available', type: { text: s.specimen_type },
      subject: ref('Patient', s.patient_id), parent: s.parent_id ? [ref('Specimen', s.parent_id)] : undefined,
      receivedTime: instant(s.received_at),
      collection: s.collected_at ? { collector: ref('Practitioner', s.collector_user_id), collectedDateTime: instant(s.collected_at) } : undefined,
      container: [{ description: s.container }],
    }),
  };
}

// ── Capability statement and bundles ────────────────────────
const SEARCHABLE = ['Encounter', 'Condition', 'AllergyIntolerance', 'Observation', 'DiagnosticReport'];
const READABLE = ['Patient', 'Practitioner', 'Organization', 'Encounter', 'Condition', 'Observation', 'DiagnosticReport', 'Specimen'];
function capabilityStatement(baseUrl) {
  const resource = (type) => clean({
    type, profile: { Patient: P('Patient'), Practitioner: P('Practitioner'), Organization: P('Organization'), Encounter: P('Encounter'), Condition: P('Condition'), AllergyIntolerance: P('AllergyIntolerance'), DiagnosticReport: P('DiagnosticReportLab'), Specimen: P('Specimen'), Observation: P('Observation') }[type],
    interaction: [READABLE.includes(type) && { code: 'read' }, (SEARCHABLE.includes(type) || type === 'Patient') && { code: 'search-type' }].filter(Boolean),
    searchParam: SEARCHABLE.includes(type)
      ? [{ name: 'patient', type: 'reference' }, ...(type === 'Observation' ? [{ name: 'category', type: 'token' }] : [])]
      : type === 'Patient' ? [{ name: 'identifier', type: 'token' }] : undefined,
  });
  return {
    resourceType: 'CapabilityStatement', status: 'active', date: '2026-10-14', kind: 'instance', fhirVersion: FHIR_VERSION,
    format: ['application/fhir+json'], implementationGuide: [`https://nrces.in/ndhm/fhir/r4/ImplementationGuide/ndhm.in|${IG.version}`],
    software: { name: 'HMS_1' }, implementation: { description: 'Read-only FHIR boundary. Changes go through the clinical commands of the application.', url: baseUrl },
    rest: [{
      mode: 'server',
      security: { description: 'Same sign-in, roles and patient care-team scope as the application. Every read is audited with its purpose (X-Purpose-Of-Use).' },
      resource: [...new Set([...READABLE, ...SEARCHABLE])].sort().map(resource),
    }],
  };
}

const searchset = (baseUrl, resources) => ({
  resourceType: 'Bundle', type: 'searchset', total: resources.length,
  entry: resources.map((r) => ({ fullUrl: `${baseUrl}/${r.resourceType}/${r.id}`, resource: r, search: { mode: 'match' } })),
});

const outcome = (severity, code, diagnostics) => ({ resourceType: 'OperationOutcome', issue: [{ severity, code, diagnostics }] });

module.exports = {
  FHIR_VERSION, IG, P, patientRow, patient, practitioner, organization, encounter, encounters, conditions, conditionById, allergies,
  vitals, labResults, diagnosticReport, diagnosticReports, specimen, capabilityStatement, searchset, outcome, instant, local,
};
