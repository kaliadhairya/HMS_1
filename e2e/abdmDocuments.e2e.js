// Prescriptions and discharge summaries reach ABDM (completion B1), against the local mock
// gateway: a finished visit with signed coded medication orders offers its Prescription; a
// completed stay with a signed discharge document is its own care context offering the
// DischargeSummary; both are linked and, under a consent for those types, pushed as encrypted
// document bundles and recorded. A stay that is not discharged is not shared (a discharged stay
// always has its signed summary: the database requires it, A5), and a consent without the type
// sends nothing of it. Run after medication.e2e.js.
const crypto = require('crypto');
const path = require('path');
const { api, apiLogin, sql, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');
const { clinicalFixture } = require('./clinicalFixtures');

requireThrowawayDb();
const MOCK = process.env.ABDM_MOCK_URL || 'http://127.0.0.1:9320';
const BRIDGE = process.env.ABDM_BRIDGE_PUBLIC_URL;
assert(BRIDGE && process.env.ABDM_GATEWAY_URL, 'ABDM_* settings are required (see the Phase 6 harness)');
const AC = require(path.join(__dirname, '../backend/services/abdmCrypto'));
const tag = crypto.randomUUID().slice(0, 6);
const digits = (n) => Array.from(crypto.randomBytes(n), (b) => b % 10).join('');
const mock = async (p, body) => { const r = await fetch(MOCK + p, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return r.json().catch(() => null); };
const call = (cb, body) => mock('/_mock/call', { url: BRIDGE + cb, body });
const until = async (fn, ms = 20000) => { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(300); } return v; };
const receivedOn = (p, pred = () => true) => until(async () => (await mock(`/_mock/received?path=${encodeURIComponent(p)}`)).find(pred));

(async () => {
  const { step, done } = runner('ABDM prescriptions and discharge summaries');
  const desk = await apiLogin('receptionist');
  const doctor = await apiLogin('doctor');
  await clinicalFixture('doctor', ['CHART_READ', 'CLINICAL_SIGN']);
  const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const abha = digits(14), addr = `rx${tag}@sbx`;
  let P, enc, stay, active, km;

  await step('Set up: a finished visit with signed medication orders and a completed stay with a signed discharge summary', async () => {
    const [rx] = await sql(`SELECT o.patient_id, o.encounter_id FROM hms_med_order_versions v JOIN hms_med_orders o ON o.id = v.order_id
      WHERE v.signed_at IS NOT NULL AND o.encounter_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM hms_abdm_care_contexts c WHERE c.encounter_id = o.encounter_id)
        AND NOT EXISTS (SELECT 1 FROM hms_patient_identifiers i WHERE i.patient_id = o.patient_id AND i.issuer = 'ABDM')
      ORDER BY v.signed_at DESC LIMIT 1`);
    assert(rx, 'needs a signed medication order (run after medication.e2e.js)');
    [P] = await sql('SELECT * FROM hms_patients WHERE id = $1', [rx.patient_id]);
    enc = rx.encounter_id;
    await inCare(P.id);
    await sql("UPDATE hms_encounters SET status = 'Finalized', encounter_date = coalesce(encounter_date, now() - interval '3 days') WHERE id = $1", [enc]);
    await sql(`INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_via, verified_by, verified_at, created_by)
      VALUES ($1, 'ABHA_NUMBER', $2, 'ABDM', 'verified', 'abdm', $3, now(), $3), ($1, 'ABHA_ADDRESS', $4, 'ABDM', 'verified', 'abdm', $3, now(), $3)`, [P.id, abha, doc.id, addr]);
    const admit = async (status) => (await sql(`INSERT INTO hms_admissions (patient_id, admitting_doctor_id, admission_type, admission_date, status, created_by)
      VALUES ($1, $2, 'Planned', (now() - interval '2 days')::timestamp, 'Active', $2) RETURNING id`, [P.id, doc.id]))[0].id;
    stay = await admit();
    const content = { diagnosis: 'Synthetic pneumonia', condition: 'Stable', instructions: 'Synthetic instructions', warningSigns: 'Synthetic warning signs', followUp: 'Synthetic follow-up', course: 'Synthetic course' };
    const made = await api('POST', '/clinical-documents', { token: doctor, body: { patientId: P.id, admissionId: stay, docType: 'discharge_summary', content }, headers: { 'idempotency-key': crypto.randomUUID() } });
    assert(made.status === 201, `discharge document ${made.status} ${JSON.stringify(made.data).slice(0, 160)}`);
    const signed = await api('POST', `/clinical-documents/${made.data.data.id}/sign`, { token: doctor, headers: { 'if-match': String(made.data.data.version), 'idempotency-key': crypto.randomUUID() } });
    assert(signed.status === 200, `sign ${signed.status} ${JSON.stringify(signed.data).slice(0, 160)}`);
    await sql(`INSERT INTO hms_discharge_summaries (id, admission_id, final_diagnosis, created_by, created_at, clinical_document_id, facility_id)
      SELECT nextval('hms_discharge_seq'), a.id, 'Synthetic pneumonia', $2, now(), $3, a.facility_id FROM hms_admissions a WHERE a.id = $1`, [stay, doc.id, made.data.data.id]);
    await sql("UPDATE hms_admissions SET status = 'Discharged', discharge_date = (now() - interval '1 day')::timestamp WHERE id = $1", [stay]);
    active = await admit();
  });

  await step('Only a completed stay with a signed summary can be shared; the visit offers its Prescription', async () => {
    const r = await api('POST', `/abdm/patients/${P.id}/care-contexts/link`, { token: desk, body: { admissionIds: [active] } });
    assert(r.status === 409 && /not discharged/.test(r.data.message), `an active stay was shared: ${r.status} ${JSON.stringify(r.data)}`);
    const ok = await api('POST', `/abdm/patients/${P.id}/care-contexts/link`, { token: desk, body: { encounterIds: [enc], admissionIds: [stay] } });
    assert(ok.status === 202, `link ${ok.status} ${JSON.stringify(ok.data)}`);
    const contexts = await sql('SELECT reference, hi_types, admission_id, encounter_id FROM hms_abdm_care_contexts WHERE patient_id = $1', [P.id]);
    const visit = contexts.find((c) => c.encounter_id === enc), ipd = contexts.find((c) => c.admission_id === stay);
    assert(visit && visit.hi_types.includes('Prescription') && visit.hi_types.includes('OPConsultation'), `visit types ${JSON.stringify(visit)}`);
    assert(ipd && ipd.reference === `IPD-${stay}` && JSON.stringify(ipd.hi_types) === JSON.stringify(['DischargeSummary']), `stay context ${JSON.stringify(ipd)}`);
    const gen = await receivedOn('/v3/token/generate-token', (x) => x.body?.abhaNumber === abha);
    assert(gen, 'no link token request reached the gateway');
    await call('/api/v3/hip/token/on-generate-token', { linkToken: `LT-${tag}`, abhaAddress: addr, response: { requestId: gen.headers['request-id'] } });
    for (const ref of [`OPD-${enc}`, `IPD-${stay}`]) {
      const linkCall = await receivedOn('/hip/v3/link/carecontext', (x) => x.headers['x-link-token'] === `LT-${tag}` && x.body.patient[0].careContexts[0].referenceNumber === ref);
      assert(linkCall, `${ref} was not sent for linking`);
      await call('/api/v3/link/on_carecontext', { abhaAddress: addr, status: 'Successfully Linked', response: { requestId: linkCall.headers['request-id'] } });
    }
    const linked = await until(async () => { const r2 = await sql("SELECT reference FROM hms_abdm_care_contexts WHERE patient_id = $1 AND link_status = 'Linked'", [P.id]); return r2.length === 2 && r2; });
    assert(linked, 'the visit and the stay were not both linked');
  });

  const consent = async (id, refs, hiTypes) => {
    const detail = { consentId: id, createdAt: new Date().toISOString(), purpose: { code: 'CAREMGT', text: 'Care management' }, patient: { id: addr }, hip: { id: 'HMS-HIP' }, hiu: { id: 'OTHER-HIU' },
      careContexts: refs.map((ref) => ({ patientReference: P.uhid, careContextReference: ref })), hiTypes,
      permission: { accessMode: 'VIEW', dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date(Date.now() + 3600e3).toISOString() }, dataEraseAt: new Date(Date.now() + 864e5).toISOString(), frequency: { unit: 'HOUR', value: 1, repeats: 0 } } };
    await call('/api/v3/consent/request/hip/notify', { notification: { status: 'GRANTED', consentId: id, consentDetail: detail, signature: 'sig' } });
    assert(await until(async () => (await sql("SELECT 1 FROM hms_abdm_consents WHERE role = 'HIP' AND consent_id = $1", [id]))[0]), 'consent not stored');
    km = AC.keyMaterial();
    const tx = crypto.randomUUID();
    await call('/api/v3/hip/health-information/request', { transactionId: tx, hiRequest: { consent: { id }, dateRange: { from: new Date(Date.now() - 30 * 864e5).toISOString(), to: new Date().toISOString() }, dataPushUrl: `${MOCK}/_mock/datapush/${tx}`, keyMaterial: km.material } });
    const push = await until(async () => (await mock('/_mock/datapushes')).find((p) => p.name === tx));
    assert(push, 'records were not pushed');
    return { tx, push, docs: push.body.entries.map((e, i) => ({ ref: e.careContextReference, bundle: JSON.parse(AC.decryptFrom(km.privateKeyPem, km.material.nonce, push.body.keyMaterial, e.content, i)) })) };
  };

  await step('Under a consent for prescriptions and discharge summaries, both are pushed as document bundles and recorded', async () => {
    const { tx, docs } = await consent(`CRX-${tag}`, [`OPD-${enc}`, `IPD-${stay}`], ['Prescription', 'DischargeSummary']);
    const kinds = docs.map((d) => `${d.ref}:${d.bundle.entry[0].resource.type.coding[0].code}`).sort();
    assert(JSON.stringify(kinds) === JSON.stringify([`IPD-${stay}:373942005`, `OPD-${enc}:440545006`].sort()), `pushed ${JSON.stringify(kinds)}`);
    assert(docs.every((d) => d.bundle.type === 'document' && d.bundle.entry.some((e) => e.resource.resourceType === 'Patient' && e.resource.id === String(P.id))), 'a bundle is not a document for the patient');
    const recorded = await sql("SELECT d.hi_type FROM hms_abdm_hi_documents d JOIN hms_abdm_hi_transfers t ON t.id = d.transfer_id WHERE t.transaction_id = $1 ORDER BY 1", [tx]);
    assert(JSON.stringify(recorded.map((r) => r.hi_type)) === JSON.stringify(['DischargeSummary', 'Prescription']), `recorded ${JSON.stringify(recorded)}`);
  });

  await step('A consent without those types sends only what it names', async () => {
    const { docs } = await consent(`COP-${tag}`, [`OPD-${enc}`, `IPD-${stay}`], ['OPConsultation']);
    const kinds = docs.map((d) => `${d.ref}:${d.bundle.entry[0].resource.title}`);
    assert(docs.length === 1 && docs[0].ref === `OPD-${enc}` && !/Prescription|Discharge/i.test(docs[0].bundle.entry[0].resource.title), `pushed ${JSON.stringify(kinds)}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
