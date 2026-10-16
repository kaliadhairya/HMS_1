// Coded lab tests are priced by catalogue identity (migration 0097): a price
// tied to the catalogue test, else the tariff the catalogue names, else the
// default lab price; never by matching the test's name. Activates a new price
// list (a copy of the active one plus the synthetic prices), so it runs late.
const crypto = require('crypto');
const { api, apiLogin, sql, runner, assert, inCare, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 6).toUpperCase();

(async () => {
  const { step, done } = runner('Lab pricing');
  const tokens = {};
  for (const role of ['super_admin', 'admin', 'doctor', 'lab_technician']) tokens[role] = await apiLogin(role);
  const req = (method, path, role, body) => api(method, path, { token: tokens[role], body });
  const ok = (r, n = 200) => { assert(r.status === n, `${r.status}: ${JSON.stringify(r.data).slice(0, 300)}`); return r.data.data; };
  let tied, tariffed, plain, misleading, defaultPrice, nameTrap;

  await step('Set up catalogue tests: one tied to a price, one naming a tariff, one with neither, one named like a tariff', async () => {
    const [lab] = await sql("SELECT id FROM hms_users WHERE username = 'labtech'");
    ok(await req('POST', '/laboratory/privileges', 'super_admin', { user_id: lab.id, privilege: 'CONTENT', reason: 'Synthetic pricing fixture', valid_from: new Date(Date.now() - 1000).toISOString(), valid_until: new Date(Date.now() + 864e5).toISOString() }), 201);
    const [tariff] = await sql("INSERT INTO hms_tariffs (name, category, rate, is_active) VALUES ($1, 'Lab', 345, 1) RETURNING id", [`Synthetic tariff ${tag}`]);
    [{ unit_price: defaultPrice }] = await sql(`SELECT i.unit_price FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id WHERE v.status = 'Active' AND i.code = 'LAB-DEFAULT'`);
    // A name-matched tariff the old rule would have picked for a test with this name.
    [nameTrap] = await sql(`SELECT i.match_name, i.unit_price FROM hms_charge_master_items i JOIN hms_charge_master_versions v ON v.id = i.version_id
      WHERE v.status = 'Active' AND i.match_name IS NOT NULL AND i.unit_price <> $1 LIMIT 1`, [defaultPrice]);
    const make = (code, name, extra = {}) => req('POST', '/laboratory/catalogue', 'lab_technician', { code_system: 'TEST-PRICE', code: `${code}-${tag}`, kind: 'TEST', name, section: 'TEST', unit: 'TEST-U', method: 'TEST-METHOD',
      provenance: 'Synthetic pricing fixture', effective_at: new Date(Date.now() - 1000).toISOString(), requirements: [{ specimen_type: 'TEST-BLOOD', container: 'TEST-TUBE' }], ...extra });
    tied = ok(await make('TIED', `Synthetic tied ${tag}`), 201);
    tariffed = ok(await make('TARIFF', `Synthetic tariffed ${tag}`, { tariff_id: tariff.id }), 201);
    plain = ok(await make('PLAIN', `Synthetic plain ${tag}`), 201);
    if (nameTrap) misleading = ok(await make('NAME', nameTrap.match_name), 201);
    // New price list: the active one plus a price tied to the catalogue test and the tariff.
    ok(await req('POST', '/finance/charge-master/versions', 'admin', { provenance: `Synthetic pricing test ${tag}` }), 201);
    const [draft] = await sql("SELECT id FROM hms_charge_master_versions WHERE status = 'Draft'");
    const bad = await req('PUT', `/finance/charge-master/versions/${draft.id}/items/X-${tag}`, 'admin', { name: 'x', category: 'Lab', unitPrice: 1, labTestCode: 'TEST-PRICE|NOPE' });
    assert(bad.status === 422, `unknown catalogue test accepted: ${bad.status}`);
    ok(await req('PUT', `/finance/charge-master/versions/${draft.id}/items/TIED-${tag}`, 'admin', { name: 'Tied price', category: 'Lab', unitPrice: 456, labTestCode: `TEST-PRICE|TIED-${tag}` }));
    ok(await req('PUT', `/finance/charge-master/versions/${draft.id}/items/TARIFF-${tariff.id}`, 'admin', { name: 'Tariff price', category: 'Lab', unitPrice: 345 }));
    assert((await req('POST', `/finance/charge-master/versions/${draft.id}/activate`, 'admin', {})).status === 403, 'the author activated their own price list');
    ok(await req('POST', `/finance/charge-master/versions/${draft.id}/activate`, 'super_admin', {}));
  });

  await step('Ordering the tests charges 456, 345 and the default price; a name never sets a coded test\'s price', async () => {
    const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    const [p] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 30, 'Male', 'OPD', CURRENT_DATE) RETURNING id", [`Synthetic pricing ${tag}`, `PRICE-${tag}`]);
    await inCare(p.id);
    const [e] = await sql("INSERT INTO hms_encounters (id, patient_id, doctor_id, status) VALUES (nextval('hms_encounters_seq'), $1, $2, 'Draft') RETURNING id", [p.id, doc.id]);
    const versions = [tied, tariffed, plain, misleading].filter(Boolean).map((x) => x.id);
    const order = ok(await req('POST', '/laboratory/orders', 'doctor', { patient_id: p.id, encounter_id: e.id, test_version_ids: versions }), 201);
    const charges = await sql(`SELECT i.lab_test_version_id AS v, ce.unit_price FROM hms_charge_events ce JOIN hms_investigation_order_items i ON i.id::text = ce.source_key
      WHERE ce.source_type = 'lab_order_item' AND i.order_id = $1`, [order.id]);
    const price = (v) => Number(charges.find((c) => c.v === v.id)?.unit_price);
    assert(price(tied) === 456, `tied test charged ${price(tied)}`);
    assert(price(tariffed) === 345, `tariffed test charged ${price(tariffed)}`);
    assert(price(plain) === Number(defaultPrice), `plain test charged ${price(plain)}, default ${defaultPrice}`);
    if (misleading) assert(price(misleading) === Number(defaultPrice), `a coded test was priced by its name: ${price(misleading)} (name tariff ${nameTrap.unit_price})`);
  });

  done();
  process.exit();
})();
