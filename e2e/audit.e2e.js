// Audit (migration 0006): row changes are recorded by the database in the
// same transaction, attributed to the user, session and request; audit rows
// are append-only; sealed hash chains and signed checkpoints expose tampering,
// even by a database superuser; chart reads and refusals are logged.
//
// Needs AUDIT_CHECKPOINT_DIR and AUDIT_CHECKPOINT_KEY matching the backend's,
// and DB_* for a throwaway database (it tampers with audit rows on purpose).
const { execFileSync } = require('child_process');
const path = require('path');
const { API, apiLogin, sql, runner, assert, sleep, stamp } = require('./helpers');

const BACKEND = path.join(__dirname, '..', 'backend');

function verify(withCheckpoints) {
  try {
    const out = execFileSync('node', ['scripts/audit-verify.js', ...(withCheckpoints ? [process.env.AUDIT_CHECKPOINT_DIR] : [])], {
      cwd: BACKEND, env: process.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: `${e.stdout}${e.stderr}` };
  }
}

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, requestId: res.headers.get('x-request-id'), data: await res.json().catch(() => null) };
}

async function waitFor(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await fn()) return true; await sleep(500); }
  return false;
}

(async () => {
  const { step, done } = runner('Audit');
  const nurse = await apiLogin('nurse');
  const lab = await apiLogin('lab_technician');
  const doctor = await apiLogin('doctor');
  const [patient] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 1');
  const [nurseRow] = await sql("SELECT id FROM hms_users WHERE username = 'nurse'");
  const allergen = `E2E-Audit-${stamp()}`;

  await step('A change is recorded by the database with its user, session and request', async () => {
    const r = await call('POST', `/patients/hms/${patient.id}/allergies`, nurse, { allergen, severity: 'Mild', reaction: 'Rash' });
    assert(r.status === 201 || r.status === 200, `allergy write ${r.status} ${JSON.stringify(r.data)}`);
    const sid = JSON.parse(Buffer.from(nurse.split('.')[1], 'base64url')).sid;
    const rows = await sql(
      "SELECT actor_user_id, session_id, request_id, new_values FROM audit.row_changes WHERE table_name = 'hms_allergies' AND operation = 'INSERT' AND new_values->>'allergen' = $1",
      [allergen]
    );
    assert(rows.length === 1, `expected one audit row, found ${rows.length}`);
    assert(rows[0].actor_user_id === nurseRow.id, `actor ${rows[0].actor_user_id} != nurse ${nurseRow.id}`);
    assert(rows[0].session_id === sid, 'session not recorded');
    assert(rows[0].request_id === r.requestId, `request ${rows[0].request_id} != response header ${r.requestId}`);
  });

  await step('A rolled-back change leaves no audit record; credentials are never copied', async () => {
    const before = (await sql("SELECT count(*)::int AS n FROM audit.row_changes WHERE table_name = 'hms_allergies'"))[0].n;
    await sql(`DO $$ BEGIN
      INSERT INTO hms_allergies (id, patient_id, allergen) VALUES (nextval('hms_allergy_seq'), ${patient.id}, 'rolled back');
      RAISE EXCEPTION 'abort';
    EXCEPTION WHEN raise_exception THEN NULL; END $$`);
    const after = (await sql("SELECT count(*)::int AS n FROM audit.row_changes WHERE table_name = 'hms_allergies'"))[0].n;
    assert(after === before, `rolled-back insert produced ${after - before} audit row(s)`);
    const leaked = await sql("SELECT count(*)::int AS n FROM audit.row_changes WHERE table_name = 'hms_users' AND (new_values->>'password' NOT IN ('[redacted]') OR old_values->>'password' NOT IN ('[redacted]'))");
    assert(leaked[0].n === 0, `${leaked[0].n} audit rows contain a password hash`);
  });

  await step('Audit rows cannot be changed, deleted or truncated', async () => {
    for (const statement of [
      'UPDATE audit.row_changes SET new_values = \'{}\' WHERE id = (SELECT max(id) FROM audit.row_changes)',
      'DELETE FROM audit.row_changes WHERE id = (SELECT max(id) FROM audit.row_changes)',
      'TRUNCATE audit.access_events',
      'DELETE FROM hms_audit_logs WHERE id = (SELECT max(id) FROM hms_audit_logs)',
    ]) {
      let refused = false;
      try { await sql(statement); } catch (e) { refused = /append-only/.test(e.message); }
      assert(refused, `not refused: ${statement}`);
    }
  });

  await step('Chart reads and refused requests are logged', async () => {
    const read = await call('GET', `/patients/hms/${patient.id}/allergies`, doctor);
    const denied = await call('GET', `/pdf/bill/1`, lab);
    assert(read.status === 200 && denied.status === 403, `setup: read ${read.status}, denied ${denied.status}`);
    const found = await waitFor(async () => {
      const rows = await sql('SELECT request_id, outcome, patient_id FROM audit.access_events WHERE request_id = ANY($1)', [[read.requestId, denied.requestId]]);
      return rows.some((r) => r.outcome === 'read' && r.patient_id === patient.id) && rows.some((r) => r.outcome === 'denied');
    });
    assert(found, 'read or refusal missing from audit.access_events');
  });

  await step('The sealer chains every committed entry and the chains verify', async () => {
    const sealed = await waitFor(async () => (await sql('SELECT count(*)::int AS n FROM audit.row_changes WHERE row_hash IS NULL'))[0].n === 0);
    assert(sealed, 'entries were not sealed');
    const checkpointed = await waitFor(async () => require('fs').readdirSync(process.env.AUDIT_CHECKPOINT_DIR).length > 0, 20000);
    assert(checkpointed, 'no checkpoint was written');
    const r = verify(true);
    assert(r.ok, `verify failed on an untouched database:\n${r.out}`);
  });

  await step('A superuser editing a sealed entry is caught by the chain', async () => {
    const [target] = await sql("SELECT id, new_values FROM audit.row_changes WHERE table_name = 'hms_allergies' AND new_values->>'allergen' = $1", [allergen]);
    await sql('ALTER TABLE audit.row_changes DISABLE TRIGGER trg_row_changes_append_only');
    try {
      await sql("UPDATE audit.row_changes SET new_values = jsonb_set(new_values, '{allergen}', '\"nothing\"') WHERE id = $1", [target.id]);
    } finally {
      await sql('ALTER TABLE audit.row_changes ENABLE TRIGGER trg_row_changes_append_only');
    }
    const r = verify(false);
    assert(!r.ok && /does not match its hash/.test(r.out), `edit not detected:\n${r.out}`);
    // Put it back so the next step starts from an intact chain.
    await sql('ALTER TABLE audit.row_changes DISABLE TRIGGER trg_row_changes_append_only');
    try {
      await sql('UPDATE audit.row_changes SET new_values = $2 WHERE id = $1', [target.id, target.new_values]);
    } finally {
      await sql('ALTER TABLE audit.row_changes ENABLE TRIGGER trg_row_changes_append_only');
    }
    assert(verify(false).ok, 'chain did not verify after restoring the entry');
  });

  await step('A superuser rewriting history and recomputing the whole chain is caught by the signed checkpoint', async () => {
    const [target] = await sql("SELECT id, chain_seq FROM audit.row_changes WHERE table_name = 'hms_allergies' AND new_values->>'allergen' = $1", [allergen]);
    // Wait until a checkpoint covers the target entry.
    const covered = await waitFor(async () => {
      const files = require('fs').readdirSync(process.env.AUDIT_CHECKPOINT_DIR).sort();
      const last = JSON.parse(require('fs').readFileSync(path.join(process.env.AUDIT_CHECKPOINT_DIR, files[files.length - 1]), 'utf8'));
      return last.heads.find((h) => h.chain === 'audit.row_changes').seq >= Number(target.chain_seq);
    }, 20000);
    assert(covered, 'no checkpoint covers the target entry');
    await sql(`DO $$ BEGIN
      ALTER TABLE audit.row_changes DISABLE TRIGGER trg_row_changes_append_only;
      UPDATE audit.row_changes SET new_values = jsonb_set(new_values, '{allergen}', '"nothing"') WHERE id = ${target.id};
      UPDATE audit.row_changes SET chain_seq = NULL, prev_hash = NULL, row_hash = NULL WHERE chain_seq >= ${target.chain_seq};
      UPDATE audit.chain_heads SET seq = ${target.chain_seq} - 1,
             head_hash = COALESCE((SELECT row_hash FROM audit.row_changes WHERE chain_seq = ${target.chain_seq} - 1), '\\x'::bytea)
       WHERE chain = 'audit.row_changes';
      PERFORM audit.seal('audit.row_changes');
      ALTER TABLE audit.row_changes ENABLE TRIGGER trg_row_changes_append_only;
    END $$`);
    const chainOnly = verify(false);
    assert(chainOnly.ok, `the rewritten chain should look internally consistent:\n${chainOnly.out}`);
    const withCheckpoints = verify(true);
    assert(!withCheckpoints.ok && /differs from the checkpoint/.test(withCheckpoints.out), `rewrite not detected by checkpoints:\n${withCheckpoints.out}`);
  });

  done();
  process.exit();
})();
