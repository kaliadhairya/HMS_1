// ABDM M1-M3 (Phase 6C-6E) against the local mock gateway
// (backend/scripts/abdm-mock-gateway.js, ABDM_MOCK_URL). The mock is not
// ABDM: these steps prove the hospital's rules (verification, linking,
// consent enforced at use, outside records kept for review), not conformance
// with the real gateway, which needs the ABDM sandbox.
const crypto = require('crypto');
const path = require('path');
const { api, apiLogin, sql, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const MOCK = process.env.ABDM_MOCK_URL || 'http://127.0.0.1:9320';
const BRIDGE = process.env.ABDM_BRIDGE_PUBLIC_URL;
assert(BRIDGE && process.env.ABDM_GATEWAY_URL, 'ABDM_* settings are required (see the Phase 6 harness)');
const backend = path.join(__dirname, '../backend');
const AC = require(path.join(backend, 'services/abdmCrypto'));
const { decrypt } = require(path.join(backend, 'utils/encryption'));
const tag = crypto.randomUUID().slice(0, 6);
const digits = (n) => Array.from(crypto.randomBytes(n), (b) => b % 10).join('');
const mock = async (p, body) => { const r = await fetch(MOCK + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
const call = (cb, body, opts = {}) => mock('/_mock/call', { url: BRIDGE + cb, body, ...opts });
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(300); } return v; };
const receivedOn = (p, pred = () => true) => until(async () => (await mock(`/_mock/received?path=${encodeURIComponent(p)}`)).find(pred));

(async () => {
  const { step, done } = runner('ABDM');
  const desk = await apiLogin('receptionist');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const abha1 = digits(14); const addr1 = `asha${tag}@sbx`;
  let P, Q, enc1, enc2, cc1, consentHip;

  await step('Set up: two synthetic patients and their ABHA profiles at the mock gateway', async () => {
    [P] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, dob, phonenumber) VALUES ($1, $2, 'other', 36, 'Female', 'OPD', CURRENT_DATE, '1990-05-01', '9876501234') RETURNING *", [`Asha Verma ${tag}`, `ABDM-${tag}`]);
    [Q] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 40, 'Male', 'OPD', CURRENT_DATE) RETURNING *", [`Ravi Kumar ${tag}`, `ABDMQ-${tag}`]);
    await inCare(P.id);
    await mock('/_mock/profiles', { abhaNumber: abha1, abhaAddress: addr1, name: `Asha Verma ${tag}`, gender: 'F', yearOfBirth: '1990', mobile: '9876501234' });
    await mock('/_mock/profiles', { abhaNumber: digits(14), abhaAddress: `sunita${tag}@sbx`, name: 'Sunita Rao', gender: 'F', yearOfBirth: '1971', mobile: `98${digits(8)}`, enrolAadhaar: `9${digits(11)}` });
  });

  await step('M1: an ABHA is verified only through ABDM with the OTP, and the login ID and OTP travel encrypted', async () => {
    assert((await api('POST', `/abdm/patients/${P.id}/abha/otp`, { token: nurse, body: { method: 'mobile_otp', loginHint: abha1 } })).status === 403, 'nurse started ABHA verification');
    const start = await api('POST', `/abdm/patients/${P.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: abha1 } });
    assert(start.status === 201 && start.data.data.status === 'OtpSent', `start ${start.status} ${JSON.stringify(start.data)}`);
    const sent = (await mock('/_mock/received?path=/v3/profile/login/request/otp')).pop();
    assert(sent && !JSON.stringify(sent.body).includes(abha1), 'the ABHA number was sent in clear text');
    const wrong = await api('POST', `/abdm/abha/verifications/${start.data.data.id}/verify`, { token: desk, body: { otp: '000000' } });
    assert(wrong.status === 422, `wrong OTP: ${wrong.status}`);
    const again = await api('POST', `/abdm/patients/${P.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: abha1 } });
    const ok = await api('POST', `/abdm/abha/verifications/${again.data.data.id}/verify`, { token: desk, body: { otp: '123456' } });
    assert(ok.status === 200 && ok.data.data.status === 'Verified', `verify ${ok.status} ${JSON.stringify(ok.data)}`);
    const ids = await sql("SELECT system, value, verified_via FROM hms_patient_identifiers WHERE patient_id = $1 AND issuer = 'ABDM'", [P.id]);
    assert(ids.length === 2 && ids.every((i) => i.verified_via === 'abdm'), `identifiers ${JSON.stringify(ids)}`);
    const leaks = await sql("SELECT count(*)::int AS n FROM hms_interface_messages WHERE system = 'abdm-abha' AND (payload::text LIKE '%123456%' OR payload::text LIKE $1)", [`%${abha1}%`]);
    assert(leaks[0].n === 0, 'an OTP or ABHA number is stored in clear in the message log');
  });

  await step('M1: ABDM details that differ from the chart, or an ABHA already on another chart, wait for a person', async () => {
    const profiles = [{ abhaNumber: digits(14), name: 'Sunita Rao', gender: 'F', yearOfBirth: '1971', abhaAddress: `sr${tag}@sbx` }];
    await mock('/_mock/profiles', profiles[0]);
    const s = await api('POST', `/abdm/patients/${Q.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: profiles[0].abhaNumber } });
    const v = await api('POST', `/abdm/abha/verifications/${s.data.data.id}/verify`, { token: desk, body: { otp: '123456' } });
    assert(v.status === 200 && v.data.data.status === 'Mismatch' && v.data.data.differences.some((d) => d.field === 'name'), `mismatch ${JSON.stringify(v.data)}`);
    assert(!(await sql("SELECT 1 FROM hms_patient_identifiers WHERE patient_id = $1 AND verified_via = 'abdm'", [Q.id])).length, 'a mismatching ABHA was attached');
    // Same ABHA as P, offered for a chart with P's name: conflict, not a second owner.
    const [R] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, dob) VALUES ($1, $2, 'other', 36, 'Female', 'OPD', CURRENT_DATE, '1990-05-01') RETURNING id", [`Asha Verma ${tag}`, `ABDMR-${tag}`]);
    const s2 = await api('POST', `/abdm/patients/${R.id}/abha/otp`, { token: desk, body: { method: 'abha_otp', loginHint: abha1 } });
    const v2 = await api('POST', `/abdm/abha/verifications/${s2.data.data.id}/verify`, { token: desk, body: { otp: '123456' } });
    assert(v2.data.data.status === 'Conflict', `conflict ${JSON.stringify(v2.data)}`);
    const items = await sql("SELECT kind FROM hms_worklist_items WHERE status = 'Open' AND kind IN ('abdm.abha_mismatch', 'abdm.abha_conflict') AND patient_id = ANY($1)", [[Q.id, R.id]]);
    assert(items.length === 2, `worklist ${JSON.stringify(items)}`);
  });

  await step('Gateway calls must be signed by the gateway; a repeated call is processed once', async () => {
    const share = { intent: 'PROFILE_SHARE', metaData: { hipId: 'HMS-HIP', context: 'counter-1' }, profile: { patient: { abhaNumber: abha1, abhaAddress: addr1, name: `Asha Verma ${tag}`, gender: 'F', yearOfBirth: '1990' } } };
    assert((await call('/api/v3/hip/patient/share', share, { auth: 'none' })).status === 401, 'unsigned call accepted');
    assert((await call('/api/v3/hip/patient/share', share, { auth: 'forged' })).status === 401, 'call signed with another key accepted');
    const requestId = crypto.randomUUID();
    const a = await call('/api/v3/hip/patient/share', share, { requestId });
    const b = await call('/api/v3/hip/patient/share', share, { requestId });
    assert(a.status === 202 && b.status === 202, `share ${a.status}/${b.status}`);
    const shares = await sql('SELECT * FROM hms_abdm_profile_shares WHERE request_id = $1', [requestId]);
    assert(shares.length === 1, `${shares.length} shares for one request`);
    const ack = await receivedOn('/patient-share/v3/on-share', (r) => r.body?.response?.requestId === requestId);
    assert(ack && ack.body.acknowledgement.profile.tokenNumber === String(shares[0].token_number), 'no on-share acknowledgement with the token');
    const link = await api('POST', `/abdm/shares/${shares[0].id}/link`, { token: desk, body: { patientId: P.id } });
    assert(link.status === 200 && link.data.data.status === 'Linked', `link share ${link.status} ${JSON.stringify(link.data)}`);
  });

  await step('M2: a finished visit is linked to the ABHA with a link token, one care context per call', async () => {
    [enc1] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status, chief_complaint, encounter_date) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Finalized', 'Synthetic cough', now() - interval '2 days') RETURNING id", [P.id, doc.id]);
    await sql("INSERT INTO hms_diagnoses (id, encounter_id, icd10_code, icd10_description, status) VALUES (nextval('hms_diagnoses_seq'), $1, 'R05', 'Cough', 'Provisional')", [enc1.id]);
    const r = await api('POST', `/abdm/patients/${P.id}/care-contexts/link`, { token: desk, body: { encounterIds: [enc1.id] } });
    assert(r.status === 202, `link ${r.status} ${JSON.stringify(r.data)}`);
    const gen = await receivedOn('/v3/token/generate-token', (x) => x.body?.abhaNumber === abha1);
    assert(gen, 'no link token request reached the gateway');
    await call('/api/v3/hip/token/on-generate-token', { linkToken: `LT-${tag}`, abhaAddress: addr1, response: { requestId: gen.headers['request-id'] } });
    const linkCall = await receivedOn('/hip/v3/link/carecontext', (x) => x.headers['x-link-token'] === `LT-${tag}`);
    assert(linkCall && linkCall.body.patient[0].careContexts.length === 1, 'care context not sent with the link token');
    await call('/api/v3/link/on_carecontext', { abhaAddress: addr1, status: 'Successfully Linked', response: { requestId: linkCall.headers['request-id'] } });
    cc1 = await until(async () => (await sql("SELECT * FROM hms_abdm_care_contexts WHERE encounter_id = $1 AND link_status = 'Linked'", [enc1.id]))[0]);
    assert(cc1 && cc1.linked_via === 'hip', 'care context not linked');
  });

  await step('M2: discovery finds only the chart holding the ABHA; the patient links a visit with the hospital OTP', async () => {
    [enc2] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status, chief_complaint, encounter_date) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Finalized', 'Synthetic follow-up', now() - interval '1 day') RETURNING id", [P.id, doc.id]);
    const tx = crypto.randomUUID();
    const d = await call('/api/v3/hip/patient/care-context/discover', { transactionId: tx, patient: { id: addr1, verifiedIdentifiers: [{ type: 'ABHA_NUMBER', value: abha1 }], name: `Asha Verma ${tag}`, gender: 'F', yearOfBirth: 1990 } });
    assert(d.status === 202 && d.data.patient[0].careContexts.some((c) => c.referenceNumber === `OPD-${enc2.id}`), `discover ${JSON.stringify(d.data)}`);
    const nameOnly = await call('/api/v3/hip/patient/care-context/discover', { transactionId: crypto.randomUUID(), patient: { id: 'someone@sbx', verifiedIdentifiers: [{ type: 'ABHA_NUMBER', value: digits(14) }], name: `Asha Verma ${tag}`, gender: 'F', yearOfBirth: 1990 } });
    assert(nameOnly.data.error, 'a patient was found by name');
    const init = await call('/api/v3/hip/link/care-context/init', { transactionId: tx, abhaAddress: addr1, patient: [{ referenceNumber: P.uhid, careContexts: [{ referenceNumber: `OPD-${enc2.id}` }] }] });
    assert(init.status === 202, `init ${init.status}`);
    const onInit = await receivedOn('/link/care-context/on-init', (x) => x.body?.transactionId === tx);
    const ref = onInit.body.link.referenceNumber;
    const [sms] = await sql("SELECT payload FROM hms_interface_messages WHERE system = 'sms' AND patient_id = $1 ORDER BY created_at DESC LIMIT 1", [P.id]);
    assert(sms && !JSON.stringify(sms.payload).match(/\b\d{6}\b/), 'the OTP is readable in the message log');
    const otp = decrypt(sms.payload.text_enc).match(/\b(\d{6})\b/)[1];
    await call('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber: ref, token: otp === '000000' ? '111111' : '000000' } });
    assert((await sql("SELECT link_status FROM hms_abdm_care_contexts WHERE encounter_id = $1", [enc2.id]))[0].link_status !== 'Linked', 'a wrong OTP linked the visit');
    await call('/api/v3/hip/link/care-context/confirm', { confirmation: { linkRefNumber: ref, token: otp } });
    const [cc2] = await sql("SELECT * FROM hms_abdm_care_contexts WHERE encounter_id = $1", [enc2.id]);
    assert(cc2.link_status === 'Linked' && cc2.linked_via === 'patient', `patient link ${JSON.stringify(cc2)}`);
  });

  await step('M2: records leave only under a valid consent, encrypted, for the consented visits and dates; each document is recorded', async () => {
    const consentId = `C-${tag}`;
    const detail = (id, ccs) => ({ consentId: id, createdAt: new Date().toISOString(), purpose: { code: 'CAREMGT', text: 'Care management' }, patient: { id: addr1 }, hip: { id: 'HMS-HIP' }, hiu: { id: 'OTHER-HIU' },
      careContexts: ccs.map((ref) => ({ patientReference: P.uhid, careContextReference: ref })), hiTypes: ['OPConsultation'],
      // Records from the last 30 days up to the end of today.
      permission: { accessMode: 'VIEW', dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date(Date.now() + 3600e3).toISOString() }, dataEraseAt: new Date(Date.now() + 864e5).toISOString(), frequency: { unit: 'HOUR', value: 1, repeats: 0 } } });
    await call('/api/v3/consent/request/hip/notify', { notification: { status: 'GRANTED', consentId, consentDetail: detail(consentId, [`OPD-${enc1.id}`]), signature: 'sig' } });
    consentHip = await until(async () => (await sql("SELECT * FROM hms_abdm_consents WHERE role = 'HIP' AND consent_id = $1", [consentId]))[0]);
    assert(consentHip && consentHip.patient_id === P.id, 'consent not stored');
    const km = AC.keyMaterial();
    const tx = crypto.randomUUID();
    await call('/api/v3/hip/health-information/request', { transactionId: tx, hiRequest: { consent: { id: consentId }, dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() }, dataPushUrl: `${MOCK}/_mock/datapush/${tx}`, keyMaterial: km.material } });
    const push = await until(async () => (await mock('/_mock/datapushes')).find((p) => p.name === tx));
    assert(push, 'records were not pushed');
    assert(push.body.entries.length === 1 && push.body.entries[0].careContextReference === `OPD-${enc1.id}`, `only the consented visit should be sent: ${JSON.stringify(push.body.entries.map((e) => e.careContextReference))}`);
    const doc1 = JSON.parse(AC.decryptFrom(km.privateKeyPem, km.material.nonce, push.body.keyMaterial, push.body.entries[0].content, 0));
    assert(doc1.type === 'document' && doc1.entry[0].resource.resourceType === 'Composition' && doc1.entry.some((e) => e.resource.resourceType === 'Patient' && e.resource.id === String(P.id)), 'not a document bundle for the patient');
    const recorded = await sql("SELECT d.* FROM hms_abdm_hi_documents d JOIN hms_abdm_hi_transfers t ON t.id = d.transfer_id WHERE t.transaction_id = $1", [tx]);
    assert(recorded.length === 1 && recorded[0].sha256 === push.body.entries[0].checksum, 'sent document not recorded');
    const outside = crypto.randomUUID();
    await call('/api/v3/hip/health-information/request', { transactionId: outside, hiRequest: { consent: { id: consentId }, dateRange: { from: new Date(Date.now() - 400 * 864e5).toISOString(), to: new Date().toISOString() }, dataPushUrl: `${MOCK}/_mock/datapush/${outside}`, keyMaterial: km.material } });
    const [refused] = await until(async () => sql("SELECT * FROM hms_abdm_hi_transfers WHERE transaction_id = $1", [outside]).then((r) => r.length && r));
    assert(refused.status === 'Refused', `dates outside the consent: ${refused.status}`);
  });

  await step('M2: after revocation nothing more leaves, including a push already waiting to be delivered', async () => {
    const km = AC.keyMaterial();
    await mock('/_mock/fail', { prefix: '/_mock/datapush/', count: 1, status: 503 });
    const tx = crypto.randomUUID();
    await call('/api/v3/hip/health-information/request', { transactionId: tx, hiRequest: { consent: { id: consentHip.consent_id }, dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() }, dataPushUrl: `${MOCK}/_mock/datapush/${tx}`, keyMaterial: km.material } });
    await until(async () => (await sql("SELECT attempts FROM hms_interface_messages WHERE system = 'abdm-datapush' AND endpoint LIKE $1 AND attempts >= 1", [`%${tx}`]))[0]);
    const revokedAt = new Date();
    await call('/api/v3/consent/request/hip/notify', { notification: { status: 'REVOKED', consentId: consentHip.consent_id } });
    const [msg] = await until(async () => sql("SELECT * FROM hms_interface_messages WHERE system = 'abdm-datapush' AND endpoint LIKE $1 AND status = 'Failed'", [`%${tx}`]).then((r) => r.length && r), 40000);
    assert(msg && /consent/.test(msg.last_error), `a waiting push was not stopped: ${JSON.stringify(msg)}`);
    const attempts = (await mock('/_mock/datapushes')).filter((p) => p.name === tx);
    assert(!attempts.some((p) => p.accepted), 'records were delivered');
    assert(!attempts.some((p) => new Date(p.at) > revokedAt), 'a delivery was attempted after revocation');
    const after = crypto.randomUUID();
    await call('/api/v3/hip/health-information/request', { transactionId: after, hiRequest: { consent: { id: consentHip.consent_id }, dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() }, dataPushUrl: `${MOCK}/_mock/datapush/${after}`, keyMaterial: km.material } });
    const [t2] = await until(async () => sql('SELECT * FROM hms_abdm_hi_transfers WHERE transaction_id = $1', [after]).then((r) => r.length && r));
    assert(t2.status === 'Refused' && /revoked/.test(t2.refusal), `request after revocation: ${t2.status} ${t2.refusal}`);
    assert((await sql("SELECT 1 FROM hms_worklist_items WHERE kind = 'interface.delivery_failed' AND status = 'Open' AND detail->>'message_id' = $1", [msg.id])).length === 1, 'the stopped push is not on the worklist');
  });

  await step('M3: the doctor asks for records with consent; what arrives is outside information for review, never a local order', async () => {
    assert((await api('POST', `/abdm/patients/${P.id}/consent-requests`, { token: desk, body: {} })).status === 403, 'front desk requested records');
    const r = await api('POST', `/abdm/patients/${P.id}/consent-requests`, { token: doctor, body: { purpose: 'CAREMGT', hiTypes: ['OPConsultation', 'Prescription'], from: new Date(Date.now() - 365 * 864e5).toISOString(), to: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() } });
    assert(r.status === 201, `consent request ${r.status} ${JSON.stringify(r.data)}`);
    const init = await receivedOn('/consent/v3/request/init', (x) => x.body?.consent?.patient?.id === addr1);
    const crId = `CR-${tag}`;
    await call('/api/v3/hiu/consent/request/on-init', { consentRequest: { id: crId }, response: { requestId: init.headers['request-id'] } });
    const artefact = `A-${tag}`;
    await call('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: crId, status: 'GRANTED', consentArtefacts: [{ id: artefact }] } });
    await receivedOn('/consent/v3/fetch', (x) => x.body?.consentId === artefact);
    await call('/api/v3/hiu/consent/on-fetch', { consent: { status: 'GRANTED', consentDetail: { consentId: artefact, consentRequestId: crId, purpose: { code: 'CAREMGT' }, patient: { id: addr1 }, hip: { id: 'OTHER-HIP' }, hiTypes: ['OPConsultation', 'Prescription'],
      careContexts: [{ patientReference: 'X1', careContextReference: 'REMOTE-CC-1' }], permission: { accessMode: 'VIEW', dateRange: { from: new Date(Date.now() - 365 * 864e5).toISOString(), to: new Date().toISOString() }, dataEraseAt: new Date(Date.now() + 7 * 864e5).toISOString() } } } });
    const hiReq = await receivedOn('/data-flow/v3/health-information/request', (x) => x.body?.hiRequest?.consent?.id === artefact);
    assert(hiReq && hiReq.body.hiRequest.keyMaterial.dhPublicKey.keyValue, 'no health information request with key material');
    const tx = `TX-${tag}`;
    await call('/api/v3/hiu/health-information/on-request', { hiRequest: { transactionId: tx, sessionStatus: 'REQUESTED' }, response: { requestId: hiReq.headers['request-id'] } });
    await until(async () => (await sql('SELECT 1 FROM hms_abdm_hiu_keys WHERE transaction_id = $1', [tx])).length);
    const remote = { resourceType: 'Bundle', type: 'document', entry: [
      { resource: { resourceType: 'Composition', id: 'c1', title: 'Prescription' } },
      { resource: { resourceType: 'MedicationRequest', id: 'm1', status: 'active', intent: 'order', medicationCodeableConcept: { text: 'Synthetic medicine 10 mg' } } },
      { resource: { resourceType: 'Condition', id: 'k1', code: { text: 'Synthetic condition' } } }] };
    const orders = async () => (await sql('SELECT count(*)::int AS n FROM hms_med_orders WHERE patient_id = $1', [P.id]))[0].n
      + (await sql('SELECT count(*)::int AS n FROM hms_med_allergies WHERE patient_id = $1', [P.id]))[0].n;
    const ordersBefore = await orders();
    const tampered = await mock('/_mock/push', { dataPushUrl: BRIDGE + '/api/v3/hiu/data/push', transactionId: tx, keyMaterial: hiReq.body.hiRequest.keyMaterial, documents: [remote], tamper: true });
    assert(tampered.status >= 400, `tampered data accepted: ${tampered.status}`);
    const pushed = await mock('/_mock/push', { dataPushUrl: BRIDGE + '/api/v3/hiu/data/push', transactionId: tx, keyMaterial: hiReq.body.hiRequest.keyMaterial, documents: [remote] });
    assert(pushed.status === 202, `push ${pushed.status} ${JSON.stringify(pushed.data)}`);
    const list = await api('GET', `/abdm/patients/${P.id}/imports`, { token: doctor });
    const imp = list.data.data.find((i) => i.consent_id === artefact);
    assert(imp && imp.status === 'Available' && imp.items.find((i) => i.resource_type === 'MedicationRequest').needs_review, `imports ${JSON.stringify(list.data)}`);
    assert(await orders() === ordersBefore, 'an imported medicine became a local order or allergy');
    const med = imp.items.find((i) => i.resource_type === 'MedicationRequest');
    assert((await api('POST', `/abdm/import-items/${med.id}/decision`, { token: doctor, body: { decision: 'Accepted' } })).status === 400, 'accepted without a note');
    const ok = await api('POST', `/abdm/import-items/${med.id}/decision`, { token: doctor, body: { decision: 'Accepted', note: 'Confirmed with the patient' } });
    assert(ok.status === 200 && ok.data.data.decision === 'Accepted', `decision ${ok.status}`);
  });

  await step('M3: when the patient revokes, the outside records are withdrawn and erased', async () => {
    await call('/api/v3/hiu/consent/request/notify', { notification: { consentRequestId: `CR-${tag}`, status: 'REVOKED', consentArtefacts: [{ id: `A-${tag}` }] } });
    const [imp] = await until(async () => sql("SELECT * FROM hms_abdm_imports WHERE consent_id = $1 AND status = 'Withdrawn'", [`A-${tag}`]).then((r) => r.length && r));
    assert(imp && imp.document.erased === true, 'records not withdrawn and erased');
    const [item] = await sql("SELECT it.id FROM hms_abdm_import_items it WHERE it.import_id = $1 AND it.decision IS NULL LIMIT 1", [imp.id]);
    const late = await api('POST', `/abdm/import-items/${item.id}/decision`, { token: doctor, body: { decision: 'Seen' } });
    assert(late.status === 409, `decision on withdrawn records: ${late.status}`);
    const list = await api('GET', `/abdm/patients/${P.id}/imports`, { token: doctor });
    assert(list.data.data.filter((i) => i.consent_id === `A-${tag}`).every((i) => i.document === null), 'withdrawn records are still shown');
  });

  done();
  process.exit();
})();
