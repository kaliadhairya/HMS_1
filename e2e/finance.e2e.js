// Phase 5, revenue cycle (migrations 0070–0076). Blueprint 5.3 "Finance":
// duplicate partial-payment retry, payment against concurrent credit,
// oversized/partial deposit allocation, refund replay, package exclusions,
// payer remittance and missing settlement; 5.1 exit: one episode produces a
// fully itemized, reconciled account, partial deposits and payer splits work,
// retries never double-post. Concurrency runs against real PostgreSQL.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();

async function call(method, url, token, body, key, extraHeaders = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': key || crypto.randomUUID() } : {}), ...extraHeaders },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), replay: res.headers.get('idempotent-replay') === 'true' };
}
const money = (v) => Math.round(Number(v) * 100) / 100;
const short = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`;

async function journalBalanced() {
  const [tb] = await sql('SELECT COALESCE(sum(debit), 0) AS d, COALESCE(sum(credit), 0) AS c FROM hms_journal_lines');
  const unbalanced = await sql(`SELECT entry_id FROM hms_journal_lines GROUP BY entry_id HAVING sum(debit) <> sum(credit)`);
  return money(tb.d) === money(tb.c) && unbalanced.length === 0;
}

(async () => {
  const { step, done } = runner('Revenue cycle');
  const desk = await apiLogin('receptionist');
  const admin = await apiLogin('admin');
  const superAdmin = await apiLogin('super_admin');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const tag = stamp();
  const ctx = {};
  const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");

  async function newPatient(name) {
    const reg = await call('POST', '/patients/hms', desk, {
      patientType: 'other', name: `${name} ${tag}`, age: 40, gender: 'Female', opdIndoor: 'OPD',
      testDate: new Date().toISOString().slice(0, 10), phoneNumber: `9${String(Date.now()).slice(-9)}`,
    });
    assert(reg.status === 201, `register ${short(reg)}`);
    const id = reg.data.data.id;
    assert([201, 409].includes((await call('POST', `/patients/hms/${id}/care-team`, desk, { practitionerUserId: doc.id, role: 'consulting' })).status), 'care team');
    return id;
  }
  const labVersions = new Map();
  async function codedLabVersion(name) {
    if (labVersions.has(name)) return labVersions.get(name);
    const labToken = await apiLogin('lab_technician');
    const [labUser] = await sql("SELECT id FROM hms_users WHERE username='labtech'");
    const [grant] = await sql("SELECT id FROM hms_lab_privileges WHERE user_id=$1 AND privilege='CONTENT' AND revoked_at IS NULL AND valid_from<=now() AND valid_until>now()", [labUser.id]);
    if (!grant) {
      const r = await call('POST', '/laboratory/privileges', superAdmin, {user_id:labUser.id,privilege:'CONTENT',reason:'Synthetic combined finance/laboratory test content',valid_from:new Date(Date.now()-1000).toISOString(),valid_until:new Date(Date.now()+86400000).toISOString()});
      assert(r.status===201, `test content privilege ${short(r)}`);
    }
    const r = await call('POST','/laboratory/catalogue',labToken,{code_system:'TEST-FINANCE',code:`${tag}-${labVersions.size}`,kind:'TEST',name,section:'Bio-Chemistry',unit:'TEST-U',method:'TEST-METHOD',provenance:'Synthetic integration fixture only',effective_at:new Date(Date.now()-1000).toISOString(),requirements:[{specimen_type:'TEST-BLOOD',container:'TEST-TUBE'}]});
    assert(r.status===201, `coded test fixture ${short(r)}`);labVersions.set(name,r.data.data.id);return r.data.data.id;
  }
  async function visit(patientId, tests = []) {
    const enc = await call('POST', '/hms/encounters', doctor, { patient_id: patientId });
    assert(enc.status === 201 || enc.status === 200, `encounter ${short(enc)}`);
    const encounterId = enc.data.id ?? enc.data.data?.id;
    for (const test of tests) {
      const o = await call('POST', '/hms/investigation-orders', doctor, { encounter_id: encounterId, patient_id: patientId, priority: 'Routine', items: [{ test_version_id: await codedLabVersion(test) }] });
      assert(o.status === 201 || o.status === 200, `lab order ${short(o)}`);
    }
    return encounterId;
  }
  // Signing needs the record revision the doctor reviewed (completion A5/A6).
  // A note is signed only with saved clinical content.
  const finalize = async (encounterId) => {
    const [{ record_revision: before }] = await sql('SELECT record_revision FROM hms_encounters WHERE id = $1', [encounterId]);
    const saved = await call('PUT', `/hms/encounters/${encounterId}`, doctor, { chief_complaint: 'Synthetic billing visit' }, undefined, { 'if-match': String(before) });
    assert(saved.status === 200, `note ${short(saved)}`);
    const revision = saved.data.data?.revision ?? Number(before) + 1;
    const f = await call('PATCH', `/hms/encounters/${encounterId}/finalize`, doctor, {}, undefined, { 'if-match': String(revision) });
    assert(f.status === 200, `finalize ${short(f)}`);
  };
  const account = async (q) => {
    const r = await call('GET', `/finance/accounts/by-episode?${q}`, desk);
    assert(r.status === 200, `account ${short(r)}`);
    return r.data.data;
  };

  await step('Charges are recorded when services happen: consultation on finalize, each test on order, a cancelled test reversed', async () => {
    ctx.opdPatient = await newPatient('Finance OPD');
    ctx.encounter = await visit(ctx.opdPatient, ['Serum creatinine', 'Lipid profile']);
    let acc = await account(`encounterId=${ctx.encounter}`);
    assert(acc.charges.filter((c) => c.source_type === 'lab_order_item').length === 2, `lab charges ${JSON.stringify(acc.charges.map((c) => c.source_type))}`);
    assert(!acc.charges.some((c) => c.source_type === 'consultation'), 'consultation charged before the visit was finalized');
    // Cancel one test through the lab queue: its charge is reversed, not deleted.
    const [order] = await sql(`SELECT o.id,o.lab_revision FROM hms_investigation_orders o JOIN hms_investigation_order_items i ON i.order_id = o.id
      WHERE o.encounter_id = $1 AND i.item_name = 'Lipid profile'`, [ctx.encounter]);
    // Cancelling an ordered test is the ordering clinician's decision (PRESCRIBE, Codex A2).
    const cancel = await call('POST', `/laboratory/orders/${order.id}/cancel`, doctor, {}, undefined, { 'if-match': String(order.lab_revision) });
    assert(cancel.status === 200, `cancel ${short(cancel)}`);
    await finalize(ctx.encounter);
    acc = await account(`encounterId=${ctx.encounter}`);
    ctx.opdAccount = acc.id;
    const consult = acc.charges.filter((c) => c.source_type === 'consultation');
    const reversal = acc.charges.filter((c) => c.source_type === 'reversal');
    assert(consult.length === 1 && reversal.length === 1 && Number(reversal[0].amount) < 0, `charges ${JSON.stringify(acc.charges.map((c) => [c.source_type, c.amount]))}`);
    // Finalizing twice does not charge twice; charges cannot be edited or deleted.
    // (A signed visit cannot be reopened at all: the database refuses it.)
    let reopened = true;
    try { await sql("UPDATE hms_encounters SET status = 'Draft' WHERE id = $1", [ctx.encounter]); } catch { reopened = false; }
    assert(!reopened, 'a finalized visit was reopened');
    const [{ record_revision: rev }] = await sql('SELECT record_revision FROM hms_encounters WHERE id = $1', [ctx.encounter]);
    const twice = await call('PATCH', `/hms/encounters/${ctx.encounter}/finalize`, doctor, {}, undefined, { 'if-match': String(rev) });
    assert(twice.status >= 400, `finalized twice: ${short(twice)}`);
    const [{ n }] = await sql("SELECT count(*)::int AS n FROM hms_charge_events WHERE source_type = 'consultation' AND source_key = $1", [String(ctx.encounter)]);
    assert(n === 1, `${n} consultation charges`);
    let blocked = false;
    try { await sql('UPDATE hms_charge_events SET amount = 0 WHERE id = $1', [consult[0].id]); } catch { blocked = true; }
    assert(blocked, 'a charge event was edited');
  });

  await step('The OPD bill is an invoice of those charges; concurrent "generate" calls issue it once; issued invoices are immutable', async () => {
    const results = await Promise.all([1, 2, 3].map(() => call('POST', '/billing/opd', desk, { encounterId: ctx.encounter })));
    results.forEach((r) => assert(r.status === 200, `generate ${short(r)}`));
    assert(results.filter((r) => r.data.existing === false).length === 1, `issued ${results.filter((r) => !r.data.existing).length} times`);
    const invoices = await sql("SELECT * FROM hms_invoices WHERE account_id = $1 AND status <> 'Draft'", [ctx.opdAccount]);
    assert(invoices.length === 1, `${invoices.length} invoices`);
    ctx.opdInvoice = invoices[0];
    const lines = await sql('SELECT category, amount FROM hms_invoice_lines WHERE invoice_id = $1 ORDER BY line_no', [ctx.opdInvoice.id]);
    assert(lines.length === 2 && lines.some((l) => l.category === 'Consultation') && lines.some((l) => l.category === 'Lab'), `lines ${JSON.stringify(lines)}`);
    const [bill] = await sql('SELECT * FROM hms_bills WHERE id = $1', [ctx.opdInvoice.legacy_bill_id]);
    assert(bill && money(bill.net_payable) === money(ctx.opdInvoice.total) && bill.status === 'Pending', `projection ${JSON.stringify(bill)}`);
    const [entries] = await sql("SELECT count(*)::int AS n FROM hms_journal_entries WHERE source_type = 'invoice' AND source_key = $1", [ctx.opdInvoice.id]);
    assert(entries.n === 1, `${entries.n} postings for the invoice`);
    let blocked = false;
    try { await sql('UPDATE hms_invoices SET total = total + 1, patient_amount = patient_amount + 1, subtotal = subtotal + 1 WHERE id = $1', [ctx.opdInvoice.id]); } catch { blocked = true; }
    assert(blocked, 'an issued invoice was edited');
    blocked = false;
    try { await sql('DELETE FROM hms_journal_lines WHERE entry_id IN (SELECT id FROM hms_journal_entries WHERE source_key = $1)', [ctx.opdInvoice.id]); } catch { blocked = true; }
    assert(blocked, 'a journal line was deleted');
    assert(await journalBalanced(), 'journal does not balance');
  });

  await step('Duplicate partial-payment retry: the same key replays the receipt; racing partial payments never exceed the balance', async () => {
    const total = money(ctx.opdInvoice.total);
    const key = crypto.randomUUID();
    const first = await call('POST', '/finance/payments', desk, { invoiceId: ctx.opdInvoice.id, amount: 50, method: 'Cash' }, key);
    const retry = await call('POST', '/finance/payments', desk, { invoiceId: ctx.opdInvoice.id, amount: 50, method: 'Cash' }, key);
    assert(first.status === 201 && retry.status === 201 && retry.replay, `retry ${short(retry)}`);
    assert(first.data.data.receipt.receipt_number === retry.data.data.receipt.receipt_number, 'retry produced another receipt');
    const left = money(total - 50);
    // Two different desks try to take the whole remaining balance at once.
    const race = await Promise.all([1, 2].map(() => call('POST', '/finance/payments', desk, { invoiceId: ctx.opdInvoice.id, amount: left, method: 'Cash' })));
    assert(race.filter((r) => r.status === 201).length === 1, `race ${race.map(short).join(' | ')}`);
    assert(race.some((r) => r.status === 400 || r.status === 409), `loser ${race.map(short).join(' | ')}`);
    const [due] = await sql('SELECT billing_invoice_patient_due($1) AS due', [ctx.opdInvoice.id]);
    const [{ n, sum }] = await sql('SELECT count(*)::int AS n, sum(r.amount) AS sum FROM hms_receipts r JOIN hms_payment_intents i ON i.id = r.intent_id WHERE i.invoice_id = $1', [ctx.opdInvoice.id]);
    assert(money(due.due) === 0 && n === 2 && money(sum) === total, `due ${due.due}, ${n} receipts totalling ${sum}`);
    const [bill] = await sql('SELECT status FROM hms_bills WHERE id = $1', [ctx.opdInvoice.legacy_bill_id]);
    assert(bill.status === 'Paid', `projection ${bill.status}`);
    const again = await call('POST', '/finance/payments', desk, { invoiceId: ctx.opdInvoice.id, amount: 1, method: 'Cash' });
    assert(again.status === 400, `payment on a paid invoice ${short(again)}`);
  });

  await step('Card payment with no answer is Unknown: a second collection is refused until reconciliation confirms it', async () => {
    const pid = await newPatient('Finance Card');
    const enc = await visit(pid, []);
    await finalize(enc);
    const issued = await call('POST', '/billing/opd', desk, { encounterId: enc });
    assert(issued.status === 200, `bill ${short(issued)}`);
    const inv = issued.data.data.invoiceId;
    const [i] = await sql('SELECT total FROM hms_invoices WHERE id = $1', [inv]);
    const noRef = await call('POST', '/finance/payments', desk, { invoiceId: inv, amount: money(i.total), method: 'Card' });
    assert(noRef.status === 400, `card without reference ${short(noRef)}`);
    const unknown = await call('POST', '/finance/payments', desk, { invoiceId: inv, amount: money(i.total), method: 'Card', outcome: 'unknown' });
    assert(unknown.status === 201 && unknown.data.data.intent.state === 'Unknown' && !unknown.data.data.receipt, `unknown ${short(unknown)}`);
    const second = await call('POST', '/finance/payments', desk, { invoiceId: inv, amount: money(i.total), method: 'Cash' });
    assert(second.status === 409 && second.data.code === 'PAYMENT_OUTCOME_OPEN', `second collection ${short(second)}`);
    const run = await call('POST', '/finance/reconciliation/run', admin, {});
    assert(run.status === 200 && run.data.data.found.some((f) => f.kind === 'unknown_payment' && f.key === unknown.data.data.intent.id), `exceptions ${short(run)}`);
    const ref = `TXN${tag}`;
    const confirmed = await call('POST', `/finance/payments/${unknown.data.data.intent.id}/confirm`, desk, { providerReference: ref });
    assert(confirmed.status === 200 && confirmed.data.data.receipt, `confirm ${short(confirmed)}`);
    const twice = await call('POST', `/finance/payments/${unknown.data.data.intent.id}/confirm`, desk, { providerReference: ref });
    assert(twice.status === 409, `confirmed twice ${short(twice)}`);
    ctx.cardReceipt = { id: confirmed.data.data.receipt.id, amount: money(i.total), ref };
    // The provider reference cannot be reused for another payment.
    const pid2 = await newPatient('Finance Card Two');
    const enc2 = await visit(pid2, []);
    await finalize(enc2);
    const inv2 = (await call('POST', '/billing/opd', desk, { encounterId: enc2 })).data.data.invoiceId;
    const reuse = await call('POST', '/finance/payments', desk, { invoiceId: inv2, amount: 1, method: 'Card', providerReference: ref });
    assert(reuse.status === 409 && reuse.data.code === 'DUPLICATE_PROVIDER_REFERENCE', `reused reference ${short(reuse)}`);
  });

  await step('Settlements: a matching card settlement reconciles; a wrong amount or unknown reference opens an owned exception', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const good = await call('POST', '/finance/settlements', admin, { source: 'card', statementReference: `ST-${tag}-1`, providerReference: ctx.cardReceipt.ref, amount: ctx.cardReceipt.amount, settledOn: today });
    assert(good.status === 201 && good.data.data.matched === true, `settlement ${short(good)}`);
    const dup = await call('POST', '/finance/settlements', admin, { source: 'card', statementReference: `ST-${tag}-1`, providerReference: ctx.cardReceipt.ref, amount: ctx.cardReceipt.amount, settledOn: today });
    assert(dup.status === 409, `duplicate statement line ${short(dup)}`);
    const stray = await call('POST', '/finance/settlements', admin, { source: 'upi', statementReference: `ST-${tag}-2`, providerReference: `NOPE${tag}`, amount: 99, settledOn: today });
    assert(stray.status === 201 && stray.data.data.matched === false, `stray ${short(stray)}`);
    const ex = await call('GET', '/finance/reconciliation/exceptions?status=Open', admin);
    const mine = ex.data.data.find((e) => e.kind === 'unmatched_settlement' && e.subject_key === stray.data.data.settlement.id);
    assert(mine, 'no exception for the unmatched settlement');
    const owner = await call('PUT', `/finance/reconciliation/exceptions/${mine.id}/owner`, admin, { ownerUserId: (await sql("SELECT id FROM hms_users WHERE username = 'receptionist'"))[0].id });
    assert(owner.status === 200, `assign ${short(owner)}`);
    const resolved = await call('POST', `/finance/reconciliation/exceptions/${mine.id}/resolve`, admin, { resolution: 'Bank confirmed it belongs to another hospital account' });
    assert(resolved.status === 200 && resolved.data.data.status === 'Resolved', `resolve ${short(resolved)}`);
  });

  await step('Payment against a concurrent credit note: money received is never lost or doubled', async () => {
    const pid = await newPatient('Finance Credit');
    const enc = await visit(pid, ['Thyroid profile']);
    await finalize(enc);
    const inv = (await call('POST', '/billing/opd', desk, { encounterId: enc })).data.data.invoiceId;
    const [i] = await sql('SELECT total FROM hms_invoices WHERE id = $1', [inv]);
    const total = money(i.total);
    const [lab] = await sql("SELECT id, amount FROM hms_invoice_lines WHERE invoice_id = $1 AND category = 'Lab'", [inv]);
    const [pay, credit] = await Promise.all([
      call('POST', '/finance/payments', desk, { invoiceId: inv, amount: total, method: 'Cash' }),
      call('POST', `/finance/invoices/${inv}/notes`, admin, { kind: 'credit', reason: 'Test not performed: sample hemolysed', lines: [{ invoiceLineId: lab.id, amount: Number(lab.amount) }] }),
    ]);
    assert(credit.status === 201, `credit ${short(credit)}`);
    assert(pay.status === 201 || pay.status === 400, `payment ${short(pay)}`);
    // Every rupee received is either applied to the bill or held for the patient.
    const received = (await sql('SELECT COALESCE(sum(r.amount), 0) AS v FROM hms_receipts r JOIN hms_payment_intents p ON p.id = r.intent_id WHERE p.invoice_id = $1', [inv]))[0].v;
    const allocated = (await sql('SELECT COALESCE(sum(amount), 0) AS v FROM hms_allocations WHERE invoice_id = $1 AND receipt_id IS NOT NULL', [inv]))[0].v;
    const heldFromReceipt = (await sql("SELECT COALESCE(sum(amount), 0) AS v FROM hms_patient_funds WHERE patient_id = $1 AND receipt_id IS NOT NULL", [pid]))[0].v;
    const credits = (await sql("SELECT COALESCE(sum(amount), 0) AS v FROM hms_patient_funds WHERE patient_id = $1 AND kind = 'credit'", [pid]))[0].v;
    const [due] = await sql('SELECT billing_invoice_patient_due($1) AS due', [inv]);
    assert(money(received) === money(Number(allocated) + Number(heldFromReceipt)), `received ${received}, allocated ${allocated}, held ${heldFromReceipt}`);
    if (pay.status === 201) {
      // Payment won the race: the credited part became money held for the patient.
      assert(money(credits) === money(lab.amount) && money(due.due) === -money(lab.amount), `credit fund ${credits}, due ${due.due}`);
    } else {
      assert(pay.data.code === 'MORE_THAN_DUE', `refusal ${short(pay)}`);
    }
    const [inv2] = await sql('SELECT status FROM hms_invoices WHERE id = $1', [inv]);
    assert(inv2.status === 'PartiallyCredited', `invoice ${inv2.status}`);
    assert(await journalBalanced(), 'journal does not balance');
  });

  await step('IPD episode: bed days by ward across a transfer, a deposit partly applied, the rest still held', async () => {
    requireThrowawayDb();
    ctx.ipdPatient = await newPatient('Finance IPD');
    // Two new beds, so the back-dated stay overlaps no one else's.
    const [general] = await sql(`INSERT INTO hms_beds (ward_id, room_number, bed_number)
      SELECT id, 'E2E', 'E2E-G-${tag}' FROM hms_wards WHERE type = 'General' AND is_active = 1 LIMIT 1 RETURNING id`);
    const [priv] = await sql(`INSERT INTO hms_beds (ward_id, room_number, bed_number)
      SELECT id, 'E2E', 'E2E-P-${tag}' FROM hms_wards WHERE type = 'Private' AND is_active = 1 LIMIT 1 RETURNING id`);
    assert(general && priv, 'need General and Private wards');
    // Admitted three days and two hours ago in General; moved to Private 23 hours later.
    const [adm] = await sql(`INSERT INTO hms_admissions (patient_id, admitting_doctor_id, bed_id, admission_type, admission_date, status, created_by)
      VALUES ($1, $2, $3, 'Planned', (now() - interval '3 days 2 hours')::timestamp, 'Active', $2) RETURNING id, admission_date`, [ctx.ipdPatient, doc.id, priv.id]);
    ctx.admission = adm.id;
    await sql(`INSERT INTO hms_bed_occupancies (bed_id, admission_id, starts_at, ends_at, reason) VALUES ($1, $2, $3::timestamp, $3::timestamp + interval '23 hours', 'admission')`, [general.id, adm.id, adm.admission_date]);
    await sql(`INSERT INTO hms_bed_occupancies (bed_id, admission_id, starts_at, reason) VALUES ($1, $2, $3::timestamp + interval '23 hours', 'transfer')`, [priv.id, adm.id, adm.admission_date]);
    await sql("UPDATE hms_beds SET status = 'Occupied' WHERE id = $1", [priv.id]);
    ctx.privBed = priv.id;
    // A deposit at the desk, through the old endpoint the front desk uses.
    const dep = await call('POST', '/billing/advance', desk, { patientId: ctx.ipdPatient, admissionId: adm.id, amount: 5000, paymentMode: 'Cash' });
    assert(dep.status === 201 && dep.data.data.receiptNumber, `deposit ${short(dep)}`);
    const acc = await account(`admissionId=${adm.id}`);
    ctx.ipdAccount = acc.id;
    const days = acc.charges.filter((c) => c.source_type === 'ward_day').map((c) => money(c.unit_price));
    // Day 1 General (400); days 2 and 3 Private (800).
    assert(JSON.stringify(days) === JSON.stringify([400, 800, 800]), `bed days ${JSON.stringify(days)}`);
    // A nurse adds a medicine at MRP; she cannot price a service by hand.
    const [med] = await sql("SELECT medicine_id AS id FROM hms_medicine_batches WHERE quantity > 0 AND mrp > 0 ORDER BY id LIMIT 1");
    const add = await call('POST', `/finance/accounts/${acc.id}/charges`, nurse, { medicineId: med.id, quantity: 2 });
    assert(add.status === 201 && add.data.data.category === 'Medicine', `medicine ${short(add)}`);
    const manual = await call('POST', `/finance/accounts/${acc.id}/charges`, nurse, { category: 'Service', description: 'Oxygen', unitPrice: 999, reason: 'Oxygen cylinder' });
    assert(manual.status === 403, `nurse priced by hand ${short(manual)}`);
    ctx.medCharge = add.data.data;
  });

  await step('Interim bill, stale review refused, discharge charges the rest, final bill uses the deposit partly', async () => {
    const draft = await call('POST', `/finance/accounts/${ctx.ipdAccount}/invoices/draft`, desk, {});
    assert(draft.status === 200 && draft.data.data.kind === 'interim', `draft ${short(draft)}`);
    const seen = draft.data.data.revision;
    // A charge lands after the desk reviewed the draft: issuing that review is refused.
    const extra = await call('POST', `/finance/accounts/${ctx.ipdAccount}/charges`, admin, { category: 'Procedure', description: 'Dressing', unitPrice: 150, reason: 'Wound dressing, not on the price list' });
    assert(extra.status === 201, `extra ${short(extra)}`);
    const stale = await call('POST', `/finance/invoices/${draft.data.data.id}/issue`, desk, { revision: seen });
    assert(stale.status === 409 && stale.data.code === 'STALE_DRAFT', `stale issue ${short(stale)}`);
    const fresh = await call('POST', `/finance/accounts/${ctx.ipdAccount}/invoices/draft`, desk, {});
    const interim = await call('POST', `/finance/invoices/${fresh.data.data.id}/issue`, desk, { revision: fresh.data.data.revision });
    assert(interim.status === 200 && interim.data.data.status === 'Issued', `interim ${short(interim)}`);
    ctx.interim = interim.data.data;
    assert(money(ctx.interim.subtotal) === money(400 + 800 + 800 + Number(ctx.medCharge.amount) + 150), `interim total ${ctx.interim.subtotal}`);
    // Discharge a day later: the fourth day is charged at the Private rate.
    await sql("UPDATE hms_admissions SET status = 'Discharged', discharge_date = (admission_date + interval '4 days 3 hours') WHERE id = $1", [ctx.admission]);
    await sql("UPDATE hms_bed_occupancies SET ends_at = now() WHERE admission_id = $1 AND ends_at IS NULL", [ctx.admission]);
    await sql("UPDATE hms_beds SET status = 'Dirty' WHERE id = $1", [ctx.privBed]);
    const acc = await account(`admissionId=${ctx.admission}`);
    const days = acc.charges.filter((c) => c.source_type === 'ward_day').length;
    assert(days === 4, `${days} bed days after discharge`);
    const final = await call('POST', `/finance/accounts/${ctx.ipdAccount}/invoices/draft`, desk, {});
    assert(final.status === 200 && final.data.data.kind === 'final' && final.data.data.lines.length === 1, `final draft ${short(final)}`);
    // Discount on the draft is an administrator's, with a reason.
    assert((await call('PUT', `/finance/invoices/${final.data.data.id}/discount`, desk, { amount: 100, reason: 'Goodwill' })).status === 403, 'desk gave a discount');
    const disc = await call('PUT', `/finance/invoices/${final.data.data.id}/discount`, admin, { amount: 100, reason: 'Goodwill', revision: final.data.data.revision });
    assert(disc.status === 200 && money(disc.data.data.total) === 700, `discount ${short(disc)}`);
    const issued = await call('POST', `/finance/invoices/${final.data.data.id}/issue`, desk, { revision: disc.data.data.revision, applyDeposits: true });
    assert(issued.status === 200, `final ${short(issued)}`);
    // The deposit (5000) pays this final bill (700) and stays partly unused.
    const funds = await call('GET', `/finance/patients/${ctx.ipdPatient}/funds`, desk);
    const deposit = funds.data.data.find((f) => f.kind === 'deposit');
    assert(money(deposit.balance) === 4300, `deposit left ${deposit.balance}`);
    ctx.deposit = deposit.id;
    // Applying it to the interim bill takes only what is due there.
    const interimDue = money((await sql('SELECT billing_invoice_patient_due($1) AS d', [ctx.interim.id]))[0].d);
    const over = await call('POST', `/finance/funds/${ctx.deposit}/allocate`, desk, { invoiceId: ctx.interim.id, amount: interimDue + 1 });
    assert(over.status === 400 && over.data.code === 'MORE_THAN_DUE', `oversized allocation ${short(over)}`);
    // Two desks apply the same deposit to the interim bill at once: it is used once.
    const race = await Promise.all([1, 2].map(() => call('POST', `/finance/funds/${ctx.deposit}/allocate`, desk, { invoiceId: ctx.interim.id })));
    assert(race.filter((r) => r.status === 201).length === 1, `allocation race ${race.map(short).join(' | ')}`);
    const [left] = await sql('SELECT billing_fund_balance($1) AS b', [ctx.deposit]);
    assert(money(left.b) === money(4300 - interimDue), `deposit balance ${left.b}`);
    const [bill] = await sql('SELECT * FROM hms_bills WHERE id = (SELECT legacy_bill_id FROM hms_invoices WHERE id = $1)', [issued.data.data.id]);
    assert(bill.bill_type === 'IPD' && money(bill.advance_adjusted) === 700 && money(bill.net_payable) === 0 && bill.status === 'Paid', `IPD bill ${JSON.stringify(bill)}`);
  });

  await step('Refund replay: approval by a second person; a replayed payout is the same refund; never more than is left', async () => {
    const [left] = await sql('SELECT billing_fund_balance($1) AS b', [ctx.deposit]);
    const tooMuch = await call('POST', '/finance/refunds', desk, { fundId: ctx.deposit, amount: money(left.b) + 1, method: 'Cash', reason: 'Patient discharged' });
    assert(tooMuch.status === 400, `refund more than held ${short(tooMuch)}`);
    const req1 = await call('POST', '/finance/refunds', admin, { fundId: ctx.deposit, amount: money(left.b), method: 'Cash', reason: 'Unused deposit after discharge' });
    assert(req1.status === 201, `request ${short(req1)}`);
    const self = await call('POST', `/finance/refunds/${req1.data.data.id}/approve`, admin, {});
    assert(self.status === 403, `self approval ${short(self)}`);
    // While the first refund is pending, the deposit is reserved for it.
    const second = await call('POST', '/finance/refunds', desk, { fundId: ctx.deposit, amount: 1, method: 'Cash', reason: 'Second try at the same money' });
    assert(second.status === 400, `second refund ${short(second)}`);
    const ok = await call('POST', `/finance/refunds/${req1.data.data.id}/approve`, superAdmin, {});
    assert(ok.status === 200 && ok.data.data.state === 'Approved', `approve ${short(ok)}`);
    const key = crypto.randomUUID();
    const pay = await call('POST', `/finance/refunds/${req1.data.data.id}/pay`, desk, {}, key);
    const replay = await call('POST', `/finance/refunds/${req1.data.data.id}/pay`, desk, {}, key);
    const fresh = await call('POST', `/finance/refunds/${req1.data.data.id}/pay`, desk, {});
    assert(pay.status === 200 && pay.data.data.state === 'Confirmed', `pay ${short(pay)}`);
    assert(replay.status === 200 && replay.replay && replay.data.data.id === pay.data.data.id, `replay ${short(replay)}`);
    assert(fresh.status === 409, `paid twice ${short(fresh)}`);
    const [{ n }] = await sql("SELECT count(*)::int AS n FROM hms_journal_entries WHERE source_type = 'refund' AND source_key = $1", [req1.data.data.id]);
    assert(n === 1, `${n} refund postings`);
    const [b] = await sql('SELECT billing_fund_balance($1) AS b', [ctx.deposit]);
    assert(money(b.b) === 0, `deposit after refund ${b.b}`);
  });

  await step('Package: covered charges billed at no cost up to the allowance; exclusions and extras billed', async () => {
    const code = `PKG-${tag}`;
    const created = await call('POST', '/finance/packages', admin, {
      code, name: `Day care ${tag}`, price: 1500, provenance: 'E2E fixture: hospital package sheet v1',
      rules: [{ rule: 'include', category: 'Lab', allowanceQuantity: 1 }, { rule: 'include', category: 'Consultation' },
        { rule: 'include', category: 'Procedure' }, { rule: 'exclude', category: 'Procedure' }],
    });
    assert(created.status === 201, `package ${short(created)}`);
    // Two-person rule (0150): the author cannot activate; another administrator does.
    assert((await call('POST', `/finance/packages/versions/${created.data.data.version.id}/activate`, admin, {})).status === 403, 'author activated own package');
    assert((await call('POST', `/finance/packages/versions/${created.data.data.version.id}/activate`, superAdmin, {})).status === 200, 'activate');
    const pid = await newPatient('Finance Package');
    const enc = await visit(pid, ['Haemoglobin', 'Blood sugar']);
    await finalize(enc);
    const acc = await account(`encounterId=${enc}`);
    const ap = await call('POST', `/finance/accounts/${acc.id}/packages`, desk, { packageCode: code });
    assert(ap.status === 201, `apply ${short(ap)}`);
    assert((await call('POST', `/finance/accounts/${acc.id}/packages`, desk, { packageCode: code })).status === 409, 'applied twice');
    const proc = await call('POST', `/finance/accounts/${acc.id}/charges`, admin, { category: 'Procedure', description: 'Nebulisation', unitPrice: 300, reason: 'Excluded from the day-care package' });
    assert(proc.status === 201, `procedure ${short(proc)}`);
    const draft = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, desk, {});
    const lines = draft.data.data.lines;
    const covered = lines.filter((l) => l.account_package_id);
    const labsBilled = lines.filter((l) => l.category === 'Lab' && !l.account_package_id);
    assert(covered.length === 2 && covered.every((l) => Number(l.amount) === 0 && Number(l.list_amount) > 0), `covered ${JSON.stringify(covered)}`);
    assert(labsBilled.length === 1 && Number(labsBilled[0].amount) > 0, 'second lab test not billed beyond the allowance');
    assert(lines.some((l) => l.category === 'Package' && Number(l.amount) === 1500), 'package price not billed');
    assert(lines.some((l) => l.category === 'Procedure' && Number(l.amount) === 300 && !l.account_package_id), 'excluded procedure not billed');
    assert(money(draft.data.data.subtotal) === money(1500 + Number(labsBilled[0].amount) + 300), `subtotal ${draft.data.data.subtotal}`);
  });

  await step('Payer split, claim, partial denial, remittance; the denial is passed to the patient', async () => {
    const payer = await call('POST', '/finance/payers', admin, { code: `INS-${tag}`, name: `E2E Insurer ${tag}`, kind: 'insurer' });
    assert(payer.status === 201, `payer ${short(payer)}`);
    const pid = await newPatient('Finance Insured');
    const cov = await call('POST', '/finance/coverages', desk, { patientId: pid, payerId: payer.data.data.id, policyNumber: `POL${tag}`, memberId: `M${tag}`, validFrom: '2026-01-01', validTo: '2027-12-31' });
    assert(cov.status === 201, `coverage ${short(cov)}`);
    assert((await call('POST', `/finance/coverages/${cov.data.data.id}/eligibility`, desk, { outcome: 'Eligible', responseReference: `EL${tag}` })).status === 201, 'eligibility');
    const enc = await visit(pid, ['Liver function test', 'Kidney function test']);
    await finalize(enc);
    const acc = await account(`encounterId=${enc}`);
    const pa = await call('POST', `/finance/accounts/${acc.id}/preauthorizations`, desk, { coverageId: cov.data.data.id, requestedAmount: 1000 });
    assert(pa.status === 201, `preauth ${short(pa)}`);
    const partial = await call('POST', `/finance/preauthorizations/${pa.data.data.id}/decision`, desk, { status: 'PartiallyApproved', approvedAmount: 250, payerReference: `PA${tag}` });
    assert(partial.status === 200 && partial.data.data.revision === 2, `decision ${short(partial)}`);
    assert((await call('PUT', `/finance/accounts/${acc.id}/payer`, desk, { coverageId: cov.data.data.id, preauthId: pa.data.data.id, copayPercent: 10 })).status === 200, 'payer');
    const draft = await call('POST', `/finance/accounts/${acc.id}/invoices/draft`, desk, {});
    const total = money(draft.data.data.total);
    // The payer pays 90%, capped by the 250 approved; the patient pays the rest.
    const payerShare = Math.min(250, money(total * 0.9));
    assert(money(draft.data.data.payer_amount) === payerShare && money(draft.data.data.patient_amount) === money(total - payerShare), `split ${short(draft)}`);
    const inv = await call('POST', `/finance/invoices/${draft.data.data.id}/issue`, desk, { revision: draft.data.data.revision });
    assert(inv.status === 200, `issue ${short(inv)}`);
    const claim = await call('POST', `/finance/invoices/${inv.data.data.id}/claim`, desk, {});
    assert(claim.status === 201 && money(claim.data.data.claimed_amount) === payerShare, `claim ${short(claim)}`);
    assert((await call('POST', `/finance/invoices/${inv.data.data.id}/claim`, desk, {})).status === 409, 'second claim');
    const early = await call('POST', `/finance/claims/${claim.data.data.id}/remittances`, desk, { remittanceReference: `R0${tag}`, amount: 10 });
    assert(early.status === 409, `remittance before adjudication ${short(early)}`);
    assert((await call('POST', `/finance/claims/${claim.data.data.id}/submit`, desk, { payerReference: `CL${tag}` })).status === 200, 'submit');
    assert((await call('POST', `/finance/claims/${claim.data.data.id}/acknowledge`, desk, {})).status === 200, 'ack');
    const detail = await call('GET', `/finance/claims/${claim.data.data.id}`, desk);
    const [l1, ...rest] = detail.data.data.lines;
    const deny = money(Number(l1.claimed_amount) / 2);
    const adj = await call('POST', `/finance/claims/${claim.data.data.id}/adjudication`, desk, { lines: [
      { claimLineId: l1.id, approvedAmount: money(Number(l1.claimed_amount) - deny), denialCode: 'NC-12', denialReason: 'Not covered under plan' },
      ...rest.map((l) => ({ claimLineId: l.id, approvedAmount: Number(l.claimed_amount) })),
    ] });
    assert(adj.status === 200 && money(adj.data.data.denied_amount) === deny, `adjudication ${short(adj)}`);
    const approved = money(adj.data.data.approved_amount);
    const tooMuch = await call('POST', `/finance/claims/${claim.data.data.id}/remittances`, desk, { remittanceReference: `R1${tag}`, amount: approved + 1 });
    assert(tooMuch.status === 400, `remittance above approval ${short(tooMuch)}`);
    const rem = await call('POST', `/finance/claims/${claim.data.data.id}/remittances`, desk, { remittanceReference: `R1${tag}`, amount: approved });
    assert(rem.status === 201, `remittance ${short(rem)}`);
    const dupRem = await call('POST', `/finance/claims/${claim.data.data.id}/remittances`, desk, { remittanceReference: `R1${tag}`, amount: 1 });
    assert(dupRem.status === 409, `duplicate remittance ${short(dupRem)}`);
    const denials = await call('GET', '/finance/denials?status=Open', desk);
    const d = denials.data.data.find((x) => x.claim_id === claim.data.data.id);
    assert(d && money(d.amount) === deny, 'denial not on the worklist');
    const before = money((await sql('SELECT billing_invoice_patient_due($1) AS d', [inv.data.data.id]))[0].d);
    assert((await call('POST', `/finance/denials/${d.id}/resolve`, desk, { action: 'transfer', note: 'Patient agreed to pay' })).status === 403, 'desk closed a denial');
    const moved = await call('POST', `/finance/denials/${d.id}/resolve`, admin, { action: 'transfer', note: 'Patient agreed to pay the uncovered part' });
    assert(moved.status === 200 && moved.data.data.status === 'TransferredToPatient', `transfer ${short(moved)}`);
    const after = money((await sql('SELECT billing_invoice_patient_due($1) AS d', [inv.data.data.id]))[0].d);
    assert(after === money(before + deny), `patient due ${before} -> ${after}`);
    const [c] = await sql('SELECT status FROM hms_claims WHERE id = $1', [claim.data.data.id]);
    assert(c.status === 'Settled', `claim ${c.status}`);
  });

  await step('Retries never double-post: re-issuing, re-voiding and reposting a source are refused', async () => {
    const reissue = await call('POST', `/finance/invoices/${ctx.opdInvoice.id}/issue`, desk, {});
    assert(reissue.status === 409, `re-issue ${short(reissue)}`);
    const voidPaid = await call('POST', `/finance/invoices/${ctx.opdInvoice.id}/void`, admin, { reason: 'Testing void of a paid invoice' });
    assert(voidPaid.status === 409, `void of a paid invoice ${short(voidPaid)}`);
    const dupSources = await sql('SELECT source_type, source_key, count(*) FROM hms_journal_entries GROUP BY 1, 2 HAVING count(*) > 1');
    assert(dupSources.length === 0, `sources posted twice ${JSON.stringify(dupSources)}`);
    const twiceBilled = await sql(`SELECT charge_event_id FROM hms_invoice_lines l JOIN hms_invoices i ON i.id = l.invoice_id
      WHERE NOT l.released AND i.status <> 'Draft' GROUP BY 1 HAVING count(*) > 1`);
    assert(twiceBilled.length === 0, 'a charge is on two invoices');
  });

  await step('Roles: clinicians cannot take money; nurses see only inpatient accounts; only admins approve credits', async () => {
    assert((await call('POST', '/finance/payments', doctor, { invoiceId: ctx.opdInvoice.id, amount: 1, method: 'Cash' })).status === 403, 'doctor took a payment');
    assert((await call('GET', `/finance/accounts/${ctx.opdAccount}`, nurse)).status === 403, 'nurse opened an OPD account');
    assert((await call('GET', `/finance/accounts/${ctx.ipdAccount}`, nurse)).status === 200, 'nurse could not open an inpatient account');
    assert((await call('POST', `/finance/invoices/${ctx.opdInvoice.id}/notes`, desk, { kind: 'credit', reason: 'Not allowed here', lines: [{ category: 'Service', description: 'x', amount: 1 }] })).status === 403, 'desk raised a credit note');
    assert((await call('POST', '/finance/reconciliation/run', desk, {})).status === 403, 'desk ran reconciliation');
  });

  await step('Cash drawer: the count is compared with receipts and refunds; a difference needs a note and opens an exception', async () => {
    const cur = await call('GET', '/finance/cash-sessions/current', desk);
    assert(cur.status === 200 && cur.data.data.id, `drawer ${short(cur)}`);
    const expected = money(cur.data.data.expected_now);
    const noNote = await call('POST', `/finance/cash-sessions/${cur.data.data.id}/close`, desk, { countedCash: expected - 10 });
    assert(noNote.status === 400 && noNote.data.code === 'VARIANCE_NOTE_REQUIRED', `close without note ${short(noNote)}`);
    const closed = await call('POST', `/finance/cash-sessions/${cur.data.data.id}/close`, desk, { countedCash: expected - 10, note: 'Short by ten; under review' });
    assert(closed.status === 200 && money(closed.data.data.variance) === -10, `close ${short(closed)}`);
    const ex = await call('GET', '/finance/reconciliation/exceptions?status=Open', admin);
    assert(ex.data.data.some((e) => e.kind === 'cash_variance' && e.subject_key === cur.data.data.id), 'no exception for the variance');
  });

  await step('Reconciliation: journal, deposits, credits, receivables and receipts agree', async () => {
    const run = await call('POST', '/finance/reconciliation/run', admin, {});
    assert(run.status === 200, `run ${short(run)}`);
    const bad = run.data.data.comparisons.filter((c) => !c.ok);
    assert(bad.length === 0, `does not reconcile: ${JSON.stringify(bad)}`);
    assert(await journalBalanced(), 'journal does not balance');
  });

  done();
})();
