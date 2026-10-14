// ABDM flows (Phase 6C-6E, migration 0093). The wire format lives in
// abdmGateway.js; this file holds the hospital's rules:
//  - an ABHA is verified only through ABDM and only when ABDM's demographics
//    agree with the chart; anything else waits for a person;
//  - a patient found by ABDM discovery must hold that ABHA as ABDM-verified
//    (no matching on names);
//  - a consent is checked when records are about to leave, again just
//    before delivery, and for every request against it;
//  - records from other facilities are outside information until reviewed,
//    and are withdrawn and erased when their consent ends.
const crypto = require('crypto');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const G = require('./abdmGateway');
const AC = require('./abdmCrypto');
const D = require('./fhirDocuments');
const W = require('./worklist');
const I = require('./interfaces');
const { encrypt, decrypt } = require('../utils/encryption');

const rows = (sql, replacements, t) => sequelize.query(sql, { replacements, type: QueryTypes.SELECT, transaction: t });
const one = async (sql, replacements, t) => (await rows(sql, replacements, t))[0] || null;
const fail = (status, message, code) => { throw Object.assign(new Error(message), { status, code }); };
const PURPOSES = ['CAREMGT', 'BTG', 'PUBHLTH', 'HPAYMT', 'DSRCH', 'PATRQT'];
const HI_TYPES = ['OPConsultation', 'DiagnosticReport', 'Prescription', 'DischargeSummary', 'ImmunizationRecord', 'HealthDocumentRecord', 'WellnessRecord'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const otpHash = (ref, otp) => crypto.createHmac('sha256', process.env.JWT_SECRET || 'otp').update(`${ref}:${otp}`).digest('hex');

// ── Demographic agreement (no fuzzy matching) ───────────────
const tokens = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((w) => w.length > 1);
const GENDER = { M: 'Male', F: 'Female', O: 'Other', MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' };
function differences(patient, profile) {
  const out = [];
  const a = tokens(patient.name || `${patient.first_name || ''} ${patient.last_name || ''}`); const b = tokens(profile.name);
  if (!a.length || !b.length || !(b.every((w) => a.includes(w)) || a.every((w) => b.includes(w)))) out.push({ field: 'name', chart: patient.name, abdm: profile.name });
  const g = GENDER[String(profile.gender || '').toUpperCase()];
  if (g && patient.gender && patient.gender !== 'Unknown' && g !== patient.gender) out.push({ field: 'gender', chart: patient.gender, abdm: g });
  const yob = Number(profile.yearOfBirth || String(profile.dateOfBirth || '').slice(0, 4)) || null;
  const chartYear = patient.dob ? new Date(patient.dob).getUTCFullYear() : (patient.age != null ? new Date().getUTCFullYear() - patient.age : null);
  const slack = patient.dob && !patient.birth_date_estimated ? 0 : 1;
  if (yob && chartYear && Math.abs(yob - chartYear) > slack) out.push({ field: 'year of birth', chart: chartYear, abdm: yob });
  return out;
}

// Records an ABDM-verified ABHA on the chart, unless it differs from the
// chart or already belongs to another patient (then a person decides).
async function attachVerifiedAbha(patientId, profile, user, t) {
  const patient = await one('SELECT * FROM hms_patients WHERE id = :id FOR UPDATE', { id: patientId }, t);
  if (!patient) fail(404, 'Patient not found.');
  const number = String(profile.abhaNumber || profile.ABHANumber || '').replace(/-/g, '');
  const address = profile.abhaAddress || profile.preferredAbhaAddress || null;
  const diff = differences(patient, profile);
  if (diff.length) {
    await W.report({ kind: 'abdm.abha_mismatch', key: `${patientId}:${number}`, title: `ABDM details for ABHA ${number} differ from ${patient.name}'s chart (${diff.map((d) => d.field).join(', ')}).`, detail: { differences: diff }, ownerRole: 'receptionist', patientId }, t);
    return { status: 'Mismatch', differences: diff, number, address };
  }
  const other = await one(`SELECT p.id, p.name, p.uhid FROM hms_patient_identifiers i JOIN hms_patients p ON p.id = i.patient_id
    WHERE i.system = 'ABHA_NUMBER' AND i.value = :v AND i.verification_status = 'verified' AND i.patient_id <> :p LIMIT 1`, { v: number, p: patientId }, t);
  if (other) {
    await W.report({ kind: 'abdm.abha_conflict', key: number, title: `ABHA ${number} is already verified for ${other.name} (${other.uhid}); review both charts in possible duplicates.`, detail: { patients: [patientId, other.id] }, ownerRole: 'receptionist', patientId }, t);
    return { status: 'Conflict', number, address };
  }
  for (const [system, value] of [['ABHA_NUMBER', number], ['ABHA_ADDRESS', address]]) {
    if (!value) continue;
    await rows(`INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_via, verified_at, verified_by, created_by)
      VALUES (:p, :system, :value, 'ABDM', 'verified', 'abdm', now(), :u, :u)
      ON CONFLICT (patient_id, system, issuer, value) WHERE valid_to IS NULL
      DO UPDATE SET verification_status = 'verified', verified_via = 'abdm', verified_at = now(), verified_by = :u RETURNING id`,
    { p: patientId, system, value, u: user.id }, t);
  }
  return { status: 'Verified', number, address };
}

// ── M1: ABHA verification and creation ──────────────────────
async function startVerification({ patientId, purpose = 'verify', method, loginHint, aadhaar }, user) {
  if (!['verify', 'enrol'].includes(purpose)) fail(400, 'purpose must be verify or enrol.');
  if (!['mobile_otp', 'aadhaar_otp', 'abha_otp'].includes(method)) fail(400, 'method must be mobile_otp, aadhaar_otp or abha_otp.');
  const patient = await one('SELECT id FROM hms_patients WHERE id = :id', { id: Number(patientId) || 0 });
  if (!patient) fail(404, 'Patient not found.');
  let response;
  if (purpose === 'enrol') {
    if (!/^\d{12}$/.test(String(aadhaar || ''))) fail(400, 'Enter the 12-digit Aadhaar number.');
    response = await G.abha('abhaEnrolOtp', { scope: ['abha-enrol'], loginHint: 'aadhaar', loginId: await G.abhaEncrypt(aadhaar), otpSystem: 'aadhaar' }, { redacted: { loginId: '[aadhaar]' }, patientId: patient.id });
  } else {
    if (!loginHint) fail(400, 'Enter the ABHA number, ABHA address or mobile number.');
    const hint = method === 'mobile_otp' ? 'mobile' : /^\d{2}-?\d{4}-?\d{4}-?\d{4}$/.test(loginHint) ? 'abha-number' : 'abha-address';
    response = await G.abha('abhaLoginOtp', { scope: ['abha-login', method === 'aadhaar_otp' ? 'aadhaar-verify' : 'mobile-verify'], loginHint: hint, loginId: await G.abhaEncrypt(String(loginHint).replace(/-/g, '')), otpSystem: method === 'aadhaar_otp' ? 'aadhaar' : 'abdm' }, { patientId: patient.id });
  }
  return one(`INSERT INTO hms_abha_verifications (patient_id, purpose, method, login_hint, gateway_txn_id, requested_by)
    VALUES (:p, :purpose, :method, :hint, :txn, :u) RETURNING id, status, requested_at`,
  { p: patient.id, purpose, method, hint: purpose === 'enrol' ? `aadhaar xxxx${String(aadhaar).slice(-4)}` : loginHint, txn: response?.txnId || null, u: user.id });
}

async function completeVerification(id, { otp, mobile }, user) {
  const v = await one('SELECT * FROM hms_abha_verifications WHERE id = :id', { id });
  if (!v) fail(404, 'Verification not found.');
  if (v.status !== 'OtpSent') fail(409, `This verification is already ${v.status.toLowerCase()}.`, 'NOT_PENDING');
  if (Date.now() - new Date(v.requested_at) > 10 * 60000) {
    await rows("UPDATE hms_abha_verifications SET status = 'Expired', completed_at = now() WHERE id = :id", { id });
    fail(409, 'The OTP has expired. Start again.', 'EXPIRED');
  }
  if (!/^\d{6}$/.test(String(otp || ''))) fail(400, 'Enter the 6-digit OTP.');
  let profile;
  try {
    profile = v.purpose === 'enrol'
      ? (await G.abha('abhaEnrolByAadhaar', { authData: { authMethods: ['otp'], otp: { txnId: v.gateway_txn_id, otpValue: await G.abhaEncrypt(otp), mobile } }, consent: { code: 'abha-enrollment', version: '1.4' } }, { redacted: { authData: '[otp]' }, patientId: v.patient_id }))?.ABHAProfile
      : (await G.abha('abhaLoginVerify', { scope: ['abha-login'], authData: { authMethods: ['otp'], otp: { txnId: v.gateway_txn_id, otpValue: await G.abhaEncrypt(otp) } } }, { redacted: { authData: '[otp]' }, patientId: v.patient_id }))?.profile;
  } catch (err) {
    if (err.status === 422) await rows("UPDATE hms_abha_verifications SET status = 'Failed', completed_at = now() WHERE id = :id", { id });
    throw err;
  }
  if (!profile) fail(502, 'ABDM did not return the ABHA profile.');
  return sequelize.transaction(async (t) => {
    const r = await attachVerifiedAbha(v.patient_id, profile, user, t);
    return one(`UPDATE hms_abha_verifications SET status = :s, abha_number = :n, abha_address = :a, profile = CAST(:p AS jsonb), differences = CAST(:d AS jsonb), completed_at = now()
      WHERE id = :id RETURNING *`, { id, s: r.status, n: /^\d{14}$/.test(r.number) ? r.number : null, a: r.address, p: JSON.stringify({ name: profile.name, gender: profile.gender, yearOfBirth: profile.yearOfBirth }), d: JSON.stringify(r.differences || null) }, t);
  });
}

// Scan and share: the patient's ABHA app sent their profile to our counter.
async function receiveShare(body, t) {
  const p = body.profile?.patient || body.patient || {};
  if (!p.abhaAddress) fail(400, 'profile.patient.abhaAddress is required.');
  const existing = await one('SELECT * FROM hms_abdm_profile_shares WHERE request_id = :r', { r: body.requestId }, t);
  const share = existing || await one(`INSERT INTO hms_abdm_profile_shares (request_id, hip_counter, token_number, abha_number, abha_address, profile)
    VALUES (:r, :c, nextval('hms_abdm_share_token_seq') % 1000 + 1, :n, :a, CAST(:p AS jsonb)) RETURNING *`,
  { r: body.requestId, c: body.metaData?.context || null, n: String(p.abhaNumber || '').replace(/-/g, '') || null, a: p.abhaAddress, p: JSON.stringify({ name: p.name, gender: p.gender, yearOfBirth: p.yearOfBirth, mobile: p.phoneNumber || p.mobile }) }, t);
  await G.send('shareOnShare', { acknowledgement: { abhaAddress: share.abha_address, status: 'SUCCESS', profile: { context: share.hip_counter, tokenNumber: String(share.token_number), expiry: '1800' } }, response: { requestId: body.requestId } }, { correlationId: body.requestId }, t);
  return share;
}

async function linkShare(id, patientId, user) {
  return sequelize.transaction(async (t) => {
    const s = await one('SELECT * FROM hms_abdm_profile_shares WHERE id = :id FOR UPDATE', { id }, t);
    if (!s) fail(404, 'Shared profile not found.');
    if (s.status !== 'Waiting') fail(409, 'This shared profile was already handled.', 'HANDLED');
    const r = await attachVerifiedAbha(Number(patientId), { ...s.profile, abhaNumber: s.abha_number, abhaAddress: s.abha_address }, user, t);
    if (r.status !== 'Verified') return { status: r.status, differences: r.differences };
    return one("UPDATE hms_abdm_profile_shares SET status = 'Linked', patient_id = :p, handled_by = :u, handled_at = now() WHERE id = :id RETURNING *", { id, p: Number(patientId), u: user.id }, t);
  });
}
const dismissShare = (id, user, t) => one("UPDATE hms_abdm_profile_shares SET status = 'Dismissed', handled_by = :u, handled_at = now() WHERE id = :id AND status = 'Waiting' RETURNING *", { id, u: user.id }, t);

// ── M2: the hospital as HIP ─────────────────────────────────
const verifiedAbha = (patientId, t) => one(`SELECT
    max(value) FILTER (WHERE system = 'ABHA_NUMBER') AS number, max(value) FILTER (WHERE system = 'ABHA_ADDRESS') AS address
  FROM hms_patient_identifiers WHERE patient_id = :p AND verified_via = 'abdm' AND verification_status = 'verified' AND (valid_to IS NULL OR valid_to > now())`, { p: patientId }, t);

// A finalized OPD visit becomes a care context; its released lab reports
// travel with it as DiagnosticReport.
async function ensureCareContext(encounterId, t) {
  const e = await one(`SELECT e.*, u.name AS doctor FROM hms_encounters e LEFT JOIN hms_users u ON u.id = e.doctor_id WHERE e.id = :id`, { id: encounterId }, t);
  if (!e) fail(404, `Encounter ${encounterId} not found.`);
  if (e.status !== 'Finalized') fail(409, `Visit ${encounterId} is not finalized; only finished visits are shared.`, 'NOT_FINALIZED');
  const labs = await one(`SELECT count(*)::int AS n FROM hms_lab_report_versions v JOIN hms_lab_reports r ON r.id = v.report_id
    JOIN hms_investigation_orders o ON o.id = r.order_id WHERE o.encounter_id = :id`, { id: encounterId }, t);
  const types = ['OPConsultation', ...(labs.n ? ['DiagnosticReport'] : [])];
  const date = new Date(e.encounter_date || e.created_at).toISOString().slice(0, 10);
  return one(`INSERT INTO hms_abdm_care_contexts (patient_id, encounter_id, reference, display, hi_types)
    VALUES (:p, :e, :ref, :display, CAST(:types AS text[]))
    ON CONFLICT (encounter_id) DO UPDATE SET hi_types = EXCLUDED.hi_types RETURNING *`,
  { p: e.patient_id, e: e.id, ref: `OPD-${e.id}`, display: `OPD visit ${date}${e.doctor ? ` with ${e.doctor}` : ''}`, types: `{${types.join(',')}}` }, t);
}

// HIP-initiated linking: a link token for the patient, then one call per
// care context (ABDM advises one at a time).
async function linkCareContexts(patientId, encounterIds, user) {
  return sequelize.transaction(async (t) => {
    const abha = await verifiedAbha(patientId, t);
    if (!abha?.number || !abha?.address) fail(409, 'Verify this patient\'s ABHA with ABDM first.', 'ABHA_NOT_VERIFIED');
    const p = await one('SELECT * FROM hms_patients WHERE id = :id', { id: patientId }, t);
    const contexts = [];
    for (const id of encounterIds) {
      const cc = await ensureCareContext(Number(id), t);
      if (cc.patient_id !== patientId) fail(409, `Visit ${id} belongs to another patient.`);
      contexts.push(await one("UPDATE hms_abdm_care_contexts SET link_status = 'Linking', abha_address = :a, last_error = NULL WHERE id = :id AND link_status <> 'Linked' RETURNING *", { id: cc.id, a: abha.address }, t) || cc);
    }
    const requestId = crypto.randomUUID();
    await G.send('linkTokenGenerate', {
      abhaNumber: abha.number, abhaAddress: abha.address, name: p.name, gender: { Male: 'M', Female: 'F', Other: 'O' }[p.gender] || 'O',
      yearOfBirth: p.dob ? new Date(p.dob).getUTCFullYear() : new Date().getUTCFullYear() - (p.age || 0),
    }, { requestId, correlationId: `link:${patientId}`, patientId }, t);
    return contexts;
  });
}

async function onLinkToken(body, t) {
  const original = await one("SELECT * FROM hms_interface_messages WHERE system = 'abdm-gateway' AND direction = 'out' AND external_id = :r", { r: body.response?.requestId }, t);
  if (!original) fail(404, 'No link token request with that ID.');
  const patientId = Number(String(original.correlation_id).split(':')[1]);
  if (body.error || !body.linkToken) {
    await rows("UPDATE hms_abdm_care_contexts SET link_status = 'Failed', last_error = :e WHERE patient_id = :p AND link_status = 'Linking'", { p: patientId, e: JSON.stringify(body.error || 'no link token') }, t);
    await W.report({ kind: 'abdm.link_failed', key: `token:${patientId}:${original.external_id}`, title: 'ABDM refused a link token; the visits were not linked.', detail: { error: body.error }, ownerRole: 'receptionist', patientId }, t);
    return;
  }
  const p = await one('SELECT * FROM hms_patients WHERE id = :id', { id: patientId }, t);
  const pending = await rows("SELECT * FROM hms_abdm_care_contexts WHERE patient_id = :p AND link_status = 'Linking' ORDER BY created_at", { p: patientId }, t);
  for (const cc of pending) {
    await G.send('linkCareContext', {
      abhaNumber: original.payload.body.abhaNumber, abhaAddress: cc.abha_address,
      patient: [{ referenceNumber: p.uhid || String(p.id), display: p.name, careContexts: [{ referenceNumber: cc.reference, display: cc.display }], hiType: cc.hi_types[0], count: 1 }],
    }, { correlationId: `cc:${cc.id}`, patientId, headers: { 'X-LINK-TOKEN': body.linkToken } }, t);
  }
}

async function onCareContextLinked(body, t) {
  const sent = await one("SELECT * FROM hms_interface_messages WHERE system = 'abdm-gateway' AND direction = 'out' AND external_id = :r", { r: body.response?.requestId }, t);
  if (!sent || !String(sent.correlation_id).startsWith('cc:')) fail(404, 'No care-context link request with that ID.');
  const id = sent.correlation_id.slice(3);
  if (body.error) {
    await rows("UPDATE hms_abdm_care_contexts SET link_status = 'Failed', last_error = :e WHERE id = :id", { id, e: JSON.stringify(body.error) }, t);
    await W.report({ kind: 'abdm.link_failed', key: `cc:${id}`, title: 'ABDM refused to link a visit to the patient\'s ABHA.', detail: { error: body.error }, ownerRole: 'receptionist', patientId: sent.patient_id }, t);
  } else {
    await rows("UPDATE hms_abdm_care_contexts SET link_status = 'Linked', linked_via = 'hip', linked_at = now(), last_error = NULL WHERE id = :id AND link_status <> 'Linked'", { id }, t);
  }
}

// Patient-initiated discovery: only a patient holding this ABHA as
// ABDM-verified, whose details agree, is found. No search by name.
async function discover(body, t) {
  const p = body.patient || {};
  const number = (p.verifiedIdentifiers || []).find((i) => i.type === 'ABHA_NUMBER')?.value?.replace(/-/g, '');
  const found = await rows(`SELECT DISTINCT i.patient_id FROM hms_patient_identifiers i WHERE i.verified_via = 'abdm' AND i.verification_status = 'verified'
    AND ((i.system = 'ABHA_NUMBER' AND i.value = :n) OR (i.system = 'ABHA_ADDRESS' AND i.value = :a))`, { n: number || '-', a: p.id || '-' }, t);
  let result;
  if (found.length !== 1) result = { error: { code: 'ABDM-1010', message: found.length ? 'More than one record holds this ABHA; the hospital must review it.' : 'No record at this facility for this ABHA.' } };
  else {
    const patient = await one('SELECT * FROM hms_patients WHERE id = :id', { id: found[0].patient_id }, t);
    if (differences(patient, { name: p.name, gender: p.gender, yearOfBirth: p.yearOfBirth }).length) result = { error: { code: 'ABDM-1010', message: 'Details do not match the record at this facility.' } };
    else {
      const encs = await rows("SELECT id FROM hms_encounters WHERE patient_id = :p AND status = 'Finalized' ORDER BY id", { p: patient.id }, t);
      const ccs = [];
      for (const e of encs) ccs.push(await ensureCareContext(e.id, t));
      const unlinked = ccs.filter((c) => c.link_status !== 'Linked');
      result = { patient: [{ referenceNumber: patient.uhid || String(patient.id), display: patient.name, careContexts: unlinked.map((c) => ({ referenceNumber: c.reference, display: c.display })), hiType: 'OPConsultation', count: unlinked.length }], matchedBy: ['ABHA_NUMBER'] };
    }
    if (found.length > 1) await W.report({ kind: 'abdm.abha_conflict', key: number || p.id, title: 'An ABHA is verified on more than one chart; ABDM discovery could not answer.', ownerRole: 'receptionist' }, t);
  }
  await G.send('discoverOnDiscover', { transactionId: body.transactionId, ...result, response: { requestId: body.requestId } }, { correlationId: body.transactionId }, t);
  return result;
}

async function linkInit(body, t) {
  const p = (body.patient || [])[0] || {};
  const patient = await one('SELECT * FROM hms_patients WHERE uhid = :r OR id::text = :r LIMIT 1', { r: String(p.referenceNumber || '') }, t);
  const refs = (p.careContexts || []).map((c) => c.referenceNumber);
  const ccs = patient ? await rows('SELECT * FROM hms_abdm_care_contexts WHERE patient_id = :p AND reference IN (:refs)', { p: patient.id, refs: refs.length ? refs : ['-'] }, t) : [];
  const holder = patient && await one("SELECT 1 FROM hms_patient_identifiers WHERE patient_id = :p AND verified_via = 'abdm' AND system = 'ABHA_ADDRESS' AND value = :a", { p: patient.id, a: body.abhaAddress || '-' }, t);
  if (!patient || !holder || ccs.length !== refs.length || !refs.length) {
    await G.send('linkOnInit', { transactionId: body.transactionId, error: { code: 'ABDM-1011', message: 'Care contexts not found for this ABHA.' }, response: { requestId: body.requestId } }, {}, t);
    return null;
  }
  const otp = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  const ref = crypto.randomUUID();
  const expires = new Date(Date.now() + 10 * 60000);
  await rows(`INSERT INTO hms_abdm_link_requests (transaction_id, link_ref, patient_id, abha_address, care_context_ids, otp_hash, expires_at)
    VALUES (:tx, :ref, :p, :a, CAST(:ids AS uuid[]), :h, :exp)`, { tx: body.transactionId, ref, p: patient.id, a: body.abhaAddress, ids: `{${ccs.map((c) => c.id).join(',')}}`, h: otpHash(ref, otp), exp: expires }, t);
  // The OTP goes to the patient's registered mobile through the SMS provider.
  // The message text is stored encrypted: nobody reading the log sees the OTP.
  await I.enqueue({ system: 'sms', type: 'abdm-link-otp', version: '1', payload: { to: patient.phonenumber, text_enc: encrypt(`Your OTP to link records at this hospital to your ABHA is ${otp}. Valid 10 minutes.`, 'abdm.sms-text') }, patientId: patient.id, maxAttempts: 3 }, t);
  const mobile = String(patient.phonenumber || '');
  await G.send('linkOnInit', { transactionId: body.transactionId, link: { referenceNumber: ref, authenticationType: 'DIRECT', meta: { communicationMedium: 'MOBILE', communicationHint: mobile ? `******${mobile.slice(-4)}` : 'registered mobile', communicationExpiry: expires.toISOString() } }, response: { requestId: body.requestId } }, {}, t);
  return ref;
}

async function linkConfirm(body, t) {
  const c = body.confirmation || {};
  const lr = await one('SELECT * FROM hms_abdm_link_requests WHERE link_ref = :r FOR UPDATE', { r: c.linkRefNumber || '-' }, t);
  let answer;
  if (!lr || lr.status !== 'OtpSent') answer = { error: { code: 'ABDM-1012', message: 'Unknown or finished link request.' } };
  else if (new Date(lr.expires_at) < new Date()) { await rows("UPDATE hms_abdm_link_requests SET status = 'Expired' WHERE id = :id", { id: lr.id }, t); answer = { error: { code: 'ABDM-1013', message: 'The OTP has expired.' } }; }
  else if (otpHash(lr.link_ref, String(c.token || '')) !== lr.otp_hash) {
    const r = await one("UPDATE hms_abdm_link_requests SET attempts = attempts + 1, status = CASE WHEN attempts + 1 >= 5 THEN 'Failed' ELSE status END WHERE id = :id RETURNING attempts", { id: lr.id }, t);
    answer = { error: { code: 'ABDM-1014', message: r.attempts >= 5 ? 'Too many wrong OTPs; start again.' : 'Wrong OTP.' } };
  } else {
    await rows("UPDATE hms_abdm_link_requests SET status = 'Linked' WHERE id = :id", { id: lr.id }, t);
    const ccs = await rows(`UPDATE hms_abdm_care_contexts SET link_status = 'Linked', linked_via = 'patient', linked_at = now(), abha_address = :a, last_error = NULL
      WHERE id IN (:ids) RETURNING *`, { ids: lr.care_context_ids, a: lr.abha_address }, t);
    const patient = await one('SELECT * FROM hms_patients WHERE id = :id', { id: lr.patient_id }, t);
    answer = { patient: [{ referenceNumber: patient.uhid || String(patient.id), display: patient.name, careContexts: ccs.map((cc) => ({ referenceNumber: cc.reference, display: cc.display })) }] };
  }
  await G.send('linkOnConfirm', { ...answer, response: { requestId: body.requestId } }, {}, t);
  return answer;
}

// Consent artefacts and their withdrawal (HIP and HIU notifications share it).
async function storeConsent(role, detail, status, extra = {}, t) {
  const patient = role === 'HIP' ? await one(`SELECT patient_id AS id FROM hms_patient_identifiers WHERE verified_via = 'abdm' AND system = 'ABHA_ADDRESS' AND value = :a LIMIT 1`, { a: detail.patient?.id || '-' }, t) : null;
  return one(`INSERT INTO hms_abdm_consents (role, consent_id, consent_request_id, patient_id, abha_address, purpose, hi_types, care_contexts, date_from, date_to, data_erase_at, status, artefact, requester)
    VALUES (:role, :id, :req, :p, :a, :purpose, CAST(:types AS text[]), CAST(:cc AS jsonb), :from, :to, :erase, :status, CAST(:artefact AS jsonb), CAST(:requester AS jsonb))
    ON CONFLICT (role, consent_id) DO NOTHING RETURNING *`, {
    role, id: detail.consentId, req: extra.consentRequestId || null, p: extra.patientId || patient?.id || null, a: detail.patient?.id, purpose: detail.purpose?.code || 'UNKNOWN',
    types: `{${(detail.hiTypes || []).join(',')}}`, cc: JSON.stringify(detail.careContexts || []), from: detail.permission?.dateRange?.from, to: detail.permission?.dateRange?.to,
    erase: detail.permission?.dataEraseAt, status, artefact: JSON.stringify(detail), requester: JSON.stringify(detail.requester || detail.hiu || null),
  }, t);
}
async function withdrawConsent(role, consentId, status, t) {
  const c = await one("UPDATE hms_abdm_consents SET status = :s, status_changed_at = now() WHERE role = :role AND consent_id = :id AND status = 'GRANTED' RETURNING *", { role, id: consentId, s: status }, t);
  if (c && role === 'HIU') await rows("UPDATE hms_abdm_imports SET status = 'Withdrawn', withdrawn_at = now(), document = '{\"erased\": true}'::jsonb WHERE consent_id = :id AND status = 'Available'", { id: consentId }, t);
  return c;
}

async function consentNotifyHip(body, t) {
  const n = body.notification || {};
  if (n.status === 'GRANTED') await storeConsent('HIP', n.consentDetail || {}, 'GRANTED', {}, t);
  else if (['REVOKED', 'EXPIRED'].includes(n.status)) await withdrawConsent('HIP', n.consentId, n.status, t);
  await G.send('consentHipOnNotify', { acknowledgement: { status: 'ok', consentId: n.consentId || n.consentDetail?.consentId }, response: { requestId: body.requestId } }, {}, t);
}

// Is this consent usable right now for these care contexts and types?
async function usableConsent(role, consentId, t) {
  const c = await one('SELECT * FROM hms_abdm_consents WHERE role = :role AND consent_id = :id', { role, id: consentId }, t);
  if (!c) return { error: 'No such consent at this facility.' };
  if (c.status !== 'GRANTED') return { error: `The consent is ${c.status.toLowerCase()}.`, consent: c };
  if (new Date(c.data_erase_at) <= new Date()) {
    await withdrawConsent(role, consentId, 'EXPIRED', t);
    return { error: 'The consent has expired.', consent: c };
  }
  return { consent: c };
}

// A request for records: checked against the consent, then built, encrypted
// and sent; every document is recorded.
async function hiRequest(body, t) {
  const r = body.hiRequest || {};
  const consentId = r.consent?.id;
  const existing = await one('SELECT * FROM hms_abdm_hi_transfers WHERE transaction_id = :tx', { tx: body.transactionId }, t);
  if (existing) return existing;
  const { consent, error } = await usableConsent('HIP', consentId, t);
  let refusal = error || null;
  const from = new Date(r.dateRange?.from); const to = new Date(r.dateRange?.to);
  if (!refusal && (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from < new Date(consent.date_from) || to > new Date(consent.date_to))) refusal = 'The requested dates are outside the consent.';
  if (!refusal && !r.dataPushUrl) refusal = 'No data push URL.';
  const transfer = await one(`INSERT INTO hms_abdm_hi_transfers (transaction_id, consent_id, date_from, date_to, data_push_url, status, refusal)
    VALUES (:tx, :c, :f, :to, :url, :s, :refusal) RETURNING *`, { tx: body.transactionId, c: consentId || '-', f: Number.isNaN(from.getTime()) ? new Date(0) : from, to: Number.isNaN(to.getTime()) ? new Date(0) : to, url: r.dataPushUrl || '-', s: refusal ? 'Refused' : 'Queued', refusal }, t);
  await G.send('hiOnRequest', { hiRequest: { transactionId: body.transactionId, sessionStatus: refusal ? 'FAILED' : 'ACKNOWLEDGED' }, ...(refusal ? { error: { code: 'ABDM-1020', message: refusal } } : {}), response: { requestId: body.requestId } }, {}, t);
  if (refusal) return transfer;

  const docs = [];
  const allowed = new Set(consent.hi_types);
  for (const ref of consent.care_contexts) {
    const cc = await one("SELECT * FROM hms_abdm_care_contexts WHERE reference = :r AND patient_id = :p AND link_status = 'Linked'", { r: ref.careContextReference, p: consent.patient_id }, t);
    if (!cc) continue; // not ours, not linked, or another patient: never sent
    const enc = await one('SELECT * FROM hms_encounters WHERE id = :id', { id: cc.encounter_id }, t);
    const when = new Date(enc.encounter_date || enc.created_at);
    if (when < from || when > to) continue;
    if (allowed.has('OPConsultation') && cc.hi_types.includes('OPConsultation')) docs.push({ cc, ...(await D.opConsultation(cc.encounter_id, t)) });
    if (allowed.has('DiagnosticReport') && cc.hi_types.includes('DiagnosticReport')) {
      const versions = await rows(`SELECT DISTINCT ON (v.report_id) v.id FROM hms_lab_report_versions v JOIN hms_lab_reports r ON r.id = v.report_id
        JOIN hms_investigation_orders o ON o.id = r.order_id WHERE o.encounter_id = :e ORDER BY v.report_id, v.version DESC`, { e: cc.encounter_id }, t);
      for (const v of versions) docs.push({ cc, ...(await D.diagnosticReport(v.id, t)) });
    }
  }
  const texts = docs.map((d) => JSON.stringify(d.bundle));
  const { keyMaterial, content } = AC.encryptFor(r.keyMaterial, texts);
  for (const [i, d] of docs.entries()) {
    await rows('INSERT INTO hms_abdm_hi_documents (transfer_id, care_context_ref, hi_type, document_id, sha256) VALUES (:t, :ref, :type, :doc, :sha)', { t: transfer.id, ref: d.cc.reference, type: d.hiType, doc: d.id, sha: sha(texts[i]) }, t);
  }
  await G.push(r.dataPushUrl, {
    pageNumber: 1, pageCount: 1, transactionId: body.transactionId,
    entries: content.map((c, i) => ({ content: c, media: 'application/fhir+json', checksum: sha(texts[i]), careContextReference: docs[i].cc.reference })),
    keyMaterial,
  }, { correlationId: `consent:${consentId}`, patientId: consent.patient_id }, t);
  await G.send('hiNotify', { notification: { consentId, transactionId: body.transactionId, doneAt: new Date().toISOString(), notifier: { type: 'HIP', id: G.cfg().hipId },
    statusNotification: { sessionStatus: 'TRANSFERRED', hipId: G.cfg().hipId, statusResponses: [...new Set(docs.map((d) => d.cc.reference))].map((ref) => ({ careContextReference: ref, hiStatus: 'OK', description: 'Sent' })) } } }, {}, t);
  return one("UPDATE hms_abdm_hi_transfers SET status = 'Sent', sent_at = now() WHERE id = :id RETURNING *", { id: transfer.id }, t);
}

// SMS through the hospital's provider (SMS_PROVIDER_URL: POST {to, text}).
// Without one, messages fail visibly onto the worklist.
I.register('sms', async (m) => {
  if (!process.env.SMS_PROVIDER_URL) throw Object.assign(new Error('No SMS provider is configured (SMS_PROVIDER_URL).'), { permanent: false });
  const r = await fetch(process.env.SMS_PROVIDER_URL, { method: 'POST', headers: { 'content-type': 'application/json', ...(process.env.SMS_PROVIDER_TOKEN ? { authorization: `Bearer ${process.env.SMS_PROVIDER_TOKEN}` } : {}) },
    body: JSON.stringify({ to: m.payload.to, text: decrypt(m.payload.text_enc, 'abdm.sms-text') }), signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw Object.assign(new Error(`SMS provider ${r.status}`), { permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
  return { status: r.status };
}, { ownerRole: 'receptionist' });

// The consent is checked again just before encrypted records leave.
I.register('abdm-datapush', async (m) => {
  const consentId = String(m.correlation_id || '').replace(/^consent:/, '');
  const c = await one("SELECT status, data_erase_at FROM hms_abdm_consents WHERE role = 'HIP' AND consent_id = :id", { id: consentId });
  if (!c || c.status !== 'GRANTED' || new Date(c.data_erase_at) <= new Date()) throw Object.assign(new Error(`Not sent: consent ${consentId} is ${c ? c.status.toLowerCase() : 'unknown'}.`), { permanent: true });
  return G.pushSend(m);
}, { ownerRole: 'super_admin' });

// ── M3: the hospital as HIU ─────────────────────────────────
const bridgeUrl = (path) => `${(process.env.ABDM_BRIDGE_PUBLIC_URL || 'https://hms.invalid/abdm').replace(/\/$/, '')}${path}`;

async function requestConsent({ patientId, purpose, hiTypes, from, to, expiresAt }, user) {
  if (!PURPOSES.includes(purpose)) fail(400, `purpose must be one of ${PURPOSES.join(', ')}.`);
  const types = [...new Set(hiTypes || [])];
  if (!types.length || types.some((x) => !HI_TYPES.includes(x))) fail(400, `Record types must be among ${HI_TYPES.join(', ')}.`);
  const f = new Date(from); const tt = new Date(to); const exp = new Date(expiresAt);
  if ([f, tt, exp].some((d) => Number.isNaN(d.getTime())) || tt < f || exp <= new Date()) fail(400, 'Give a valid date range and an expiry in the future.');
  return sequelize.transaction(async (t) => {
    const abha = await verifiedAbha(Number(patientId), t);
    if (!abha?.address) fail(409, 'Verify this patient\'s ABHA with ABDM first.', 'ABHA_NOT_VERIFIED');
    const requestId = crypto.randomUUID();
    const row = await one(`INSERT INTO hms_abdm_consent_requests (request_id, patient_id, abha_address, purpose, hi_types, date_from, date_to, expires_at, requested_by)
      VALUES (:r, :p, :a, :purpose, CAST(:types AS text[]), :f, :to, :exp, :u) RETURNING *`,
    { r: requestId, p: Number(patientId), a: abha.address, purpose, types: `{${types.join(',')}}`, f, to: tt, exp, u: user.id }, t);
    await G.send('consentInit', { consent: {
      purpose: { text: purpose, code: purpose, refUri: 'http://terminology.hl7.org/ValueSet/v3-PurposeOfUse' },
      patient: { id: abha.address }, hiu: { id: G.cfg().hiuId }, requester: { name: user.name, identifier: { type: 'REGNO', value: String(user.id), system: 'https://www.mciindia.org' } },
      hiTypes: types, permission: { accessMode: 'VIEW', dateRange: { from: f.toISOString(), to: tt.toISOString() }, dataEraseAt: exp.toISOString(), frequency: { unit: 'HOUR', value: 1, repeats: 0 } },
    } }, { requestId, correlationId: requestId, patientId: Number(patientId) }, t);
    return row;
  });
}

async function onConsentInit(body, t) {
  const req = body.response?.requestId;
  if (body.error) return one("UPDATE hms_abdm_consent_requests SET status = 'Failed', updated_at = now() WHERE request_id = :r RETURNING *", { r: req }, t);
  return one("UPDATE hms_abdm_consent_requests SET consent_request_id = :id, status = 'Pending', updated_at = now() WHERE request_id = :r RETURNING *", { r: req, id: body.consentRequest?.id }, t);
}

async function consentNotifyHiu(body, t) {
  const n = body.notification || {};
  const status = { GRANTED: 'Granted', DENIED: 'Denied', EXPIRED: 'Expired', REVOKED: 'Revoked' }[n.status];
  const req = await one('UPDATE hms_abdm_consent_requests SET status = COALESCE(:s, status), updated_at = now() WHERE consent_request_id = :id RETURNING *', { id: n.consentRequestId, s: status || null }, t);
  for (const a of n.consentArtefacts || []) {
    if (n.status === 'GRANTED') await G.send('consentFetch', { consentId: a.id }, { correlationId: n.consentRequestId, patientId: req?.patient_id }, t);
    else await withdrawConsent('HIU', a.id, n.status === 'EXPIRED' ? 'EXPIRED' : 'REVOKED', t);
  }
  await G.send('consentHiuOnNotify', { acknowledgement: (n.consentArtefacts || []).map((a) => ({ status: 'OK', consentId: a.id })), response: { requestId: body.requestId } }, {}, t);
  return req;
}

// An artefact arrives: store it and ask the HIP(s) for the records, with a
// fresh key pair whose private half is kept encrypted until the data comes.
async function onConsentFetch(body, t) {
  const detail = body.consent?.consentDetail;
  if (!detail || body.consent?.status !== 'GRANTED') return null;
  const req = await one('SELECT * FROM hms_abdm_consent_requests WHERE consent_request_id = :id', { id: detail.consentRequestId || body.consent?.consentRequestId || '-' }, t)
    || await one("SELECT * FROM hms_abdm_consent_requests WHERE abha_address = :a AND status = 'Granted' ORDER BY updated_at DESC LIMIT 1", { a: detail.patient?.id }, t);
  if (!req) return null;
  const consent = await storeConsent('HIU', detail, 'GRANTED', { consentRequestId: req.consent_request_id, patientId: req.patient_id }, t);
  if (!consent) return null; // already stored: nothing more to ask for
  const km = AC.keyMaterial(new Date(detail.permission.dataEraseAt));
  const requestId = crypto.randomUUID();
  await rows('INSERT INTO hms_abdm_hiu_keys (transaction_id, consent_id, private_key_enc, nonce) VALUES (:tx, :c, :k, :n)', { tx: `req:${requestId}`, c: detail.consentId, k: encrypt(km.privateKeyPem, 'abdm.hiu-private-key'), n: km.material.nonce }, t);
  await G.send('hiRequest', { hiRequest: { consent: { id: detail.consentId }, dateRange: detail.permission.dateRange, dataPushUrl: bridgeUrl(G.CALLBACKS.dataPush), keyMaterial: km.material } }, { requestId, correlationId: detail.consentId, patientId: req.patient_id }, t);
  return consent;
}

async function onHiRequest(body, t) {
  const tx = body.hiRequest?.transactionId;
  if (!tx || body.error) return null;
  return one('UPDATE hms_abdm_hiu_keys SET transaction_id = :tx WHERE transaction_id = :req RETURNING transaction_id', { tx, req: `req:${body.response?.requestId}` }, t);
}

// Records pushed by a HIP: decrypted with the key for this transaction, kept
// as outside information, with medicines and allergies flagged for review.
const REVIEW = new Set(['MedicationRequest', 'MedicationStatement', 'AllergyIntolerance']);
const summarize = (r) => {
  const text = r.code?.text || r.code?.coding?.[0]?.display || r.medicationCodeableConcept?.text || r.medicationCodeableConcept?.coding?.[0]?.display || r.title || r.type?.text || '';
  return `${r.resourceType}${text ? `: ${text}` : ''}`.slice(0, 300);
};
async function receiveData(body, t) {
  const key = await one('SELECT * FROM hms_abdm_hiu_keys WHERE transaction_id = :tx FOR UPDATE', { tx: body.transactionId || '-' }, t);
  if (!key) fail(404, 'Unknown transaction.');
  const { consent, error } = await usableConsent('HIU', key.consent_id, t);
  if (error) fail(403, `Not accepted: ${error}`);
  const pem = decrypt(key.private_key_enc, 'abdm.hiu-private-key');
  let stored = 0;
  for (const [i, e] of (body.entries || []).entries()) {
    const text = AC.decryptFrom(pem, key.nonce, body.keyMaterial, e.content, i);
    if (e.checksum && e.checksum !== sha(text)) fail(422, `Entry ${i + 1} does not match its checksum.`);
    const doc = JSON.parse(text);
    const imp = await one(`INSERT INTO hms_abdm_imports (consent_id, transaction_id, patient_id, source_hip, care_context_ref, document, sha256)
      VALUES (:c, :tx, :p, :hip, :ref, CAST(:doc AS jsonb), :sha) ON CONFLICT (transaction_id, sha256) DO NOTHING RETURNING id`,
    { c: key.consent_id, tx: body.transactionId, p: consent.patient_id, hip: consent.artefact?.hip?.id || null, ref: e.careContextReference || '-', doc: text, sha: sha(text) }, t);
    if (!imp) continue;
    stored++;
    for (const entry of doc.entry || []) {
      const r = entry.resource || {};
      if (!r.resourceType || ['Composition', 'Patient', 'Practitioner', 'Organization', 'Encounter'].includes(r.resourceType)) continue;
      await rows(`INSERT INTO hms_abdm_import_items (import_id, resource_type, resource_id, summary, needs_review) VALUES (:i, :type, :id, :s, :review)
        ON CONFLICT DO NOTHING`, { i: imp.id, type: r.resourceType, id: String(r.id || crypto.randomUUID()), s: summarize(r), review: REVIEW.has(r.resourceType) }, t);
    }
  }
  await rows('UPDATE hms_abdm_hiu_keys SET used_at = now() WHERE transaction_id = :tx', { tx: body.transactionId }, t);
  if (stored) await W.report({ kind: 'abdm.import_review', key: body.transactionId, title: `Records from another facility arrived for review (${stored} document(s)).`, ownerRole: 'doctor', patientId: consent.patient_id }, t);
  await G.send('hiNotify', { notification: { consentId: key.consent_id, transactionId: body.transactionId, doneAt: new Date().toISOString(), notifier: { type: 'HIU', id: G.cfg().hiuId },
    statusNotification: { sessionStatus: 'TRANSFERRED', hipId: consent.artefact?.hip?.id, statusResponses: (body.entries || []).map((e) => ({ careContextReference: e.careContextReference, hiStatus: 'OK', description: 'Received' })) } } }, {}, t);
  return { stored };
}

const imports = (patientId, t) => rows(`SELECT i.id, i.consent_id, i.source_hip, i.care_context_ref, i.status, i.received_at, i.withdrawn_at,
    CASE WHEN i.status = 'Available' THEN i.document END AS document,
    COALESCE(json_agg(json_build_object('id', it.id, 'resource_type', it.resource_type, 'summary', it.summary, 'needs_review', it.needs_review, 'decision', it.decision, 'decision_note', it.decision_note) ORDER BY it.needs_review DESC, it.resource_type) FILTER (WHERE it.id IS NOT NULL), '[]') AS items
  FROM hms_abdm_imports i LEFT JOIN hms_abdm_import_items it ON it.import_id = i.id WHERE i.patient_id = :p GROUP BY i.id ORDER BY i.received_at DESC`, { p: patientId }, t);

// A clinician's decision on outside information. Accepting records that it
// was reviewed and is relevant; it does not create a local order or allergy.
async function decideItem(id, { decision, note }, user, t) {
  if (!['Accepted', 'Rejected', 'Seen'].includes(decision)) fail(400, 'decision must be Accepted, Rejected or Seen.');
  const it = await one(`SELECT it.*, i.status AS import_status FROM hms_abdm_import_items it JOIN hms_abdm_imports i ON i.id = it.import_id WHERE it.id = :id FOR UPDATE OF it`, { id }, t);
  if (!it) fail(404, 'Item not found.');
  if (it.import_status !== 'Available') fail(409, 'These records were withdrawn when the patient\'s consent ended.', 'WITHDRAWN');
  if (it.decision) fail(409, `Already ${it.decision.toLowerCase()}.`, 'DECIDED');
  if (decision !== 'Seen' && (!note || String(note).trim().length < 3)) fail(400, 'Add a short note to accept or reject.');
  return one('UPDATE hms_abdm_import_items SET decision = :d, decided_by = :u, decided_at = now(), decision_note = :n WHERE id = :id RETURNING *', { id, d: decision, u: user.id, n: note || null }, t);
}

// Consents past their erase time end; their imported records are erased.
async function expireConsents() {
  const due = await rows("SELECT role, consent_id FROM hms_abdm_consents WHERE status = 'GRANTED' AND data_erase_at <= now()", {});
  for (const c of due) await sequelize.transaction((t) => withdrawConsent(c.role, c.consent_id, 'EXPIRED', t));
  return due.length;
}
function startAbdmWorker() {
  const timer = setInterval(() => expireConsents().catch((err) => console.error('ABDM consent expiry failed:', err.message)), Number(process.env.ABDM_EXPIRY_POLL_MS || 60000));
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { PURPOSES, HI_TYPES, differences, attachVerifiedAbha, startVerification, completeVerification, receiveShare, linkShare, dismissShare,
  verifiedAbha, ensureCareContext, linkCareContexts, onLinkToken, onCareContextLinked, discover, linkInit, linkConfirm, storeConsent, withdrawConsent, consentNotifyHip, usableConsent, hiRequest,
  requestConsent, onConsentInit, consentNotifyHiu, onConsentFetch, onHiRequest, receiveData, imports, decideItem, expireConsents, startAbdmWorker, rows, one, fail, sha, otpHash };
