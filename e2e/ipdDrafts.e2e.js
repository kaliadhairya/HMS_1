// IPD draft charges and bill generation: the bill contains exactly the saved
// drafts; a billing page whose list is out of date is refused instead of
// silently dropping charges; charges racing bill generation are either billed
// or refused, never left behind on a billed admission.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('IPD drafts');
  const sa = await apiLogin('super_admin');
  const unbilled = await sql(`SELECT a.id FROM hms_admissions a WHERE a.status = 'Active'
    AND NOT EXISTS (SELECT 1 FROM hms_bills b WHERE b.admission_id = a.id AND COALESCE(b.status, '') <> 'Cancelled')
    AND NOT EXISTS (SELECT 1 FROM hms_ipd_draft_charges d WHERE d.admission_id = a.id) ORDER BY a.id`);
  const meds = await sql('SELECT id, generic_name FROM hms_medicines WHERE is_active = 1 ORDER BY id LIMIT 2');
  assert(unbilled.length >= 2 && meds.length === 2, `need 2 unbilled admissions and 2 medicines (have ${unbilled.length}, ${meds.length})`);
  const add = (admissionId, med, quantity) => call('POST', `/ipd/admissions/${admissionId}/charges`, sa, { medicineId: med.id, medicineName: med.generic_name, quantity });
  const drafts = async (admissionId) => (await sql('SELECT medicine_id, quantity FROM hms_ipd_draft_charges WHERE admission_id = $1', [admissionId]));

  await step('A billing page whose list is out of date is refused, and no draft is lost', async () => {
    const admissionId = unbilled[0].id;
    assert((await add(admissionId, meds[0], 2)).status === 200, 'first charge');
    const pageList = (await call('GET', `/ipd/admissions/${admissionId}/charges`, sa)).data.data.charges;
    assert((await add(admissionId, meds[1], 3)).status === 200, 'charge added after the page loaded');
    const stale = await call('POST', `/ipd/admissions/${admissionId}/generate-bill`, sa, {
      items: pageList.map((c) => ({ medicineId: c.MEDICINE_ID, quantity: c.QUANTITY })),
    });
    assert(stale.status === 409, `stale page was billed: ${stale.status} ${JSON.stringify(stale.data)}`);
    assert((await drafts(admissionId)).length === 2, 'a draft disappeared');
    const fresh = (await call('GET', `/ipd/admissions/${admissionId}/charges`, sa)).data.data.charges;
    const billed = await call('POST', `/ipd/admissions/${admissionId}/generate-bill`, sa, {
      items: fresh.map((c) => ({ medicineId: c.MEDICINE_ID, quantity: c.QUANTITY })),
    });
    assert(billed.status === 201, `current page not billed: ${billed.status} ${JSON.stringify(billed.data)}`);
    const [bill] = await sql("SELECT id FROM hms_bills WHERE admission_id = $1 AND bill_type = 'IPD'", [admissionId]);
    const lines = await sql("SELECT count(*)::int AS n FROM hms_bill_items WHERE bill_id = $1 AND item_type <> 'Ward'", [bill.id]).catch(() => null);
    assert((await drafts(admissionId)).length === 0, 'drafts left after billing');
    if (lines) assert(lines[0].n >= 2, `bill has ${lines[0].n} medicine lines`);
  });

  await step('Charges racing bill generation are billed or refused, never orphaned', async () => {
    const admissionId = unbilled[1].id;
    assert((await add(admissionId, meds[0], 1)).status === 200, 'first charge');
    const results = await Promise.all([
      call('POST', `/ipd/admissions/${admissionId}/generate-bill`, sa, {}),
      ...Array.from({ length: 8 }, (_, i) => add(admissionId, meds[i % 2], 1)),
    ]);
    const billStatus = results[0].status;
    assert(billStatus === 201, `bill generation: ${billStatus} ${JSON.stringify(results[0].data)}`);
    const leftover = await drafts(admissionId);
    assert(leftover.length === 0, `${leftover.length} draft(s) orphaned on a billed admission`);
    const refused = results.slice(1).filter((r) => r.status === 409).length;
    const accepted = results.slice(1).filter((r) => r.status === 200).length;
    assert(refused + accepted === 8, `unexpected statuses ${results.slice(1).map((r) => r.status)}`);
  });

  done();
  process.exit();
})();
