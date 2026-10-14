// Billing controls (completion A7): two-person approval for prices,
// packages and return credits, replay-safe credits, and reconciliation that
// finds returned medicine left uncredited, medicine charges without a
// dispense line, and stock whose balance disagrees with its journal.
// Run after the medication suite (it uses a charged, dispensed coded medicine).
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 6).toUpperCase();
async function call(method, url, token, body, key = crypto.randomUUID()) {
  const res = await fetch(API + url, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': key } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null), replay: res.headers.get('idempotent-replay') === 'true' };
}
const run = async (token) => { const r = await call('POST', '/finance/reconciliation/run', token, {}); assert(r.status === 200, `reconciliation ${r.status}`); return r.data.data.found; };

(async () => {
  const { step, done } = runner('Billing controls');
  const admin = await apiLogin('admin');
  const sa = await apiLogin('super_admin');
  const [adminUser] = await sql("SELECT id FROM hms_users WHERE username = 'admin'");

  await step('A price list is activated only by someone who neither drafted nor changed it', async () => {
    const open = await sql("SELECT id FROM hms_charge_master_versions WHERE status = 'Draft'");
    assert(!open.length, 'test copy already has a draft price list');
    const v = await call('POST', '/finance/charge-master/versions', admin, { provenance: `Synthetic two-person test ${tag}` });
    assert(v.status === 201, `draft ${v.status}`);
    // super_admin edits a price: now neither of them may activate.
    assert((await call('PUT', `/finance/charge-master/versions/${v.data.data.id}/items/SVC-${tag}`, sa, { name: 'Synthetic service', category: 'Service', unitPrice: 10 })).status === 200, 'edit');
    for (const token of [admin, sa]) {
      const r = await call('POST', `/finance/charge-master/versions/${v.data.data.id}/activate`, token, {});
      assert(r.status === 403 && r.data.code === 'SAME_PERSON', `an author/editor activated: ${r.status}`);
    }
    let direct = false;
    try { await sql("UPDATE hms_charge_master_versions SET status = 'Active', activated_by = created_by, activated_at = now() WHERE id = $1", [v.data.data.id]); } catch { direct = true; }
    assert(direct, 'the database allowed self-activation');
    // A third administrator activates.
    const [other] = await sql("INSERT INTO hms_users (username, password, name, role, is_active) VALUES ($1, 'NOT-A-LOGIN', 'Synthetic approver', 'admin', 1) RETURNING id", [`approver-${tag.toLowerCase()}`]);
    await sql("UPDATE hms_charge_master_versions SET status = 'Retired', retired_at = now() WHERE status = 'Active'");
    await sql("UPDATE hms_charge_master_versions SET status = 'Active', activated_by = $2, activated_at = now() WHERE id = $1", [v.data.data.id, other.id]);
    const [now] = await sql('SELECT status FROM hms_charge_master_versions WHERE id = $1', [v.data.data.id]);
    assert(now.status === 'Active', 'a separate approver could not activate');
  });

  await step('Returned medicine is credited once, and not by the person who received it', async () => {
    const [line] = await sql(`SELECT dl.id, c.account_id FROM hms_med_dispense_lines dl
      JOIN hms_charge_events c ON c.source_type = 'medicine_dispense_line' AND c.source_key = dl.id::text ORDER BY dl.id LIMIT 1`);
    assert(line, 'needs a charged dispense line (run after the medication or pharmacy suite)');
    const [ret] = await sql("INSERT INTO hms_med_returns (dispense_line_id, quantity, reason, received_by_user_id) VALUES ($1, 0.5, 'Synthetic return for the controls test', $2) RETURNING id", [line.id, adminUser.id]);
    const self = await call('POST', `/finance/medicine-returns/${ret.id}/credit`, admin, {});
    assert(self.status === 403 && self.data.code === 'SAME_PERSON', `receiver credited own return: ${self.status}`);
    const key = crypto.randomUUID();
    const first = await call('POST', `/finance/medicine-returns/${ret.id}/credit`, sa, {}, key);
    assert(first.status === 201, `credit ${first.status} ${JSON.stringify(first.data)}`);
    const replay = await call('POST', `/finance/medicine-returns/${ret.id}/credit`, sa, {}, key);
    assert(replay.status === 201 && replay.replay && replay.data.data.charge?.id === first.data.data.charge?.id, `replay did not return the first answer: ${replay.status} ${replay.replay}`);
    const again = await call('POST', `/finance/medicine-returns/${ret.id}/credit`, sa, {});
    assert(again.status === 409, `credited twice: ${again.status}`);
    const credits = await sql(`SELECT (SELECT count(*) FROM hms_charge_events WHERE source_type = 'medicine_return' AND source_key = $1)
      + (SELECT count(*) FROM hms_invoice_notes WHERE source_type = 'medicine_return' AND source_key = $1) AS n`, [ret.id]);
    assert(Number(credits[0].n) === 1, `${credits[0].n} credits for one return`);
  });

  await step('Reconciliation finds an overdue uncredited return, a charge without dispense, and stock off its journal', async () => {
    const [line] = await sql(`SELECT dl.id, c.account_id FROM hms_med_dispense_lines dl
      JOIN hms_charge_events c ON c.source_type = 'medicine_dispense_line' AND c.source_key = dl.id::text ORDER BY dl.id LIMIT 1`);
    const [old] = await sql("INSERT INTO hms_med_returns (dispense_line_id, quantity, reason, received_by_user_id, recorded_at) VALUES ($1, 0.25, 'Synthetic overdue return', $2, now() - interval '5 days') RETURNING id", [line.id, adminUser.id]);
    const ghost = crypto.randomUUID();
    await sql(`SELECT billing_capture_charge($1, 'medicine_dispense_line', $2, 'Medicine', NULL, 'Synthetic charge without dispense', NULL, 'source', 1, 1, 0, now(), NULL)`, [line.account_id, ghost]);
    const [b] = await sql('SELECT batch_id FROM hms_med_balances ORDER BY batch_id LIMIT 1');
    const [loc] = await sql("INSERT INTO hms_med_locations (code, name, kind) VALUES ($1, 'Synthetic reconciliation shelf', 'STORE') RETURNING id", [`REC-${tag}`]);
    if (loc && b) await sql('INSERT INTO hms_med_balances (batch_id, location_id, quantity) VALUES ($1, $2, 5)', [b.batch_id, loc.id]);
    const found = await run(admin);
    const kinds = (k, key) => found.some((f) => f.kind === k && (!key || String(f.key) === String(key)));
    assert(kinds('return_uncredited', old.id), 'overdue return not reported');
    assert(found.some((f) => f.kind === 'charge_without_dispense' && f.details.dispense_line === ghost), 'charge without dispense not reported');
    if (loc && b) assert(kinds('stock_mismatch', `${b.batch_id}:${loc.id}`), 'stock off its journal not reported');
    const open = await sql("SELECT kind FROM hms_recon_exceptions WHERE status = 'Open' AND kind IN ('return_uncredited', 'charge_without_dispense', 'stock_mismatch')");
    assert(open.length >= 2, 'exceptions not opened for follow-up');
  });

  done();
  process.exit();
})();
