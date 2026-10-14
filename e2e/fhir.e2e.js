// FHIR R4 read boundary (Phase 6B): access rules, audit with purpose, what
// is and is not sent, and validation of the output with the official HL7
// validator against the ABDM guide ndhm.in 6.5.0. Run after phase45 (needs a
// released laboratory report). Validator: HMS_FHIR_VALIDATOR_DIR (default
// ~/hms-tools/fhir/validator-6.10.4, see its README).
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { API, apiLogin, sql, runner, assert, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 8);
async function fhir(p, token, { method = 'GET', headers = {} } = {}) {
  const res = await fetch(`${API}/fhir/${p}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers } });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, type: res.headers.get('content-type') || '', data };
}

(async () => {
  const { step, done } = runner('FHIR');
  const admin = await apiLogin('admin');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const desk = await apiLogin('receptionist');
  const pharm = await apiLogin('pharmacist');
  let pid, stranger, enc, dx, labPatient, merged;

  await step('Set up a synthetic patient with identifiers, a visit, a diagnosis and vitals', async () => {
    const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [p] = await sql(`INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, dob, birth_date_estimated, phonenumber)
      VALUES ($1, $2, 'other', 34, 'Female', 'OPD', CURRENT_DATE, '1992-03-04', true, '9000000000') RETURNING id`, [`Synthetic FHIR ${tag}`, `FHIR-${tag}`]);
    pid = p.id;
    await inCare(pid);
    const abha = () => String(Math.floor(1e13 + Math.random() * 9e13));
    await sql(`INSERT INTO hms_patient_identifiers (patient_id, system, value, issuer, verification_status, verified_by, verified_at, created_by)
      VALUES ($1, 'ABHA_NUMBER', $2, 'ABDM', 'verified', $3, now(), $3), ($1, 'ABHA_ADDRESS', $4, 'ABDM', 'unverified', NULL, NULL, $3)`, [pid, abha(), doc.id, `fhir${tag}@sbx`]);
    [enc] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status, chief_complaint) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Draft', 'Synthetic complaint') RETURNING id", [pid, doc.id]);
    [dx] = await sql("INSERT INTO hms_diagnoses (id, encounter_id, icd10_code, icd10_description, status) VALUES (nextval('hms_diagnoses_seq'), $1, 'R50.9', 'Fever, unspecified', 'Provisional') RETURNING id", [enc.id]);
    await sql("INSERT INTO hms_vitals (patient_id, encounter_type, reference_id, bp_systolic, bp_diastolic, pulse, temperature, temp_unit, spo2, weight_kg, recorded_by, recorded_at) VALUES ($1, 'OPD', $2, 120, 80, 72, 37.0, 'C', 98, 61.5, $3, now())", [pid, enc.id, doc.id]);
    const [s] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 50, 'Male', 'OPD', CURRENT_DATE) RETURNING id", [`Synthetic stranger ${tag}`, `FHIRX-${tag}`]);
    stranger = s.id;
    const [m] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate, merged_into_patient_id, identity_status) VALUES ($1, $2, 'other', 50, 'Male', 'OPD', CURRENT_DATE, $3, 'merged') RETURNING id", [`Synthetic merged ${tag}`, `FHIRM-${tag}`, pid]).catch(() => [null]);
    merged = m?.id;
    const [lab] = await sql(`SELECT o.patient_id FROM hms_lab_report_versions v JOIN hms_lab_reports r ON r.id = v.report_id
      JOIN hms_investigation_orders o ON o.id = r.order_id ORDER BY v.released_at DESC LIMIT 1`);
    assert(lab, 'needs a released laboratory report (run after phase45)');
    labPatient = lab.patient_id;
  });

  await step('The capability statement is public and lists only reads', async () => {
    const r = await fhir('metadata');
    assert(r.status === 200 && r.type.startsWith('application/fhir+json') && r.data.fhirVersion === '4.0.1', `metadata ${r.status} ${r.type}`);
    const interactions = r.data.rest[0].resource.flatMap((x) => x.interaction.map((i) => i.code));
    assert(interactions.every((c) => ['read', 'search-type'].includes(c)), `interactions ${interactions}`);
    assert(r.data.implementationGuide[0].endsWith('ndhm.in|6.5.0'), 'implementation guide not declared');
  });

  await step('Sign-in, role and care-team rules apply; refusals are FHIR OperationOutcomes', async () => {
    assert((await fhir(`Patient/${pid}`)).status === 401, 'read without sign-in');
    for (const token of [desk, pharm]) {
      const r = await fhir(`Patient/${pid}`, token);
      assert(r.status === 403, `role without clinical access read the patient: ${r.status}`);
    }
    const out = await fhir(`Patient/${stranger}`, doctor);
    assert(out.status === 403 && out.data.resourceType === 'OperationOutcome', `doctor read a patient outside their care: ${out.status}`);
    const ok = await fhir(`Patient/${pid}`, doctor);
    assert(ok.status === 200 && ok.data.resourceType === 'Patient', `doctor in care: ${ok.status}`);
    assert((await fhir(`Condition?patient=${pid}`, nurse)).status === 200, 'nurse search');
    const write = await fhir('Patient', admin, { method: 'POST', headers: { 'content-type': 'application/fhir+json' } });
    assert(write.status === 405 && write.data.resourceType === 'OperationOutcome', `write accepted: ${write.status}`);
    const bad = await fhir(`Patient/${pid}`, admin, { headers: { 'x-purpose-of-use': 'MARKETING' } });
    assert(bad.status === 400, `unknown purpose accepted: ${bad.status}`);
    if (merged) assert((await fhir(`Patient/${merged}`, admin)).status === 410, 'a merged chart was served');
  });

  await step('Every read is audited with the patient and its purpose', async () => {
    const r = await fhir(`Encounter?patient=${pid}`, admin, { headers: { 'x-purpose-of-use': 'PATRQT' } });
    assert(r.status === 200, `search ${r.status}`);
    const [ev] = await sql(`SELECT patient_id, detail, outcome FROM audit.access_events WHERE path = '/api/fhir/Encounter' AND patient_id = $1 ORDER BY id DESC LIMIT 1`, [pid]);
    assert(ev && ev.outcome === 'read' && ev.detail === 'fhir purpose=PATRQT', `audit ${JSON.stringify(ev)}`);
    const [denied] = await sql(`SELECT outcome FROM audit.access_events WHERE path = $1 ORDER BY id DESC LIMIT 1`, [`/api/fhir/Patient/${stranger}`]);
    assert(denied && denied.outcome === 'denied', 'the refused read was not audited');
  });

  await step('Only verified ABHA numbers leave; an estimated birth date is sent as its year', async () => {
    const p = (await fhir(`Patient/${pid}`, admin)).data;
    const systems = p.identifier.map((i) => i.system);
    assert(systems.includes('https://healthid.ndhm.gov.in') && p.identifier.length === 2, `identifiers ${JSON.stringify(p.identifier)}`);
    assert(!JSON.stringify(p).includes(`fhir${tag}@sbx`), 'an unverified ABHA address was sent');
    assert(p.birthDate === '1992' && p.gender === 'female', `birthDate ${p.birthDate}`);
    const found = await fhir(`Patient?identifier=${encodeURIComponent(p.identifier.find((i) => i.system.includes('healthid')).system + '|' + p.identifier.find((i) => i.system.includes('healthid')).value)}`, admin);
    assert(found.status === 200 && found.data.total === 1 && found.data.entry[0].resource.id === String(pid), 'search by ABHA failed');
  });

  await step('A diagnosis without a recorded edition is sent as text, never as an ICD-10 coding', async () => {
    const c = (await fhir(`Condition/${dx.id}`, admin)).data;
    assert(!c.code.coding && /R50\.9/.test(c.code.text) && /edition not recorded/.test(c.code.text), `legacy condition ${JSON.stringify(c.code)}`);
    const [coded] = await sql("SELECT d.id, r.version FROM hms_diagnoses d JOIN hms_term_releases r ON r.id = d.term_release_id WHERE d.coding_status = 'CODED' LIMIT 1");
    if (coded) {
      const k = (await fhir(`Condition/${coded.id}`, admin)).data;
      assert(k.code.coding[0].system === 'http://hl7.org/fhir/sid/icd-10' && k.code.coding[0].version === coded.version, `coded condition ${JSON.stringify(k.code)}`);
    }
  });

  await step('Vital signs carry LOINC codes and UCUM units; only released lab results are sent', async () => {
    const vs = (await fhir(`Observation?patient=${pid}&category=vital-signs`, admin)).data.entry.map((e) => e.resource);
    const bp = vs.find((o) => o.code.coding[0].code === '85354-9');
    assert(bp && bp.component.length === 2 && bp.component[0].valueQuantity.code === 'mm[Hg]', 'blood pressure panel');
    assert(vs.some((o) => o.code.coding[0].code === '29463-7' && o.meta.profile[0].endsWith('ObservationBodyMeasurement')), 'body weight');
    assert(vs.every((o) => /^[A-Za-z0-9\-.]{1,64}$/.test(o.id)), 'invalid FHIR ids');
    const lab = (await fhir(`Observation?patient=${labPatient}&category=laboratory`, admin)).data.entry.map((e) => e.resource.id.replace(/^lab-/, ''));
    const released = (await sql(`SELECT DISTINCT rr.result_version_id AS id FROM hms_lab_report_results rr JOIN hms_lab_result_versions rv ON rv.id = rr.result_version_id
      JOIN hms_investigation_order_items i ON i.id = rv.item_id JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.patient_id = $1`, [labPatient])).map((r) => r.id);
    assert(lab.length === released.length && lab.every((id) => released.includes(id)), `sent ${lab.length} lab results, ${released.length} released`);
    const reports = (await fhir(`DiagnosticReport?patient=${labPatient}`, admin)).data.entry.map((e) => e.resource);
    assert(reports.length && reports.every((r) => r.result.length && ['final', 'amended', 'preliminary'].includes(r.status)), 'reports');
  });

  await step('The output validates against FHIR R4 and the ABDM guide (official HL7 validator)', async () => {
    const dir = process.env.HMS_FHIR_VALIDATOR_DIR || path.join(os.homedir(), 'hms-tools/fhir/validator-6.10.4');
    assert(fs.existsSync(path.join(dir, 'classes/HmsValidate.class')), `validator not installed at ${dir}`);
    const resources = new Map();
    const add = (r) => resources.set(`${r.resourceType}/${r.id}`, r);
    for (const p of [pid, labPatient]) {
      add((await fhir(`Patient/${p}`, admin)).data);
      for (const t of ['Encounter', 'Condition', 'AllergyIntolerance', 'Observation', 'DiagnosticReport']) (await fhir(`${t}?patient=${p}`, admin)).data.entry.forEach((e) => add(e.resource));
    }
    for (let pass = 0; pass < 2; pass++) {
      for (const ref of new Set(JSON.stringify([...resources.values()]).match(/"reference":"(Practitioner|Organization|Specimen)\/[^"]+"/g) || [])) {
        const target = ref.slice(13, -1);
        if (!resources.has(target)) add((await fhir(target, admin)).data);
      }
    }
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hms-fhir-'));
    fs.writeFileSync(path.join(out, 'bundle.json'), JSON.stringify({ resourceType: 'Bundle', type: 'collection',
      entry: [...resources.values()].map((r) => ({ fullUrl: `https://hms.example/api/fhir/${r.resourceType}/${r.id}`, resource: r })) }));
    const r = spawnSync('java', ['-cp', `${dir}/lib/*:${dir}/classes`, 'HmsValidate', out], { encoding: 'utf8', timeout: 900000 });
    fs.rmSync(out, { recursive: true, force: true });
    const summary = (r.stdout || '').split('\n').find((l) => l.startsWith('validated')) || '';
    const errors = (r.stdout || '').split('\n').filter((l) => l.startsWith('ERROR')).slice(0, 8);
    assert(r.status === 0, `${summary || r.stderr?.slice(-400)}\n${errors.join('\n')}`);
    console.log(`      ${resources.size} resources: ${summary}`);
  });

  done();
  process.exit();
})();
