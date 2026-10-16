// Promote a recovered or standby HMS database to be the only writer
// (completion B7). Connection settings come from the environment, never argv:
//   NEW_DB_HOST/PORT/NAME/USER/PASSWORD   the database that becomes primary
//   OLD_DB_HOST/PORT/NAME/USER/PASSWORD   the previous primary, to fence
//   OLD_PRIMARY_ISOLATION   evidence that the old primary is cut off by other
//                           means (ticket, change ID), when it cannot be fenced
//   RECOVERY_REASON         why (kept with the recovery event)
// Options: --promote-standby (call pg_promote on a streaming standby first).
//
// Order matters: the old primary is fenced (writes refused, connections
// ended, verified) BEFORE the new one accepts writes. If it cannot be fenced
// and no isolation evidence is given, nothing changes and the exit status is
// 2. Then, on the new primary, in one transaction: a higher writer epoch and
// a new cluster identity; every session revoked (revocations after the
// recovery point may be lost); outbound messages whose delivery is unknown
// held for review; payments with no known outcome set to Unknown for
// reconciliation; an append-only recovery event. Prints the evidence.
// Run with the recovery (owner) identity; the application identity is not
// allowed to change database settings.
const { Client } = require('pg');

type Cfg = { host: string; port: number; database: string; user: string; password: string };
function cfg(prefix: string): Cfg | null {
  const e = process.env;
  if (!e[`${prefix}_NAME`]) return null;
  return { host: e[`${prefix}_HOST`] || '127.0.0.1', port: Number(e[`${prefix}_PORT`] || 5432), database: String(e[`${prefix}_NAME`]),
    user: e[`${prefix}_USER`] || 'postgres', password: e[`${prefix}_PASSWORD`] || '' };
}
const label = (c: Cfg): string => `${c.host}:${c.port}/${c.database}`;
const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;
function fail(code: number, message: string): never { console.error(`Promotion refused: ${message}`); process.exit(code); }
async function connect(c: Cfg, timeoutMs = 5000) {
  const client = new Client({ ...c, connectionTimeoutMillis: timeoutMs, application_name: 'hms-recovery-promote' });
  await client.connect();
  return client;
}

(async () => {
  const started = new Date();
  const reason = String(process.env.RECOVERY_REASON || '').trim();
  if (reason.length < 5) fail(2, 'set RECOVERY_REASON (why this promotion happens).');
  const target = cfg('NEW_DB');
  if (!target) fail(2, 'set NEW_DB_NAME (and NEW_DB_HOST/PORT/USER/PASSWORD).');
  const old = cfg('OLD_DB');
  const isolation = String(process.env.OLD_PRIMARY_ISOLATION || '').trim();
  if (old && label(old) === label(target)) fail(2, 'the old and new primary are the same database.');
  const evidence: Record<string, unknown> = { new_primary: label(target), old_primary: old ? label(old) : null, reason };

  // 1. The new database must be able to take over.
  const db = await connect(target).catch((e: Error) => fail(2, `the new primary cannot be reached: ${e.message}`));
  const [{ standby }] = (await db.query('SELECT pg_is_in_recovery() AS standby')).rows;
  if (standby) {
    if (!process.argv.includes('--promote-standby')) fail(2, 'the new database is a standby; pass --promote-standby to promote it.');
    await db.query('SELECT pg_promote(true, 60)');
    evidence.standby_promoted = true;
  }
  const fence = (await db.query('SELECT cluster_id, epoch, role FROM hms_writer_fence')).rows[0];
  if (!fence) fail(2, 'the new database has no writer fence (migration 0154).');

  // 2. Fence the old primary first, or record why that is not possible.
  let oldState: 'fenced' | 'isolated' = 'isolated';
  if (old) {
    try {
      const o = await connect(old);
      await o.query("UPDATE hms_writer_fence SET role = 'fenced', changed_at = now(), reason = $1", [`Fenced: ${reason}`.slice(0, 500)]);
      await o.query(`ALTER DATABASE ${ident(old.database)} SET default_transaction_read_only = on`);
      const ended = (await o.query('SELECT count(*)::int AS n FROM (SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()) x')).rows[0].n;
      await o.end();
      // Proof: a new session on the old primary cannot write.
      const check = await connect(old);
      const ro = (await check.query('SHOW default_transaction_read_only')).rows[0].default_transaction_read_only;
      let refused = false;
      try { await check.query("UPDATE hms_writer_fence SET reason = 'write probe after fencing'"); } catch { refused = true; }
      await check.end();
      if (ro !== 'on' || !refused) fail(2, `the old primary ${label(old)} still accepts writes after fencing.`);
      oldState = 'fenced';
      evidence.old_fenced = { read_only: true, write_refused: true, connections_ended: ended };
    } catch (e: any) {
      if (!isolation) fail(2, `the old primary ${label(old)} could not be fenced (${e.message}). Isolate it by other means and set OLD_PRIMARY_ISOLATION with the evidence.`);
      evidence.old_fence_error = e.message;
    }
  } else if (!isolation) {
    fail(2, 'no old primary given (OLD_DB_*) and no OLD_PRIMARY_ISOLATION evidence: another writer may still be running.');
  }
  if (oldState === 'isolated') evidence.isolation_reference = isolation;

  // 3. The new primary takes over in one transaction.
  await db.query(`ALTER DATABASE ${ident(target.database)} SET default_transaction_read_only = off`);
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL default_transaction_read_only = off');
    const before = (await db.query('SELECT cluster_id, epoch FROM hms_writer_fence FOR UPDATE')).rows[0];
    const now = (await db.query(`UPDATE hms_writer_fence SET epoch = epoch + 1, role = 'primary', cluster_id = gen_random_uuid(), changed_at = now(), reason = $1
      RETURNING epoch, cluster_id`, [`Promoted: ${reason}`.slice(0, 500)])).rows[0];
    const last = (await db.query('SELECT max(occurred_at) AS at FROM audit.row_changes')).rows[0].at;
    const sessions = (await db.query("UPDATE hms_sessions SET revoked_at = now(), revoked_reason = 'Recovery promotion: sign in again' WHERE revoked_at IS NULL RETURNING id")).rowCount;
    const held = (await db.query(`UPDATE hms_interface_messages SET next_attempt_at = 'infinity', last_error = 'Held after recovery: whether it was delivered before the recovery point is unknown'
      WHERE direction = 'out' AND status = 'Pending' RETURNING id`)).rowCount;
    const payments = (await db.query("UPDATE hms_payment_intents SET state = 'Unknown' WHERE state IN ('Initiated', 'Pending') RETURNING id")).rowCount;
    const ev = (await db.query(`INSERT INTO hms_recovery_events (epoch, previous_cluster_id, reason, old_primary, isolation_reference, last_recorded_change, started_at,
        sessions_revoked, messages_held, payments_unknown, evidence) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [now.epoch, before.cluster_id, reason, oldState, oldState === 'isolated' ? isolation : null, last, started, sessions, held, payments, JSON.stringify(evidence)])).rows[0];
    if (held) {
      await db.query(`INSERT INTO hms_worklist_items (kind, dedupe_key, title, detail, owner_role) VALUES ('recovery.delivery_unknown', $1, $2, $3, 'super_admin')`,
        [ev.id, `${held} outbound message(s) were pending at the recovery point and are held: check with each receiving system whether they arrived, then release or cancel them.`, JSON.stringify({ recovery_event: ev.id, messages: held })]);
    }
    if (payments) {
      await db.query(`INSERT INTO hms_worklist_items (kind, dedupe_key, title, detail, owner_role) VALUES ('recovery.payment_unknown', $1, $2, $3, 'admin')`,
        [ev.id, `${payments} payment(s) had no known outcome at the recovery point; confirm each with the provider in Finance reconciliation.`, JSON.stringify({ recovery_event: ev.id, payments })]);
    }
    await db.query('COMMIT');
    Object.assign(evidence, { recovery_event: ev.id, epoch: now.epoch, cluster_id: now.cluster_id, previous_cluster_id: before.cluster_id, old_primary_state: oldState,
      last_recorded_change: last, sessions_revoked: sessions, messages_held: held, payments_unknown: payments,
      started_at: started.toISOString(), completed_at: new Date().toISOString(), promotion_ms: Date.now() - started.getTime() });
  } catch (e: any) {
    await db.query('ROLLBACK').catch(() => {});
    fail(1, `the new primary could not be promoted: ${e.message}`);
  }
  await db.end();
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
})().catch((e: Error) => fail(1, e.message));
