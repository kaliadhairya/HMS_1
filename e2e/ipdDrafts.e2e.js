// IPD charges and billing (Phase 5): items added on the billing page are
// charges on the admission's account the moment they are saved. A bill issued
// from an out-of-date review is refused and nothing is lost; charges racing
// the bill are either on it or wait for the next one, never dropped or billed
// twice. The old draft endpoints are retired.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('IPD charges');
  const sa = await apiLogin('super_admin');
  requireThrowawayDb();
  const tag = crypto.randomUUID().slice(0, 8);
  const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const unbilled = [];
  // Own episodes: prior suites and repeated runs may have already charged the
  // restored admissions. They must not change this suite's exact count checks.
  for (let i = 0; i < 2; i++) {
    const [patient] = await sql(`INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate)
      VALUES ($1,$2,'other',30,'Female','Indoor',CURRENT_DATE) RETURNING id`,
      [`Synthetic IPD charges ${tag}-${i}`, `IPD-CHARGES-${tag}-${i}`]);
    const [bed] = await sql(`INSERT INTO hms_beds(ward_id,room_number,bed_number,status)
      SELECT id,'E2E',$1,'Occupied' FROM hms_wards WHERE type='Private' AND is_active=1 ORDER BY id LIMIT 1 RETURNING id`, [`IPD-CHARGES-${tag}-${i}`]);
    assert(bed, 'need an active Private ward');
    const [adm] = await sql(`INSERT INTO hms_admissions(patient_id,admitting_doctor_id,bed_id,admission_type,admission_date,status,created_by)
      VALUES ($1,$2,$3,'Planned',now(),'Active',$2) RETURNING id,admission_date`, [patient.id,doc.id,bed.id]);
    await sql(`INSERT INTO hms_bed_occupancies(bed_id,admission_id,starts_at,reason,created_by)
      VALUES ($1,$2,$3,'synthetic billing fixture',$4)`, [bed.id,adm.id,adm.admission_date,doc.id]);
    unbilled.push(adm);
  }
  const meds = await sql('SELECT id, generic_name FROM hms_medicines WHERE is_active = 1 ORDER BY id LIMIT 2');
  assert(unbilled.length >= 2 && meds.length === 2, `need 2 unbilled admissions and 2 medicines (have ${unbilled.length}, ${meds.length})`);
  const account = async (admissionId) => (await call('GET', `/finance/accounts/by-episode?admissionId=${admissionId}`, sa)).data.data;
  const add = (accountId, med, quantity) => call('POST', `/finance/accounts/${accountId}/charges`, sa, { medicineId: med.id, quantity });
  const manualCharges = (accountId) => sql("SELECT id FROM hms_charge_events WHERE account_id = $1 AND source_type = 'manual'", [accountId]);
  const onInvoice = (invoiceId) => sql('SELECT charge_event_id FROM hms_invoice_lines WHERE invoice_id = $1', [invoiceId]);

  await step('The old draft endpoints are retired (410)', async () => {
    const r = await Promise.all([
      call('GET', `/ipd/admissions/${unbilled[0].id}/charges`, sa),
      call('POST', `/ipd/admissions/${unbilled[0].id}/charges`, sa, { medicineId: meds[0].id, medicineName: meds[0].generic_name, quantity: 1 }),
      call('POST', `/ipd/admissions/${unbilled[0].id}/generate-bill`, sa, {}),
    ]);
    assert(r.every((x) => x.status === 410 && x.data.code === 'IPD_BILLING_MOVED'), `statuses ${r.map((x) => x.status)}`);
  });

  await step('A bill issued from an out-of-date review is refused, and no charge is lost', async () => {
    const acc = await account(unbilled[0].id);
    assert((await add(acc.id, meds[0], 2)).status === 201, 'first charge');
    const draft = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, sa, {});
    assert(draft.status === 200, `draft ${draft.status}`);
    assert((await add(acc.id, meds[1], 3)).status === 201, 'charge added after the review');
    const stale = await call('POST', `/finance/invoices/${draft.data.data.id}/issue`, sa, { revision: draft.data.data.revision });
    assert(stale.status === 409 && stale.data.code === 'STALE_DRAFT', `stale review was billed: ${stale.status} ${JSON.stringify(stale.data)}`);
    assert((await manualCharges(acc.id)).length === 2, 'a charge disappeared');
    const fresh = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, sa, {});
    const issued = await call('POST', `/finance/invoices/${fresh.data.data.id}/issue`, sa, { revision: fresh.data.data.revision });
    assert(issued.status === 200, `current review not billed: ${issued.status} ${JSON.stringify(issued.data)}`);
    const lines = await onInvoice(issued.data.data.id);
    const charges = await manualCharges(acc.id);
    assert(charges.every((c) => lines.some((l) => l.charge_event_id === c.id)), 'a charge is missing from the bill');
  });

  await step('Charges racing the bill are on it or wait for the next one; none is billed twice', async () => {
    const acc = await account(unbilled[1].id);
    assert((await add(acc.id, meds[0], 1)).status === 201, 'first charge');
    const draft = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, sa, {});
    const results = await Promise.all([
      call('POST', `/finance/invoices/${draft.data.data.id}/issue`, sa, {}),
      ...Array.from({ length: 8 }, (_, i) => add(acc.id, meds[i % 2], 1)),
    ]);
    assert(results[0].status === 200, `bill: ${results[0].status} ${JSON.stringify(results[0].data)}`);
    const accepted = results.slice(1).filter((r) => r.status === 201).length;
    assert(results.slice(1).every((r) => [201, 409].includes(r.status)), `unexpected statuses ${results.slice(1).map((r) => r.status)}`);
    const charges = await manualCharges(acc.id);
    assert(charges.length === 1 + accepted, `${charges.length} charges for ${1 + accepted} accepted`);
    const billed = await onInvoice(results[0].data.data.id);
    const leftover = charges.filter((c) => !billed.some((l) => l.charge_event_id === c.id));
    // Whatever missed the bill is still on the account, ready for the next one.
    if (leftover.length) {
      const next = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, sa, {});
      assert(next.status === 200 && next.data.data.lines.length === leftover.length, `next bill ${next.status} ${next.data?.data?.lines?.length}`);
    }
    const twice = await sql(`SELECT charge_event_id FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
      WHERE i.account_id = $1 AND i.status <> 'Draft' AND NOT l.released GROUP BY 1 HAVING count(*) > 1`, [acc.id]);
    assert(twice.length === 0, 'a charge is on two invoices');
  });

  done();
  process.exit();
})();
