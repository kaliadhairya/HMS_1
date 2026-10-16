// ABDM and terminology (completion B2): incoming callbacks are checked
// against their contract; outside records are usable only while their
// consent is valid at the moment of use; imported items are set beside the
// chart and an accepted outside allergy can join the allergy record; the
// readiness report says what is configured, which environment, and whether
// any terminology content is synthetic. Uses the local mock gateway.
const crypto = require('crypto');
const { chromium, BASE, api, apiLogin, sql, browserAs, runner, assert, sleep, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const MOCK = process.env.ABDM_MOCK_URL || 'http://127.0.0.1:9320';
const BRIDGE = process.env.ABDM_BRIDGE_PUBLIC_URL;
assert(BRIDGE && process.env.ABDM_GATEWAY_URL, 'ABDM_* settings are required (see the Phase 6 harness)');
const tag = crypto.randomUUID().slice(0, 8);
const mock = async (p, body) => { const r = await fetch(MOCK + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return r.json(); };
const call = (cb, body, opts = {}) => mock('/_mock/call', { url: BRIDGE + cb, body, ...opts });

async function fixture(patientId, { eraseInSeconds = 86400 } = {}) {
  const consentId = `B2-${tag}-${crypto.randomUUID().slice(0, 6)}`;
  await sql(`INSERT INTO hms_abdm_consents (role, consent_id, patient_id, abha_address, purpose, hi_types, date_from, date_to, data_erase_at, status, artefact)
    VALUES ('HIU', $1, $2, $3, 'CAREMGT', '{AllergyIntolerance,Condition}', now() - interval '1 year', now(), now() + make_interval(secs => $4), 'GRANTED', $5)`,
  [consentId, patientId, `b2${tag}@sbx`, eraseInSeconds, JSON.stringify({ hip: { id: 'OTHER-HOSPITAL' } })]);
  const doc = { resourceType: 'Bundle', id: consentId };
  const [imp] = await sql(`INSERT INTO hms_abdm_imports (consent_id, transaction_id, patient_id, source_hip, care_context_ref, document, sha256)
    VALUES ($1, $2, $3, 'OTHER-HOSPITAL', 'VISIT-1', $4, $5) RETURNING id`, [consentId, `TX-${consentId}`, patientId, JSON.stringify(doc), crypto.createHash('sha256').update(consentId).digest('hex')]);
  const items = {};
  for (const [type, summary] of [['AllergyIntolerance', `AllergyIntolerance: Sulfa-${tag}`], ['AllergyIntolerance', 'AllergyIntolerance: Paracetamol'], ['Condition', 'Condition: Type 2 diabetes mellitus']]) {
    const [it] = await sql('INSERT INTO hms_abdm_import_items (import_id, resource_type, resource_id, summary, needs_review) VALUES ($1, $2, $3, $4, $5) RETURNING id', [imp.id, type, crypto.randomUUID(), summary, type === 'AllergyIntolerance']);
    items[summary] = it.id;
  }
  return { consentId, importId: imp.id, items };
}

(async () => {
  const { step, done } = runner('ABDM use and readiness');
  const doctor = await apiLogin('doctor');
  const admin = await apiLogin('admin');
  const [patient] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 50, 'Male', 'OPD', CURRENT_DATE) RETURNING id", [`Outside records ${tag}`, `B2-${tag}`]);
  await inCare(patient.id);
  await sql("INSERT INTO hms_allergies (id, patient_id, allergen, severity) VALUES (nextval('hms_allergy_seq'), $1, 'Paracetamol', 'Mild')", [patient.id]);
  let f;

  await step('An incomplete gateway callback is refused with ABDM\'s error code and recorded as refused', async () => {
    const r = await call('/api/v3/hip/health-information/request', { transactionId: `TX-${tag}`, hiRequest: { consent: { id: 'x' } } });
    assert(r.status === 400 && r.data.error.code === 'ABDM-1000' && /missing: .*dateRange/.test(r.data.error.message), `incomplete hi-request ${r.status} ${JSON.stringify(r.data)}`);
    const push = await call('/api/v3/hiu/data/push', { transactionId: `TX-${tag}` }, { auth: 'none' });
    assert(push.status === 400 && /entries/.test(push.data.error.message), `incomplete data push ${push.status} ${JSON.stringify(push.data)}`);
    const refused = await sql("SELECT status FROM hms_interface_messages WHERE message_type = 'hi-request:refused' AND external_id LIKE $1", [`${r.requestId}:refused:%`]);
    assert(refused.length === 1 && refused[0].status === 'Rejected', `refusal record ${JSON.stringify(refused)}`);
  });

  await step('Outside records are set beside the chart: what is already recorded and what is new', async () => {
    f = await fixture(patient.id);
    const r = await api('GET', `/abdm/patients/${patient.id}/imports`, { token: doctor });
    assert(r.status === 200, `imports ${r.status}`);
    const items = r.data.data.find((i) => i.consent_id === f.consentId).items;
    const by = Object.fromEntries(items.map((i) => [i.summary, i.chart]));
    assert(by[`AllergyIntolerance: Sulfa-${tag}`] === 'Not in chart' && by['AllergyIntolerance: Paracetamol'] === 'Already in chart' && by['Condition: Type 2 diabetes mellitus'] === 'Not in chart', `chart ${JSON.stringify(by)}`);
    const [audit] = await sql("SELECT 1 FROM hms_audit_logs WHERE module = 'abdm_import' AND record_id = $1", [patient.id]);
    assert(audit, 'viewing outside records was not audited');
  });

  await step('An accepted outside allergy joins the allergy record as unconfirmed, with its source; other items cannot be added', async () => {
    const bad = await api('POST', `/abdm/import-items/${f.items['Condition: Type 2 diabetes mellitus']}/decision`, { token: doctor, body: { decision: 'Accepted', note: 'Relevant history', addToChart: true } });
    assert(bad.status === 400 && bad.data.code === 'NOT_ADDABLE', `condition added ${bad.status}`);
    const ok = await api('POST', `/abdm/import-items/${f.items[`AllergyIntolerance: Sulfa-${tag}`]}/decision`, { token: doctor, body: { decision: 'Accepted', note: 'Patient confirms a rash', addToChart: true, reaction: 'Rash' } });
    assert(ok.status === 200 && /Added to the allergy record/.test(ok.data.data.decision_note), `accept ${ok.status} ${JSON.stringify(ok.data)}`);
    const [a] = await sql("SELECT clinical_text, reaction, verification_status FROM hms_med_allergies WHERE patient_id = $1 AND clinical_text LIKE $2", [patient.id, `Sulfa-${tag}%`]);
    assert(a && a.verification_status === 'UNCONFIRMED' && a.reaction === 'Rash' && /OTHER-HOSPITAL via ABDM/.test(a.clinical_text), `allergy ${JSON.stringify(a)}`);
    const again = await api('GET', `/abdm/patients/${patient.id}/imports`, { token: doctor });
    const it = again.data.data.find((i) => i.consent_id === f.consentId).items.find((i) => i.summary === `AllergyIntolerance: Sulfa-${tag}`);
    assert(it.chart === 'Already in chart', `after adding ${it.chart}`);
  });

  await step('Consent is checked at use: a revocation the hospital did not hear about, or an expiry a moment ago, hides the records at once', async () => {
    await sql("UPDATE hms_abdm_consents SET status = 'REVOKED' WHERE role = 'HIU' AND consent_id = $1", [f.consentId]);
    const dec = await api('POST', `/abdm/import-items/${f.items['AllergyIntolerance: Paracetamol']}/decision`, { token: doctor, body: { decision: 'Seen' } });
    assert(dec.status === 409, `decided under a revoked consent ${dec.status}`);
    const r = await api('GET', `/abdm/patients/${patient.id}/imports`, { token: doctor });
    const imp = r.data.data.find((i) => i.consent_id === f.consentId);
    assert(imp.status === 'Withdrawn' && imp.document === null, `revoked records still shown ${imp.status}`);
    const [erased] = await sql('SELECT document FROM hms_abdm_imports WHERE id = $1', [f.importId]);
    assert(erased.document.erased === true, 'the document was not erased');
    const g = await fixture(patient.id, { eraseInSeconds: 2 });
    await sleep(3000); // the expiry worker runs every minute; use must not wait for it
    const r2 = await api('GET', `/abdm/patients/${patient.id}/imports`, { token: doctor });
    assert(r2.data.data.find((i) => i.consent_id === g.consentId).status === 'Withdrawn', 'expired records still shown');
  });

  await step('The readiness report names the ABDM environment and synthetic terminology, and returns no secrets', async () => {
    assert((await api('GET', '/integrations/readiness', { token: doctor })).status === 403, 'a doctor read the readiness report');
    const r = await api('GET', '/integrations/readiness', { token: admin });
    assert(r.status === 200, `readiness ${r.status}`);
    const checks = r.data.data.checks;
    const env = checks.find((c) => c.area === 'ABDM' && c.item === 'Environment');
    assert(env && env.status === 'warning' && /mock gateway/.test(env.detail), `environment ${JSON.stringify(env)}`);
    const text = JSON.stringify(r.data);
    assert(!text.includes(process.env.ABDM_CLIENT_SECRET), 'the client secret was returned');
    const icd = checks.find((c) => c.area === 'Terminology' && c.item === 'ICD10');
    assert(icd, 'no ICD-10 check');
    const [active] = await sql("SELECT r.source FROM hms_term_releases r JOIN hms_term_systems s ON s.id = r.system_id WHERE s.code = 'ICD10' AND r.status = 'Active'");
    if (active && /synthetic/i.test(active.source)) assert(icd.status === 'warning' && /synthetic/.test(icd.detail), `synthetic edition not flagged ${JSON.stringify(icd)}`);
    else if (!active) assert(/No ICD-10 edition/.test(icd.detail), `missing edition not flagged ${JSON.stringify(icd)}`);
  });

  await step('On screen: the doctor sees outside records beside the chart; the administrator sees readiness', async () => {
    const browser = await chromium.launch();
    try {
      const h = await fixture(patient.id);
      const doc = await browserAs(browser, 'doctor');
      await doc.page.goto(`${BASE}/abdm/outside-records`, { waitUntil: 'networkidle' });
      await doc.page.getByPlaceholder('Name, UHID or phone').fill(`B2-${tag}`);
      await doc.page.getByRole('button', { name: new RegExp(`Outside records ${tag}`) }).first().click();
      const row = doc.page.locator('tr', { hasText: 'Condition: Type 2 diabetes mellitus' }).first();
      await row.getByText("Not in this hospital's chart").waitFor();
      void h;
      const adm = await browserAs(browser, 'admin');
      await adm.page.goto(`${BASE}/abdm`, { waitUntil: 'networkidle' });
      await adm.page.getByRole('region', { name: 'Connection readiness' }).getByText('A local mock gateway', { exact: false }).waitFor();
      assert(!doc.errors.length && !adm.errors.length, `page errors ${[...doc.errors, ...adm.errors].join('; ')}`);
    } finally { await browser.close(); }
  });

  done();
  process.exit();
})();
