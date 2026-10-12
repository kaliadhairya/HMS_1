// Applies the versioned SQL files in migrations/ in order.
//
//   node migrate.js up       apply pending migrations
//   node migrate.js status   list applied and pending migrations
//   node migrate.js check    exit 1 if any migration is pending or was edited
//
// Each file runs in its own transaction and is recorded in schema_migrations
// with a checksum. A file that has been applied must never change: edit the
// schema by adding a new file. A file whose first line is
// "-- migrate:no-transaction" runs outside a transaction (for statements such
// as CREATE INDEX CONCURRENTLY).
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');
const LOCK_ID = 727274; // pg_advisory_lock key shared by every runner
const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'hms',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

function loadMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const seen = new Set();
  return files.map((file) => {
    const match = FILE_PATTERN.exec(file);
    if (!match) throw new Error(`Migration file name must look like 0001_short_name.sql: ${file}`);
    if (seen.has(match[1])) throw new Error(`Two migrations share version ${match[1]}`);
    seen.add(match[1]);
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    return {
      version: match[1],
      file,
      sql,
      checksum: crypto.createHash('sha256').update(sql).digest('hex'),
      transactional: !sql.startsWith('-- migrate:no-transaction'),
    };
  });
}

async function ensureTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     VARCHAR(4) PRIMARY KEY,
      file        TEXT NOT NULL,
      checksum    CHAR(64) NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      duration_ms INTEGER NOT NULL
    )`);
}

// Compares the files on disk with what the database has recorded.
async function plan(client) {
  const migrations = loadMigrations();
  const { rows } = await client.query('SELECT version, file, checksum FROM schema_migrations ORDER BY version');
  const applied = new Map(rows.map((r) => [r.version, r]));
  const edited = migrations.filter((m) => applied.has(m.version) && applied.get(m.version).checksum !== m.checksum);
  const unknown = rows.filter((r) => !migrations.some((m) => m.version === r.version));
  const pending = migrations.filter((m) => !applied.has(m.version));
  return { migrations, applied, edited, unknown, pending };
}

function assertConsistent({ edited, unknown }) {
  const problems = [
    ...edited.map((m) => `${m.file} was changed after it was applied; add a new migration instead`),
    ...unknown.map((r) => `${r.file} is recorded in the database but missing from migrations/`),
  ];
  if (problems.length) throw new Error(problems.join('\n'));
}

async function up(client) {
  await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
  try {
    await ensureTable(client);
    const state = await plan(client);
    assertConsistent(state);
    if (!state.pending.length) {
      console.log('Database is up to date.');
      return;
    }
    for (const m of state.pending) {
      const started = Date.now();
      try {
        if (m.transactional) await client.query('BEGIN');
        await client.query(m.sql);
        await client.query(
          'INSERT INTO schema_migrations (version, file, checksum, duration_ms) VALUES ($1, $2, $3, $4)',
          [m.version, m.file, m.checksum, Date.now() - started]
        );
        if (m.transactional) await client.query('COMMIT');
      } catch (err) {
        if (m.transactional) await client.query('ROLLBACK').catch(() => {});
        throw new Error(`${m.file} failed and was rolled back: ${err.message}`);
      }
      console.log(`Applied ${m.file} (${Date.now() - started} ms)`);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
  }
}

async function status(client) {
  await ensureTable(client);
  const state = await plan(client);
  for (const m of state.migrations) {
    const row = state.applied.get(m.version);
    const mark = !row ? 'pending' : row.checksum === m.checksum ? 'applied' : 'EDITED AFTER APPLYING';
    console.log(`${m.version}  ${mark.padEnd(22)} ${m.file}`);
  }
  for (const r of state.unknown) console.log(`${r.version}  ${'MISSING FILE'.padEnd(22)} ${r.file}`);
  return state;
}

// Everything that stops the database matching migrations/; empty when current.
async function problems(client) {
  const exists = await client.query("SELECT to_regclass('schema_migrations') IS NOT NULL AS ok");
  if (!exists.rows[0].ok) return ['No migrations have been applied (schema_migrations is missing)'];
  const state = await plan(client);
  return [
    ...state.edited.map((m) => `${m.file} was changed after it was applied`),
    ...state.unknown.map((r) => `${r.file} is recorded in the database but missing from migrations/`),
    ...state.pending.map((m) => `${m.file} has not been applied`),
  ];
}

async function check(client) {
  const found = await problems(client);
  if (found.length) throw new Error(found.join('\n'));
  console.log(`Database is up to date (${loadMigrations().length} migrations).`);
}

// Used by the server before it accepts requests.
async function schemaProblems() {
  const client = new Client(dbConfig());
  await client.connect();
  try {
    return await problems(client);
  } finally {
    await client.end();
  }
}

async function main() {
  const command = process.argv[2] || 'status';
  const commands = { up, status, check };
  if (!commands[command]) throw new Error(`Unknown command "${command}". Use up, status or check.`);
  const client = new Client(dbConfig());
  await client.connect();
  try {
    await commands[command](client);
  } finally {
    await client.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { loadMigrations, plan, dbConfig, schemaProblems };
