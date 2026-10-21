// Specimens, results, reports and critical results through the v2 API (completion A3, blueprint
// 3.10): an ordered test is collected, received, resulted and verified; a critical value opens a
// follow-up the doctor acknowledges and then documents action on; the report is released.
// Stale revisions are refused with 412, missing ones with 428; roles and label mismatches are
// refused; a rejected specimen asks for a recollection. Synthetic content only.
const crypto = require('crypto');
const { API, api, apiLogin, sql, inCare, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': crypto.randomUUID(), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const short = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 240)}`;
const v = (n) => ({ 'if-match': `"${n}"` });

(async () => {
  const { step, done } = runner('V2 laboratory results');
  const tag = crypto.randomUUID().slice(0, 8);
  const at = new Date(Date.now() - 3600000).toISOString();
  const doctor = await apiLogin('doctor');
  const lab = await apiLogin('lab_technician');
  const nurse = await apiLogin('nurse');
  const admin = await apiLogin('super_admin');
  const [{ id: uid }] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [{ id: labid }] = await sql("SELECT id FROM hms_users WHERE username = 'labtech'");
  const legacy = (path, token, body) => api('POST', '/laboratory' + path, { token, body });
  const ok = (r, status) => { assert(r.status === status, short(r)); return r.data.data; };
  let patient, order, item, requirement, specimen, result, critical;
  const ctx = {};

  await step('Prepare a patient in care, laboratory grants and a coded test with a critical rule', async () => {
    const [p] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id, public_id",
      ['Synthetic v2 lab ' + tag, 'V2L-' + tag]);
    patient = p;
    await inCare(p.id);
    const [enc] = await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'In Progress') RETURNING public_id", [p.id, uid]);
    for (const [user, privilege] of [[labid, 'CONTENT'], [labid, 'TECHNICAL_REVIEW'], [uid, 'RELEASE']]) {
      const g = await legacy('/privileges', admin, { user_id: user, privilege, reason: 'Synthetic v2 laboratory fixture', valid_from: at, valid_until: new Date(Date.now() + 86400000).toISOString() });
      assert(g.status === 201, `grant ${short(g)}`);
    }
    const test = ok(await legacy('/catalogue', lab, { code_system: 'TEST', code: tag + 'V2', kind: 'TEST', name: 'Synthetic v2 ' + tag, section: 'TEST-SECTION', unit: 'TEST-U', method: 'TEST-METHOD', provenance: 'Synthetic acceptance content only', effective_at: at, requirements: [{ specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE' }] }), 201);
    const cfg = (kind, body) => legacy('/configuration/' + kind, lab, { test_version_id: test.id, version: 1, method: 'TEST-METHOD', provenance: 'Synthetic fixture only', effective_at: at, ...body });
    const qcRule = ok(await cfg('qc', { criteria: { synthetic_control: 'recorded comparison' } }), 201);
    const escalation = ok(await legacy('/configuration/escalation', lab, { code: tag + 'ESC', version: 1, provenance: 'Synthetic escalation fixture', effective_at: at, steps: [{ after_seconds: 3600, recipient_user_id: uid }] }), 201);
    ok(await cfg('reference', { unit: 'TEST-U', lower_bound: '1', upper_bound: '10', lower_inclusive: true, upper_inclusive: true }), 201);
    ok(await cfg('critical', { unit: 'TEST-U', upper_bound: '4', lower_inclusive: false, upper_inclusive: false, escalation_policy_id: escalation.id }), 201);
    const o = await call('POST', '/v2/lab-orders', doctor, { patient_id: p.public_id, encounter_id: enc.public_id, test_version_ids: [test.id] });
    order = ok(o, 201);
    [item] = await sql('SELECT i.public_id, i.lab_revision FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.public_id = $1', [order.id]);
    [requirement] = await sql('SELECT id FROM hms_lab_requirements WHERE test_version_id = $1', [test.id]);
    Object.assign(ctx, { qcRule, test, encounter: enc.public_id });
  });

  await step('A specimen is planned for the ordered test; the front desk cannot do it', async () => {
    const body = { patient_id: patient.public_id, specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE', location: 'TEST-COLLECTION', links: [{ item_id: item.public_id, requirement_id: requirement.id }] };
    const desk = await apiLogin('receptionist');
    assert((await call('POST', '/v2/specimens', desk, body)).status === 403, 'receptionist planned a specimen');
    specimen = ok(await call('POST', '/v2/specimens', lab, body), 201);
    assert(specimen.state === 'PLANNED' && specimen.patient_id === patient.public_id && specimen.accession, `specimen ${JSON.stringify(specimen)}`);
  });

  await step('Collection and receipt need the current revision and the label\'s patient and accession', async () => {
    const label = { patient_id: patient.public_id, accession: specimen.accession, location: 'TEST-WARD', reason: 'Synthetic custody evidence' };
    const missing = await call('POST', `/v2/specimens/${specimen.id}/collect`, nurse, label);
    assert(missing.status === 428, `collect without If-Match: ${short(missing)}`);
    const wrong = await call('POST', `/v2/specimens/${specimen.id}/collect`, nurse, { ...label, accession: 'WRONG' }, v(specimen.version));
    assert(wrong.status === 422 && wrong.data.code === 'SPECIMEN_PATIENT_MISMATCH', `wrong label: ${short(wrong)}`);
    const collected = ok(await call('POST', `/v2/specimens/${specimen.id}/collect`, nurse, label, v(specimen.version)), 200);
    const stale = await call('POST', `/v2/specimens/${specimen.id}/receive`, lab, { ...label, location: 'TEST-LAB' }, v(specimen.version));
    assert(stale.status === 412, `receive on a stale revision: ${short(stale)}`);
    specimen = ok(await call('POST', `/v2/specimens/${specimen.id}/receive`, lab, { ...label, location: 'TEST-LAB' }, v(collected.version)), 200);
    assert(specimen.state === 'RECEIVED' && specimen.received_at, `receive ${JSON.stringify(specimen)}`);
  });

  await step('A result is entered once per revision; a critical value verified opens a critical result', async () => {
    const [{ lab_revision }] = await sql('SELECT lab_revision FROM hms_investigation_order_items WHERE public_id = $1', [item.public_id]);
    const body = { specimen_id: specimen.id, raw_value: '6', unit: 'TEST-U', method: 'TEST-METHOD' };
    const nurseTry = await call('POST', `/v2/lab-items/${item.public_id}/results`, nurse, body, v(lab_revision));
    assert(nurseTry.status === 403, `nurse entered a result: ${short(nurseTry)}`);
    result = ok(await call('POST', `/v2/lab-items/${item.public_id}/results`, lab, body, v(lab_revision)), 201);
    const again = await call('POST', `/v2/lab-items/${item.public_id}/results`, lab, { ...body, raw_value: '7' }, v(lab_revision));
    assert(again.status === 412, `a second result on the same revision: ${short(again)}`);
    const qc = ok(await legacy('/qc', lab, { rule_id: ctx.qcRule.id, status: 'PASS', evidence: { synthetic_control: 'fixture-pass' } }), 201);
    const verified = ok(await call('POST', `/v2/results/${result.id}/verify`, lab, { qc_record_id: qc.id, decision: 'VERIFIED', reason: 'Synthetic technical validation' }, v(result.version)), 200);
    assert(verified.decision === 'VERIFIED' && verified.critical_result_id, `verify ${JSON.stringify(verified)}`);
    [critical] = await sql('SELECT id, revision FROM hms_lab_critical_tasks WHERE id = $1', [verified.critical_result_id]);
    ctx.itemVersion = verified.version;
  });

  await step('The doctor acknowledges the critical result, then documents the clinical action separately', async () => {
    const early = await call('POST', `/v2/critical-results/${critical.id}/clinical-actions`, doctor, { clinical_action: 'Synthetic disposition' }, v(critical.revision));
    assert(early.status === 409, `action before acknowledgment: ${short(early)}`);
    const byLab = await call('POST', `/v2/critical-results/${critical.id}/acknowledgments`, lab, { reason: 'Not a clinician' }, v(critical.revision));
    assert(byLab.status === 403, `technician acknowledged: ${short(byLab)}`);
    const ack = ok(await call('POST', `/v2/critical-results/${critical.id}/acknowledgments`, doctor, { reason: 'Synthetic clinician acknowledgment' }, v(critical.revision)), 201);
    assert(ack.state === 'ACKNOWLEDGED' && ack.acknowledged_at, `ack ${JSON.stringify(ack)}`);
    const closed = ok(await call('POST', `/v2/critical-results/${critical.id}/clinical-actions`, doctor, { clinical_action: 'Synthetic documented clinical disposition' }, v(ack.version)), 201);
    assert(closed.state === 'CLOSED' && closed.clinical_action, `close ${JSON.stringify(closed)}`);
  });

  await step('The report is released by the doctor with the exact verified result; the technician cannot release', async () => {
    const [{ lab_revision }] = await sql('SELECT lab_revision FROM hms_investigation_orders WHERE public_id = $1', [order.id]);
    const body = { status: 'FINAL', reason: 'Synthetic release', result_version_ids: [result.id] };
    const byLab = await call('POST', `/v2/lab-orders/${order.id}/reports`, lab, body, v(lab_revision));
    assert(byLab.status === 403, `technician released: ${short(byLab)}`);
    const report = ok(await call('POST', `/v2/lab-orders/${order.id}/reports`, doctor, body, v(lab_revision)), 201);
    assert(report.id && report.order_id === order.id && report.report_version === 1 && report.status === 'FINAL', `report ${JSON.stringify(report)}`);
  });

  await step('A rejected specimen is recorded and the test asks for a recollection', async () => {
    // A second order: the first one's test is released and no longer collectable.
    const second = ok(await call('POST', '/v2/lab-orders', doctor, { patient_id: patient.public_id, encounter_id: ctx.encounter, test_version_ids: [ctx.test.id] }), 201);
    const [item2] = await sql('SELECT i.public_id FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id = i.order_id WHERE o.public_id = $1', [second.id]);
    const extra = ok(await call('POST', '/v2/specimens', lab, { patient_id: patient.public_id, specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE', location: 'TEST-COLLECTION', links: [{ item_id: item2.public_id, requirement_id: requirement.id }] }), 201);
    const rejected = ok(await call('POST', `/v2/specimens/${extra.id}/reject`, lab, { patient_id: patient.public_id, accession: extra.accession, location: 'TEST-LAB', reason: 'Synthetic haemolysed sample' }, v(extra.version)), 200);
    assert(rejected.state === 'REJECTED', `reject ${JSON.stringify(rejected)}`);
    const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_lab_recollections WHERE rejected_specimen_id = $1', [extra.id]);
    assert(n === 1, `${n} recollection requests for one rejected specimen`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
