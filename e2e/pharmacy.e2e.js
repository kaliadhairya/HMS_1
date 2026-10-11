// Pharmacy workflow: medicine master -> supplier -> goods receipt (two batches) -> rename -> dispense a finalized
// prescription (one catalogued line, one free-text line that is not in the catalogue) -> OTC sales -> returns and
// expiry actions -> reports -> dashboard alerts. Key actions go through the UI as the pharmacist; outcomes are
// checked in the database.
// Run: cd e2e && NODE_PATH=$(npm root -g) node pharmacy.e2e.js
const { chromium, BASE, api, apiLogin, sql, browserAs, runner, assert, stamp } = require('./helpers');

const { step, done } = runner('Pharmacy workflow');

const isoDay = (offset) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + offset); return d.toISOString().slice(0, 10); };
const num = (v) => Number(v || 0);
const escapeRe = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Poll until fn() is truthy (UI lists update after a debounce or a refetch).
async function until(fn, message, timeout = 10000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error(message);
    await new Promise((r) => setTimeout(r, 250));
  }
}

(async () => {
  const s = stamp();
  const ctx = {
    s,
    medName: `E2E Ondansetron ${s}`,
    renamed: `E2E Ondansetron MD ${s}`,
    supplierName: `E2E Pharma Supplies ${s}`,
    patientName: `E2E Pharm ${s}`,
    freeText: `E2E Kadha ${s} (home remedy)`,
    invoice: `INV/E2E/${s}`,
    batchA: `E2E-A-${s}`, // expires in 20 days: dispensed first (FEFO), shows in expiry alerts
    batchB: `E2E-B-${s}`, // expires in about 13 months
    expiryA: isoDay(20),
    expiryB: isoDay(400),
  };
  const browser = await chromium.launch();
  let session; // one signed-in pharmacist browser for the UI steps
  const ui = async (fn) => {
    const before = session.errors.length;
    await fn(session.page);
    const fresh = session.errors.slice(before);
    assert(fresh.length === 0, `page errors: ${fresh.join(' | ')}`);
  };
  const batches = () => sql('SELECT id, batch_number, quantity, mrp, purchase_rate, supplier_id, expiry_date::text AS expiry FROM hms_medicine_batches WHERE medicine_id = $1 ORDER BY id', [ctx.medicineId]);
  const batchQty = async () => Object.fromEntries((await batches()).map((b) => [b.batch_number, b.quantity]));

  try {
    await step('Setup: pharmacist signs in; patient registered (API)', async () => {
      session = await browserAs(browser, 'pharmacist');
      const rec = await apiLogin('receptionist');
      const phone = `7${String(Date.now()).slice(-9)}`;
      const p = await api('POST', '/patients/hms', {
        token: rec,
        body: {
          name: ctx.patientName, first_name: 'E2E', last_name: `Pharm ${s}`, age: 52, gender: 'Male',
          patientType: 'other', opdIndoor: 'OPD', testDate: isoDay(0), phoneNumber: phone,
        },
      });
      assert(p.status === 201, `patient create ${p.status} ${JSON.stringify(p.data).slice(0, 200)}`);
      ctx.patientId = p.data.data?.id || p.data.patient?.id;
      const [row] = await sql('SELECT uhid FROM hms_patients WHERE id = $1', [ctx.patientId]);
      ctx.uhid = row.uhid;
    });

    await step('Medicine master: add a medicine through the form; search finds it', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/medicines`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Add medicine' }).first().click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Generic name').fill(ctx.medName);
      await dlg.getByLabel('Category').selectOption('Other');
      await dlg.getByLabel('Formulation').selectOption('Tablet');
      await dlg.getByLabel('Strength').fill('4');
      await dlg.getByLabel('Unit', { exact: true }).selectOption('mg');
      await dlg.getByLabel('Sale unit').selectOption('Strip');
      await dlg.getByLabel('GST rate (%)').fill('12');
      await dlg.getByRole('button', { name: 'Add medicine' }).click();
      await page.getByText('Medicine added').waitFor({ timeout: 10000 });
      const rows = await sql('SELECT id, generic_name, formulation, strength, strength_unit, gst_rate, is_active FROM hms_medicines WHERE generic_name = $1', [ctx.medName]);
      assert(rows.length === 1, `expected 1 medicine row, got ${rows.length}`);
      assert(rows[0].formulation === 'Tablet' && rows[0].strength === '4' && rows[0].gst_rate === 12, `saved ${JSON.stringify(rows[0])}`);
      ctx.medicineId = rows[0].id;
      const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM hms_medicine_batches WHERE medicine_id = $1', [ctx.medicineId]);
      assert(n === 0, 'a medicine added without opening stock must have no batches');

      await page.getByRole('textbox', { name: 'Search medicines' }).fill(`Ondansetron ${s}`);
      await page.locator('tbody tr', { hasText: ctx.medName }).waitFor({ timeout: 10000 });
      await until(async () => (await page.locator('tbody tr').count()) === 1, 'search should find exactly the new medicine');
    }));

    await step('Supplier: add a supplier through the form', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/suppliers`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Add supplier' }).first().click();
      const dlg = page.getByRole('dialog');
      await dlg.getByLabel('Supplier name').fill(ctx.supplierName);
      await dlg.getByLabel('Contact person').fill('Asha Verma');
      await dlg.getByLabel('Phone').fill('9876501234');
      await dlg.getByLabel('Email').fill(`supplies${s}@example.com`);
      await dlg.getByLabel('GSTIN').fill('27abcde1234f1z5');
      await dlg.getByRole('button', { name: 'Add supplier' }).click();
      await page.getByText('Supplier added').waitFor({ timeout: 10000 });
      const rows = await sql('SELECT id, supplier_number, phone, gstin, is_active FROM hms_suppliers WHERE name = $1', [ctx.supplierName]);
      assert(rows.length === 1, `expected 1 supplier, got ${rows.length}`);
      assert(rows[0].supplier_number === `SUP-${String(rows[0].id).padStart(3, '0')}`, `supplier number ${rows[0].supplier_number}`);
      assert(rows[0].gstin === '27ABCDE1234F1Z5' && rows[0].is_active === 1, `saved ${JSON.stringify(rows[0])}`);
      ctx.supplierId = rows[0].id;
      await page.getByRole('textbox', { name: 'Search suppliers' }).fill(ctx.supplierName);
      await page.locator('tbody tr', { hasText: ctx.supplierName }).waitFor({ timeout: 10000 });
    }));

    await step('GRN: receive two batches (batch, expiry, qty, rate, MRP) by URL', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/grn`, { waitUntil: 'networkidle' });
      const supplier = page.getByLabel('Supplier', { exact: true });
      await supplier.locator('option', { hasText: ctx.supplierName }).waitFor({ state: 'attached', timeout: 10000 });
      await supplier.selectOption({ label: ctx.supplierName });
      await page.getByLabel('Invoice number').fill(ctx.invoice);
      const fillRow = async (n, b) => {
        await page.getByLabel(`Medicine for row ${n}`).fill(ctx.medName);
        await page.getByRole('listbox', { name: 'Matching medicines' }).getByRole('option', { name: new RegExp(escapeRe(ctx.medName)) }).click();
        await page.getByLabel(`Batch number for row ${n}`).fill(b.batch);
        await page.getByLabel(`Expiry date for row ${n}`).fill(b.expiry);
        await page.getByLabel(`Quantity for row ${n}`).fill(String(b.qty));
        await page.getByLabel(`Purchase rate for row ${n}`).fill(String(b.rate));
        await page.getByLabel(`MRP for row ${n}`).fill(String(b.mrp));
        await page.getByLabel(`GST rate for row ${n}`).selectOption('12');
      };
      await fillRow(1, { batch: ctx.batchA, expiry: ctx.expiryA, qty: 6, rate: 8, mrp: 12.5 });
      await page.getByRole('button', { name: 'Add row' }).click();
      await fillRow(2, { batch: ctx.batchB, expiry: ctx.expiryB, qty: 10, rate: 8.5, mrp: 13 });
      await page.getByRole('button', { name: 'Generate GRN' }).click();
      await page.getByText(/GRN recorded against purchase order/).waitFor({ timeout: 15000 });

      const [po] = await sql('SELECT id, supplier_id, status, total_amount, gst_amount FROM hms_purchase_orders WHERE invoice_number = $1', [ctx.invoice]);
      assert(po, `no purchase order stored with invoice number ${ctx.invoice} (escaped?)`);
      assert(po.supplier_id === ctx.supplierId && po.status === 'Received', `PO ${JSON.stringify(po)}`);
      // 6 x 8 + 10 x 8.5 = 133.00, GST 12% = 15.96
      assert(num(po.total_amount) === 148.96 && num(po.gst_amount) === 15.96, `PO totals ${po.total_amount}/${po.gst_amount}`);
      ctx.poId = po.id;
      const bs = await batches();
      assert(bs.length === 2, `expected 2 batches, got ${bs.length}`);
      const a = bs.find((b) => b.batch_number === ctx.batchA);
      const b = bs.find((x) => x.batch_number === ctx.batchB);
      assert(a && a.quantity === 6 && num(a.mrp) === 12.5 && num(a.purchase_rate) === 8 && a.expiry === ctx.expiryA && a.supplier_id === ctx.supplierId, `batch A ${JSON.stringify(a)}`);
      assert(b && b.quantity === 10 && num(b.mrp) === 13 && num(b.purchase_rate) === 8.5 && b.expiry === ctx.expiryB, `batch B ${JSON.stringify(b)}`);
      ctx.batchAId = a.id; ctx.batchBId = b.id;
      const ledger = await sql("SELECT batch_id, quantity FROM hms_stock_ledger WHERE medicine_id = $1 AND transaction_type = 'IN' AND reference_type = 'GRN' AND reference_id = $2 ORDER BY id", [ctx.medicineId, ctx.poId]);
      assert(ledger.length === 2 && ledger[0].quantity === 6 && ledger[1].quantity === 10, `ledger ${JSON.stringify(ledger)}`);
    }));

    await step('Stock page: total 16 across 2 batches; batch list and ledger show the receipt', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/stock`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: 'Search stock' }).fill(ctx.medName);
      const row = page.locator('tbody tr', { hasText: ctx.medName });
      await row.waitFor({ timeout: 10000 });
      const cells = await row.locator('td').allInnerTexts();
      assert(cells[1].trim() === '2', `batches cell ${cells[1]}`);
      assert(/^16\b/.test(cells[2].trim()), `in-stock cell ${cells[2]}`);
      await row.click();
      const dlg = page.getByRole('dialog', { name: new RegExp(`Batches of ${escapeRe(ctx.medName)}`) });
      await dlg.getByText(ctx.batchA).waitFor();
      await dlg.getByText(ctx.batchB).waitFor();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: `Actions for ${ctx.medName}` }).click();
      await page.getByRole('menuitem', { name: 'Stock ledger' }).click();
      const led = page.getByRole('dialog', { name: 'Stock ledger' });
      await led.getByText(`GRN #${ctx.poId}`).first().waitFor();
      assert(await led.getByText(`GRN #${ctx.poId}`).count() === 2, 'ledger should list both GRN receipts');
      await page.keyboard.press('Escape');
    }));

    await step('Medicine master: rename only leaves stock, prices and ledger untouched; search finds the new name', () => ui(async (page) => {
      const before = await batches();
      const [{ n: ledgerBefore }] = await sql('SELECT COUNT(*)::int AS n FROM hms_stock_ledger WHERE medicine_id = $1', [ctx.medicineId]);
      await page.goto(`${BASE}/pharmacy/medicines`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: 'Search medicines' }).fill(ctx.medName);
      await page.locator('tbody tr', { hasText: ctx.medName }).waitFor({ timeout: 10000 });
      await page.getByRole('button', { name: `Actions for ${ctx.medName}` }).click();
      await page.getByRole('menuitem', { name: 'Edit medicine' }).click();
      const dlg = page.getByRole('dialog');
      assert(await dlg.getByLabel('Total quantity').inputValue() === '16', 'edit form should show the total stock (16)');
      await dlg.getByLabel('Generic name').fill(ctx.renamed);
      await dlg.getByRole('button', { name: 'Save changes' }).click();
      await page.getByText('Medicine updated').waitFor({ timeout: 10000 });
      const [m] = await sql('SELECT generic_name, gst_rate FROM hms_medicines WHERE id = $1', [ctx.medicineId]);
      assert(m.generic_name === ctx.renamed && m.gst_rate === 12, `after rename ${JSON.stringify(m)}`);
      const after = await batches();
      assert(JSON.stringify(after) === JSON.stringify(before), `batches changed on rename: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      const [{ n: ledgerAfter }] = await sql('SELECT COUNT(*)::int AS n FROM hms_stock_ledger WHERE medicine_id = $1', [ctx.medicineId]);
      assert(ledgerAfter === ledgerBefore, 'rename wrote stock ledger rows');
      await page.getByRole('textbox', { name: 'Search medicines' }).fill(`Ondansetron MD ${s}`);
      await page.locator('tbody tr', { hasText: ctx.renamed }).waitFor({ timeout: 10000 });
      await page.getByRole('textbox', { name: 'Search medicines' }).fill(`E2E Ondansetron ${s}`);
      await page.getByText('No medicines match').waitFor({ timeout: 10000 });
      ctx.medName = ctx.renamed;
    }));

    await step('Setup: doctor finalizes a prescription with the new medicine and a free-text medicine (API)', async () => {
      const doc = await apiLogin('doctor');
      const ph = await apiLogin('pharmacist');
      const e = await api('POST', '/hms/encounters', { token: doc, body: { patient_id: ctx.patientId, chief_complaint: 'Nausea (E2E pharmacy)' } });
      assert(e.status === 201, `encounter create ${e.status} ${JSON.stringify(e.data).slice(0, 200)}`);
      ctx.encounterId = e.data.id;
      const pr = await api('POST', '/hms/prescriptions', { token: doc, body: { encounter_id: ctx.encounterId, patient_id: ctx.patientId } });
      assert(pr.status === 200 && pr.data.id, `prescription create ${pr.status}`);
      ctx.rxId = pr.data.id;
      const it = await api('PUT', `/hms/prescriptions/${ctx.rxId}/items`, {
        token: doc,
        body: {
          items: [
            { medicine_name: ctx.medName, generic_name: ctx.medName, dose: '4', dose_unit: 'mg', frequency: 'TDS', duration: 1, route: 'Oral' },
            // Free text, not in the catalogue (no generic_name sent, as when the doctor types a name).
            { medicine_name: ctx.freeText, dose: '10', dose_unit: 'ml', frequency: 'BD', duration: 5, route: 'Oral' },
          ],
        },
      });
      assert(it.status === 200 && it.data.length === 2, `items ${it.status} ${JSON.stringify(it.data).slice(0, 200)}`);
      const f = await api('PATCH', `/hms/encounters/${ctx.encounterId}/finalize`, { token: doc });
      assert(f.status === 200, `finalize ${f.status} ${JSON.stringify(f.data).slice(0, 200)}`);
      const [rx] = await sql('SELECT status FROM hms_prescriptions WHERE id = $1', [ctx.rxId]);
      assert(rx.status === 'Finalized', `prescription status ${rx.status}`);
      const read = await api('GET', `/hms/prescriptions/${ctx.rxId}`, { token: ph });
      const lines = read.data.data.items;
      ctx.lineMed = lines.find((l) => l.medicine_name === ctx.medName);
      ctx.lineFree = lines.find((l) => l.medicine_name === ctx.freeText);
      assert(ctx.lineMed && Number(ctx.lineMed.medicine_id) === Number(ctx.medicineId), `catalogued line not linked: ${JSON.stringify(ctx.lineMed)}`);
      assert(ctx.lineFree && ctx.lineFree.medicine_id === null, `free-text line should have medicine_id null: ${JSON.stringify(ctx.lineFree)}`);
      const q = await api('GET', '/pharmacy/dispense-queue', { token: ph });
      assert(q.data.data.some((r) => Number(r.PRESCRIPTION_ID) === Number(ctx.rxId)), 'finalized prescription missing from the dispense queue');
    });

    await step('Dispense: FEFO batch, partial dispense with the free-text line marked not dispensed, slip shown', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/dispense`, { waitUntil: 'networkidle' });
      const queue = page.getByRole('region', { name: 'Pending prescriptions' });
      await queue.getByRole('button', { name: new RegExp(escapeRe(ctx.patientName)) }).click();
      const batchSel = page.getByLabel(`Batch for ${ctx.medName}`);
      await batchSel.waitFor({ timeout: 10000 });
      assert(await batchSel.inputValue() === String(ctx.batchAId), `FEFO should preselect batch ${ctx.batchA} (earliest expiry)`);
      assert(await page.getByLabel(`Batch for ${ctx.freeText}`).isDisabled(), 'free-text line should have no batch to pick');
      await page.getByLabel(`Quantity to dispense for ${ctx.medName}`).fill('3');

      // Without marking the uncatalogued line, the page explains what to do instead of failing.
      await page.getByRole('button', { name: 'Confirm dispense' }).click();
      await page.getByText(`Select a batch for ${ctx.freeText}, or mark it as not dispensed`).waitFor({ timeout: 5000 });
      assert((await batchQty())[ctx.batchA] === 6, 'nothing may be dispensed before the pharmacist confirms');

      await page.getByLabel(`Not dispensed: ${ctx.freeText}`).check();
      assert(await page.getByLabel(`Reason ${ctx.freeText} is not dispensed`).inputValue() === 'Not in catalogue', 'reason should default to not in catalogue');
      await page.getByRole('button', { name: 'Confirm dispense' }).click();
      const slip = page.getByRole('region', { name: 'Dispensing slip' });
      await slip.waitFor({ timeout: 15000 });
      const slipText = await slip.innerText();
      assert(slipText.includes(ctx.medName) && slipText.includes(ctx.batchA) && slipText.includes('₹37.50'), `slip: ${slipText.slice(0, 400)}`);
      assert(/Not dispensed/.test(slipText) && slipText.includes(ctx.freeText), 'slip should list the medicine that was not dispensed');
      assert(!(await queue.getByRole('button', { name: new RegExp(escapeRe(ctx.patientName)) }).count()), 'prescription still in the queue after dispensing');
    }));

    await step('Dispense: stock, dispensing record, bill items at MRP, not-dispensed record (DB)', async () => {
      const q = await batchQty();
      assert(q[ctx.batchA] === 3 && q[ctx.batchB] === 10, `batches after dispense ${JSON.stringify(q)}`);
      const [rx] = await sql('SELECT status FROM hms_prescriptions WHERE id = $1', [ctx.rxId]);
      assert(rx.status === 'Dispensed', `prescription status ${rx.status}`);
      const recs = await sql('SELECT id, total_amount, bill_id, patient_id FROM hms_dispensing_records WHERE prescription_id = $1', [ctx.rxId]);
      assert(recs.length === 1, `dispensing records ${recs.length}`);
      const rec = recs[0];
      assert(num(rec.total_amount) === 37.5 && rec.patient_id === ctx.patientId, `record ${JSON.stringify(rec)}`);
      ctx.dispRecordId = rec.id; ctx.billId = rec.bill_id;
      const items = await sql('SELECT medicine_id, batch_id, quantity, rate, amount FROM hms_dispensing_items WHERE dispensing_record_id = $1', [rec.id]);
      assert(items.length === 1 && items[0].batch_id === ctx.batchAId && items[0].quantity === 3 && num(items[0].rate) === 12.5 && num(items[0].amount) === 37.5, `dispensing items ${JSON.stringify(items)}`);
      const billItems = await sql("SELECT item_name, quantity, rate, amount FROM hms_bill_items WHERE bill_id = $1 AND item_type = 'Medicine'", [rec.bill_id]);
      assert(billItems.length === 1 && billItems[0].item_name === ctx.medName && num(billItems[0].rate) === 12.5 && num(billItems[0].amount) === 37.5, `bill items ${JSON.stringify(billItems)}`);
      const [bill] = await sql('SELECT encounter_id, status, total_amount, net_payable FROM hms_bills WHERE id = $1', [rec.bill_id]);
      const [{ sum }] = await sql('SELECT COALESCE(SUM(amount), 0) AS sum FROM hms_bill_items WHERE bill_id = $1', [rec.bill_id]);
      assert(bill.encounter_id === ctx.encounterId && bill.status === 'Pending' && num(bill.total_amount) === num(sum), `bill ${JSON.stringify(bill)} items sum ${sum}`);
      const ledger = await sql("SELECT quantity FROM hms_stock_ledger WHERE reference_type = 'DISPENSING' AND reference_id = $1 AND transaction_type = 'OUT'", [rec.id]);
      assert(ledger.length === 1 && ledger[0].quantity === 3, `ledger ${JSON.stringify(ledger)}`);
      const [audit] = await sql("SELECT new_value FROM hms_audit_logs WHERE module = 'pharmacy' AND action = 'DISPENSE' AND record_id = $1", [rec.id]);
      const nd = JSON.parse(audit?.new_value || '{}').notDispensed || [];
      assert(nd.length === 1 && nd[0].medicineName === ctx.freeText && nd[0].reason === 'Not in catalogue', `not-dispensed record ${audit?.new_value}`);
    });

    await step('Dispense: a second dispense of the same prescription is refused and takes no stock', async () => {
      const ph = await apiLogin('pharmacist');
      const r = await api('POST', '/pharmacy/dispense', {
        token: ph,
        body: { prescriptionId: ctx.rxId, items: [{ prescriptionItemId: ctx.lineMed.id, medicineId: ctx.medicineId, batchId: ctx.batchAId, quantity: 1 }] },
      });
      assert(r.status === 409, `second dispense answered ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
      const legacy = await api('POST', '/pharmacist_lms/dispense', {
        token: ph,
        body: { prescriptionId: ctx.rxId, items: [{ medicineId: ctx.medicineId, batchId: ctx.batchAId, quantity: 1, rate: 0, amount: 0 }] },
      });
      assert(legacy.status === 409, `legacy dispense answered ${legacy.status}`);
      assert((await batchQty())[ctx.batchA] === 3, 'stock changed on a refused dispense');
      const [{ n }] = await sql('SELECT COUNT(*)::int AS n FROM hms_dispensing_records WHERE prescription_id = $1', [ctx.rxId]);
      assert(n === 1, `dispensing records after retry: ${n}`);
      const q = await api('GET', '/pharmacy/dispense-queue', { token: ph });
      assert(!q.data.data.some((row) => Number(row.PRESCRIPTION_ID) === Number(ctx.rxId)), 'dispensed prescription is still queued');
    });

    await step('Alerts: the dashboard expiry tile counts the new batch expiring in 20 days', () => ui(async (page) => {
      const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM hms_medicine_batches
        WHERE expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30 AND quantity > 0`);
      const [{ mine }] = await sql(`SELECT COUNT(*)::int AS mine FROM hms_medicine_batches
        WHERE id = $1 AND expiry_date > CURRENT_DATE AND expiry_date <= CURRENT_DATE + 30 AND quantity > 0`, [ctx.batchAId]);
      assert(mine === 1, 'batch A should count as expiring within 30 days');
      await page.goto(`${BASE}/pharmacist/dashboard`, { waitUntil: 'networkidle' });
      const tile = page.getByRole('button', { name: /^Batches expiring in 30 days: \d+/ });
      await tile.waitFor({ timeout: 10000 });
      const label = await tile.getAttribute('aria-label');
      assert(label.startsWith(`Batches expiring in 30 days: ${n}.`), `dashboard tile "${label}" vs ${n} batches in the database`);
    }));

    await step('OTC: walk-in sale of 2 units (FEFO batch) saves the bill with GST and takes stock', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/otc`, { waitUntil: 'networkidle' });
      await page.getByLabel('Medicine for row 1').fill(ctx.medName);
      await page.getByRole('listbox', { name: 'Matching medicines' }).getByRole('option', { name: new RegExp(escapeRe(ctx.medName)) }).click();
      const batchSel = page.getByLabel('Batch for row 1');
      await until(async () => (await batchSel.inputValue()) === String(ctx.batchAId), 'OTC should preselect the earliest-expiry batch');
      await page.getByLabel('Quantity for row 1').fill('2');
      await page.getByText('₹28.00').first().waitFor(); // 2 x 12.50 + 12% GST
      await page.getByRole('button', { name: 'Complete sale' }).click();
      await page.getByText('Sale completed').waitFor({ timeout: 10000 });
      const receipt = await page.locator('.print-area').innerText();
      const bill = receipt.match(/OTC-\d+/)?.[0];
      assert(bill && receipt.includes('₹28.00') && receipt.includes('₹3.00'), `receipt: ${receipt.slice(0, 300)}`);
      const [sale] = await sql('SELECT id, patient_id, total_amount, payment_mode FROM hms_otc_sales WHERE bill_number = $1', [bill]);
      assert(sale && sale.patient_id === null && num(sale.total_amount) === 28 && sale.payment_mode === 'Cash', `sale ${JSON.stringify(sale)}`);
      const items = await sql('SELECT batch_id, quantity, rate, gst_amount, amount FROM hms_otc_items WHERE otc_sale_id = $1', [sale.id]);
      assert(items.length === 1 && items[0].batch_id === ctx.batchAId && items[0].quantity === 2 && num(items[0].rate) === 12.5 && num(items[0].gst_amount) === 3 && num(items[0].amount) === 28, `items ${JSON.stringify(items)}`);
      const q = await batchQty();
      assert(q[ctx.batchA] === 1 && q[ctx.batchB] === 10, `stock after walk-in sale ${JSON.stringify(q)}`);
    }));

    await step('OTC: sale against the patient UHID links the patient; an unknown UHID is refused clearly', () => ui(async (page) => {
      await page.getByRole('button', { name: 'New sale' }).click();
      await page.getByLabel('Patient UHID (optional)').fill(ctx.uhid);
      await page.getByLabel('Payment mode').selectOption('UPI');
      await page.getByLabel('Medicine for row 1').fill(ctx.medName);
      await page.getByRole('listbox', { name: 'Matching medicines' }).getByRole('option', { name: new RegExp(escapeRe(ctx.medName)) }).click();
      await until(async () => (await page.getByLabel('Batch for row 1').inputValue()) === String(ctx.batchAId), 'batch A still has 1 unit and should be preselected');
      await page.getByLabel('Quantity for row 1').fill('1');
      await page.getByRole('button', { name: 'Complete sale' }).click();
      // The receipt for this sale names the UHID (the walk-in sale's toast may still be on screen).
      await page.locator('.print-area').getByText(ctx.uhid).waitFor({ timeout: 10000 });
      const sales = await until(async () => {
        const rows = await sql('SELECT id, total_amount, payment_mode FROM hms_otc_sales WHERE patient_id = $1', [ctx.patientId]);
        return rows.length ? rows : null;
      }, 'no OTC sale saved against the patient');
      assert(sales.length === 1 && num(sales[0].total_amount) === 14 && sales[0].payment_mode === 'UPI', `patient sale ${JSON.stringify(sales)}`);

      // Unknown UHID: clear message next to the field, nothing saved, no stock taken.
      const [{ n: before }] = await sql('SELECT COUNT(*)::int AS n FROM hms_otc_sales');
      await page.getByRole('button', { name: 'New sale' }).click();
      await page.getByLabel('Patient UHID (optional)').fill('HOSP-1999-999999');
      await page.getByLabel('Medicine for row 1').fill(ctx.medName);
      await page.getByRole('listbox', { name: 'Matching medicines' }).getByRole('option', { name: new RegExp(escapeRe(ctx.medName)) }).click();
      await until(async () => (await page.getByLabel('Batch for row 1').inputValue()) === String(ctx.batchBId), 'batch A is empty, so batch B should be preselected');
      await page.getByRole('button', { name: 'Complete sale' }).click();
      await page.getByRole('alert').filter({ hasText: 'No patient found with UHID HOSP-1999-999999' }).waitFor({ timeout: 10000 });
      const [{ n: after }] = await sql('SELECT COUNT(*)::int AS n FROM hms_otc_sales');
      assert(after === before, 'a sale was saved for an unknown UHID');
      const q = await batchQty();
      assert(q[ctx.batchA] === 0 && q[ctx.batchB] === 10, `stock after OTC sales ${JSON.stringify(q)}`);
    }));

    await step('Returns: patient return (checked against what was issued) and vendor return persist and adjust stock', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/returns`, { waitUntil: 'networkidle' });
      const fillForm = async ({ uhid, batchId, qty, reason }) => {
        const dlg = page.getByRole('dialog');
        if (uhid !== undefined) await dlg.getByLabel('Patient UHID (optional)').fill(uhid);
        await dlg.getByLabel('Medicine').fill(ctx.medName);
        await dlg.getByRole('listbox', { name: 'Matching medicines' }).getByRole('option', { name: new RegExp(escapeRe(ctx.medName)) }).click();
        const sel = dlg.getByLabel('Batch');
        await sel.locator(`option[value="${batchId}"]`).waitFor({ state: 'attached' });
        await sel.selectOption(String(batchId));
        await dlg.getByLabel('Quantity').fill(String(qty));
        await dlg.getByLabel('Reason').fill(reason);
        await dlg.getByRole('button', { name: 'Record return' }).click();
      };
      // The patient received 4 from batch A (3 dispensed + 1 at the counter): 5 is refused.
      await page.getByRole('button', { name: 'Patient return' }).click();
      await fillForm({ uhid: ctx.uhid, batchId: ctx.batchAId, qty: 5, reason: 'Unopened strips returned' });
      await page.getByText(`Only 4 from batch ${ctx.batchA} can be returned for this patient.`).waitFor({ timeout: 10000 });
      assert((await batchQty())[ctx.batchA] === 0, 'refused return changed stock');
      await page.getByRole('dialog').getByLabel('Quantity').fill('3');
      await page.getByRole('dialog').getByRole('button', { name: 'Record return' }).click();
      await page.getByText('Patient return recorded').waitFor({ timeout: 10000 });

      await page.getByRole('button', { name: 'Vendor return' }).click();
      await fillForm({ batchId: ctx.batchBId, qty: 2, reason: 'Damaged packaging' });
      await page.getByText('Vendor return recorded').waitFor({ timeout: 10000 });

      const q = await batchQty();
      assert(q[ctx.batchA] === 3 && q[ctx.batchB] === 8, `stock after returns ${JSON.stringify(q)}`);
      const led = await sql(`SELECT transaction_type, quantity, reference_type, reference_id FROM hms_stock_ledger
        WHERE medicine_id = $1 AND reference_type IN ('Patient Return', 'Vendor Return') ORDER BY id`, [ctx.medicineId]);
      assert(led.length === 2, `return ledger rows ${JSON.stringify(led)}`);
      assert(led[0].transaction_type === 'RETURN' && led[0].quantity === 3 && led[0].reference_id === ctx.patientId, `patient return ${JSON.stringify(led[0])}`);
      assert(led[1].transaction_type === 'DISCARD' && led[1].quantity === 2 && led[1].reference_id === ctx.supplierId, `vendor return ${JSON.stringify(led[1])}`);
      const patientRow = page.locator('tbody tr', { hasText: ctx.uhid });
      await patientRow.waitFor({ timeout: 10000 });
      assert((await patientRow.innerText()).includes('Unopened strips returned'), 'patient return row should show the reason');
      const vendorRow = page.locator('tbody tr', { hasText: ctx.supplierName });
      assert((await vendorRow.innerText()).includes('Damaged packaging'), 'vendor return row should show the reason');
    }));

    await step('Expiry: return to supplier and disposal from the expiry list persist; quarantine is not offered', () => ui(async (page) => {
      await page.goto(`${BASE}/pharmacy/expiry`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: 'Search expiring batches' }).fill(ctx.batchA);
      const row = page.locator('tbody tr', { hasText: ctx.batchA });
      await row.waitFor({ timeout: 10000 });
      assert(!(await page.locator('tbody tr', { hasText: ctx.batchB }).count()), 'batch B does not expire within 30 days');
      const menu = page.getByRole('button', { name: `Actions for ${ctx.medName} batch ${ctx.batchA}` });
      await menu.click();
      assert(!(await page.getByRole('menuitem', { name: 'Quarantine' }).count()), 'quarantine has nowhere to be stored and must not be offered');
      await page.getByRole('menuitem', { name: 'Return to supplier' }).click();
      let dlg = page.getByRole('dialog', { name: 'Return to supplier' });
      await dlg.getByLabel('Quantity to return').fill('1');
      await dlg.getByLabel('Reason').fill('Short expiry, supplier credit note');
      await dlg.getByRole('button', { name: 'Confirm return' }).click();
      await page.getByText('Returned to the supplier. Stock updated.').waitFor({ timeout: 10000 });

      await menu.click();
      await page.getByRole('menuitem', { name: 'Log disposal' }).click();
      dlg = page.getByRole('dialog', { name: 'Log disposal' });
      await dlg.getByLabel('Quantity to dispose of').fill('1');
      await dlg.getByLabel('Reason').fill('Strip damaged, witnessed by store in-charge');
      await dlg.getByRole('button', { name: 'Confirm disposal' }).click();
      await page.getByText('Disposal logged. Stock updated.').waitFor({ timeout: 10000 });
      await until(async () => /\b1\b/.test(await row.locator('td').nth(4).innerText()), 'expiry list should show 1 unit left in batch A');

      const q = await batchQty();
      assert(q[ctx.batchA] === 1 && q[ctx.batchB] === 8, `stock after expiry actions ${JSON.stringify(q)}`);
      const led = await sql(`SELECT sl.reference_type, sl.quantity, sl.reference_id, a.new_value FROM hms_stock_ledger sl
        LEFT JOIN hms_audit_logs a ON a.module = 'pharmacy_stock' AND a.record_id = sl.id
        WHERE sl.batch_id = $1 AND sl.transaction_type = 'DISCARD' ORDER BY sl.id`, [ctx.batchAId]);
      assert(led.length === 2 && led[0].reference_type === 'Vendor Return' && led[0].reference_id === ctx.supplierId && led[1].reference_type === 'Disposal', `ledger ${JSON.stringify(led)}`);
      assert(JSON.parse(led[1].new_value).reason === 'Strip damaged, witnessed by store in-charge', 'disposal reason not recorded');
    }));

    await step('Reports: figures computed from the data (today and 7 days) match the database', () => ui(async (page) => {
      const ph = await apiLogin('pharmacist');
      const r = await api('GET', '/pharmacist_lms/reports?days=7', { token: ph });
      assert(r.status === 200, `reports ${r.status}`);
      const rep = r.data.data;
      const [db] = await sql(`SELECT
          (SELECT COALESCE(SUM(total_amount), 0) FROM hms_dispensing_records WHERE dispensed_at >= CURRENT_DATE - 6) AS disp,
          (SELECT COUNT(*)::int FROM hms_dispensing_records WHERE dispensed_at >= CURRENT_DATE - 6) AS disp_n,
          (SELECT COALESCE(SUM(total_amount), 0) FROM hms_otc_sales WHERE sold_at >= CURRENT_DATE - 6) AS otc,
          (SELECT COUNT(*)::int FROM hms_otc_sales WHERE sold_at >= CURRENT_DATE - 6) AS otc_n,
          (SELECT COALESCE(SUM(quantity * COALESCE(purchase_rate, 0)), 0) FROM hms_medicine_batches WHERE quantity > 0 AND expiry_date >= CURRENT_DATE) AS inv`);
      assert(rep.dispensed.amount === num(db.disp) && rep.dispensed.prescriptions === db.disp_n, `dispensed ${JSON.stringify(rep.dispensed)} vs ${db.disp}/${db.disp_n}`);
      assert(rep.otc.amount === num(db.otc) && rep.otc.sales === db.otc_n, `otc ${JSON.stringify(rep.otc)} vs ${db.otc}/${db.otc_n}`);
      assert(rep.inventoryValue === num(db.inv), `inventory ${rep.inventoryValue} vs ${db.inv}`);
      const today = (await api('GET', '/pharmacist_lms/reports?days=1', { token: ph })).data.data;
      const [t] = await sql(`SELECT
          (SELECT COALESCE(SUM(total_amount), 0) FROM hms_dispensing_records WHERE dispensed_at >= CURRENT_DATE) AS disp,
          (SELECT COALESCE(SUM(total_amount), 0) FROM hms_otc_sales WHERE sold_at >= CURRENT_DATE) AS otc`);
      assert(today.today.dispensedAmount === num(t.disp) && today.today.otcAmount === num(t.otc), `today ${JSON.stringify(today.today)} vs ${t.disp}/${t.otc}`);
      assert(Math.abs(today.dailySales - (num(t.disp) + num(t.otc))) < 0.005, `daily sales ${today.dailySales}`);
      // Top medicines: every entry matches the database, the list is the true top by units, and this medicine's
      // own figures are 6 units / 79.50 (3 dispensed at 12.50 + 3 sold at 12.50 with 12% GST).
      const issued = await sql(`SELECT x.medicine_id AS id, SUM(x.qty)::int AS units, SUM(x.amount) AS amount FROM (
          SELECT di.medicine_id, di.quantity AS qty, di.amount FROM hms_dispensing_items di
          JOIN hms_dispensing_records dr ON dr.id = di.dispensing_record_id WHERE dr.dispensed_at >= CURRENT_DATE - 6
          UNION ALL
          SELECT oi.medicine_id, oi.quantity, oi.amount FROM hms_otc_items oi
          JOIN hms_otc_sales os ON os.id = oi.otc_sale_id WHERE os.sold_at >= CURRENT_DATE - 6) x
        GROUP BY x.medicine_id`);
      const byId = new Map(issued.map((r) => [r.id, r]));
      const mine = byId.get(ctx.medicineId);
      assert(mine && mine.units === 6 && num(mine.amount) === 79.5, `issued for this medicine ${JSON.stringify(mine)}`);
      assert(rep.topMedicines.length === Math.min(10, issued.length), `top list length ${rep.topMedicines.length}`);
      for (const t of rep.topMedicines) {
        const d = byId.get(t.id);
        assert(d && d.units === t.units && num(d.amount) === t.amount, `top entry ${JSON.stringify(t)} vs db ${JSON.stringify(d)}`);
      }
      const cutoff = Math.min(...rep.topMedicines.map((t) => t.units));
      assert(issued.every((r) => rep.topMedicines.some((t) => t.id === r.id) || r.units <= cutoff), 'a medicine with more units is missing from the top list');
      const top = rep.topMedicines.find((m) => m.id === ctx.medicineId);
      assert(top || mine.units <= cutoff, 'this medicine should be in the top list');
      const low = rep.lowStock.find((m) => m.id === ctx.medicineId);
      assert(low && low.stock === 9, `low stock entry ${JSON.stringify(low)}`);
      assert(rep.expiringSoon.some((b) => b.batchId === ctx.batchAId && b.quantity === 1), 'batch A should be listed as expiring soon');

      await page.goto(`${BASE}/pharmacy/reports`, { waitUntil: 'networkidle' });
      await page.getByRole('tab', { name: '7 days' }).click();
      const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      await until(async () => (await page.getByTestId('kpi-dispensed').innerText()) === inr(rep.dispensed.amount), `dispensed KPI should read ${inr(rep.dispensed.amount)}`);
      assert(await page.getByTestId('kpi-otc').innerText() === inr(rep.otc.amount), 'OTC KPI mismatch');
      const topRegion = page.getByRole('region', { name: 'Top medicines' });
      await topRegion.locator('tbody tr').first().waitFor({ timeout: 10000 });
      const topText = await topRegion.innerText();
      for (const t of rep.topMedicines) assert(topText.includes(t.name), `top medicines table is missing ${t.name}`);
      if (top) {
        const topRow = topRegion.locator('tbody tr', { hasText: ctx.medName });
        assert(/\b6\b/.test(await topRow.innerText()) && (await topRow.innerText()).includes('₹79.50'), `top medicines row: ${await topRow.innerText()}`);
      }
      const pos = rep.expiringSoon.findIndex((b) => b.batchId === ctx.batchAId);
      if (pos < 10) await page.getByRole('region', { name: 'Expiring soon' }).getByText(ctx.batchA).waitFor({ timeout: 10000 }); // first table page
    }));

    await step('Alerts: dashboard low-stock and sales tiles and the stock page reflect the medicine now at 9 units', () => ui(async (page) => {
      const [{ n }] = await sql(`SELECT COUNT(*)::int AS n FROM (
          SELECT m.id FROM hms_medicines m LEFT JOIN hms_medicine_batches b ON b.medicine_id = m.id
          WHERE m.is_active = 1 GROUP BY m.id HAVING COALESCE(SUM(b.quantity), 0) <= 10) x`);
      const [mine] = await sql('SELECT COALESCE(SUM(quantity), 0)::int AS q FROM hms_medicine_batches WHERE medicine_id = $1', [ctx.medicineId]);
      assert(mine.q === 9, `medicine stock ${mine.q}`);
      await page.goto(`${BASE}/pharmacist/dashboard`, { waitUntil: 'networkidle' });
      const tile = page.getByRole('button', { name: /^Low stock medicines: \d+/ });
      await tile.waitFor({ timeout: 10000 });
      const label = await tile.getAttribute('aria-label');
      assert(label.startsWith(`Low stock medicines: ${n}.`), `dashboard tile "${label}" vs ${n} low-stock medicines in the database`);
      const [t] = await sql(`SELECT
          (SELECT COALESCE(SUM(total_amount), 0) FROM hms_dispensing_records WHERE dispensed_at >= CURRENT_DATE)
        + (SELECT COALESCE(SUM(total_amount), 0) FROM hms_otc_sales WHERE sold_at >= CURRENT_DATE) AS billed`);
      const expected = `₹${num(t.billed).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
      const sales = page.locator('.kpi', { hasText: 'Sales today' }).locator('.kpi-value');
      await until(async () => (await sales.innerText()) === expected, `Sales today should read ${expected} (billed today incl. GST)`);
      await page.goto(`${BASE}/pharmacy/stock`, { waitUntil: 'networkidle' });
      await page.getByRole('textbox', { name: 'Search stock' }).fill(ctx.medName);
      const row = page.locator('tbody tr', { hasText: ctx.medName });
      await row.waitFor({ timeout: 10000 });
      const text = await row.innerText();
      assert(/\b9\b/.test(text) && text.includes('Low') && text.includes('Expiring'), `stock row should show 9 units, Low and Expiring: ${text}`);
    }));

    // Keep repeated runs from filling the low-stock, expiry and supplier lists with test data.
    await step('Cleanup: dispose of the remaining test stock; deactivate the test medicine, supplier and auto-added free-text entry', async () => {
      const ph = await apiLogin('pharmacist');
      for (const b of await batches()) {
        if (b.quantity > 0) {
          const r = await api('POST', '/pharmacy/return', { token: ph, body: { batchId: b.id, quantity: b.quantity, type: 'discard', reason: 'E2E test cleanup' } });
          assert(r.status === 200, `cleanup disposal ${r.status} ${JSON.stringify(r.data)}`);
        }
      }
      const extra = await sql('SELECT id FROM hms_medicines WHERE generic_name = $1 AND is_active = 1', [ctx.freeText]);
      for (const id of [ctx.medicineId, ...extra.map((m) => m.id)].filter(Boolean)) {
        const r = await api('PATCH', `/medicines/${id}/toggle`, { token: ph });
        assert(r.status === 200, `deactivate medicine ${id}: ${r.status}`);
      }
      if (ctx.supplierId) {
        const r = await api('PUT', `/suppliers/${ctx.supplierId}`, { token: ph, body: { isActive: 0 } });
        assert(r.status === 200, `deactivate supplier ${r.status} ${JSON.stringify(r.data)}`);
      }
      const [{ q }] = await sql('SELECT COALESCE(SUM(quantity), 0)::int AS q FROM hms_medicine_batches WHERE medicine_id = $1', [ctx.medicineId]);
      assert(q === 0, `stock left after cleanup ${q}`);
    });
  } finally {
    await browser.close();
    done();
  }
})();
