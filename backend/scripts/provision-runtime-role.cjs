// Provisions the restricted runtime database identity (completion A2). The
// application connects as this role in production: it owns no clinical table,
// cannot bypass row policies or create schemas, and receives only the data
// manipulation rights the API and workers use. Run once per database as the
// owner (migrations' identity) after migrations. Idempotent.
//   RUNTIME_DB_USER, RUNTIME_DB_PASSWORD (required); owner connection from DB_* env.
const { Client } = require('pg');

const identifier = (v) => {
  if (!/^[a-z_][a-z0-9_]{2,62}$/.test(v || '')) throw new Error('RUNTIME_DB_USER must be a plain lowercase identifier.');
  return v;
};

async function provision({ role, password, client }) {
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount > 0;
  if (!exists) await client.query(`CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT`);
  // ALTER ROLE does not accept bound parameters; the literal is quoted here (the role name is validated above).
  await client.query(`ALTER ROLE ${role} LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD '${String(password).replace(/'/g, "''")}'`);
  const db = (await client.query('SELECT current_database() AS d')).rows[0].d;
  await client.query(`GRANT CONNECT ON DATABASE "${db}" TO ${role}`);
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${role}`);
  // Audit (defence in depth): the application's audit log is append-only; the runtime
  // identity never deletes or truncates it. Sealing writes only the seal columns, and the
  // database guard (audit.forbid_rewrite) refuses every other change to a sealed or stored row.
  await client.query(`REVOKE DELETE, TRUNCATE ON public.hms_audit_logs FROM ${role}`);
  await client.query(`GRANT USAGE ON SCHEMA audit TO ${role}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA audit TO ${role}`);
  await client.query(`GRANT UPDATE ON audit.row_changes, audit.access_events, audit.chain_heads, public.hms_audit_logs TO ${role}`);
  await client.query(`GRANT INSERT ON audit.access_events TO ${role}`);
  await client.query(`REVOKE DELETE, TRUNCATE ON audit.row_changes, audit.access_events, audit.chain_heads, audit.checkpoint_identity FROM ${role}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA audit TO ${role}`);
  await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO ${role}`);
  return { database: db, role };
}

module.exports = { provision, identifier };

if (require.main === module) {
  (async () => {
    const role = identifier(process.env.RUNTIME_DB_USER);
    const password = process.env.RUNTIME_DB_PASSWORD;
    if (!password || password.length < 16) throw new Error('RUNTIME_DB_PASSWORD (16+ characters) is required.');
    const client = new Client({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    await client.connect();
    try {
      const result = await provision({ role, password, client });
      console.log(JSON.stringify({ provisioned: true, ...result }));
    } finally { await client.end(); }
  })().catch((err) => { console.error(`Runtime role provisioning failed: ${err.message}`); process.exit(1); });
}
