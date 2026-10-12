// Compares what the code expects with what a database actually has, and prints
// a Markdown report. Read-only: it runs SELECTs against the catalog only.
//
//   node scripts/schema-report.js                       # database from backend/.env
//   DB_HOST=localhost DB_PORT=5434 DB_USER=postgres DB_PASSWORD=postgres \
//     node scripts/schema-report.js                     # the Docker Compose database
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { sequelize } = require('../models');

const ROOT = path.join(__dirname, '..');
const SQL_SOURCES = ['server.js', 'routes', 'utils', 'middleware'];

function listJsFiles(target) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(target, entry.name);
    if (entry.isDirectory()) return listJsFiles(child);
    return entry.name.endsWith('.js') ? [path.join(ROOT, child)] : [];
  });
}

// Every HMS_* table named after FROM/JOIN/INTO/UPDATE/TABLE in hand-written SQL.
function tablesReferencedInCode() {
  const refs = new Map();
  for (const file of SQL_SOURCES.flatMap(listJsFiles)) {
    fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      for (const match of line.matchAll(/\b(?:from|join|into|update|table)\s+(hms_[a-z0-9_]+)\b/gi)) {
        const name = match[1].toLowerCase();
        if (!refs.has(name)) refs.set(name, []);
        refs.get(name).push(`${path.relative(ROOT, file)}:${i + 1}`);
      }
    });
  }
  return refs;
}

async function main() {
  const q = (sql) => sequelize.query(sql, { type: sequelize.QueryTypes.SELECT });
  const [{ server_version: version }] = await q('SHOW server_version');
  const [{ db }] = await q('SELECT current_database() AS db');
  const columnRows = await q(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`);
  // Read tables from pg_class: Sequelize reshapes any query on information_schema.tables.
  const tableRows = await q(`SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')`);
  const relationRows = await q(`SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public'`);
  const constraintRows = await q(`
    SELECT c.contype AS type, count(*)::int AS n FROM pg_constraint c
    JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' GROUP BY c.contype`);

  const dbTables = new Set(tableRows.map((r) => r.table_name.toLowerCase()));
  const dbRelations = new Set(relationRows.map((r) => r.name.toLowerCase()));
  const dbColumns = new Map();
  for (const r of columnRows) {
    const t = r.table_name.toLowerCase();
    if (!dbColumns.has(t)) dbColumns.set(t, new Set());
    dbColumns.get(t).add(r.column_name.toLowerCase());
  }

  const missingTables = [];
  const missingColumns = [];
  const unmappedColumns = [];
  const modelTables = new Set();
  for (const model of Object.values(sequelize.models)) {
    const table = String(model.getTableName()).toLowerCase();
    modelTables.add(table);
    if (!dbTables.has(table)) { missingTables.push(`${model.name} → \`${table}\``); continue; }
    const actual = dbColumns.get(table);
    const expected = new Set(Object.values(model.rawAttributes).map((a) => String(a.field || a.fieldName).toLowerCase()));
    for (const col of expected) if (!actual.has(col)) missingColumns.push(`\`${table}.${col}\` (model ${model.name})`);
    for (const col of actual) if (!expected.has(col)) unmappedColumns.push(`\`${table}.${col}\``);
  }
  const tablesWithoutModel = [...dbTables].filter((t) => !modelTables.has(t)).sort();

  const refs = tablesReferencedInCode();
  const missingInSql = [...refs.entries()]
    .filter(([name]) => !dbRelations.has(name) && !name.endsWith('_seq'))
    .sort(([a], [b]) => a.localeCompare(b));

  const constraints = Object.fromEntries(constraintRows.map((r) => [r.type, r.n]));
  const hasMigrations = fs.existsSync(path.join(ROOT, 'migrations'));
  const list = (items) => (items.length ? items.map((i) => `- ${i}`).join('\n') : '- None');

  console.log(`# Schema report: \`${db}\` (PostgreSQL ${version})

Generated ${new Date().toISOString()} by \`backend/scripts/schema-report.js\`.

| Measure | Value |
|---|---:|
| Tables in database | ${dbTables.size} |
| Sequelize models | ${modelTables.size} |
| Primary keys | ${constraints.p || 0} |
| Foreign keys | ${constraints.f || 0} |
| Unique constraints | ${constraints.u || 0} |
| Check constraints | ${constraints.c || 0} |
| Exclusion constraints | ${constraints.x || 0} |
| Versioned migrations directory | ${hasMigrations ? 'yes' : 'no'} |

## Models whose table is missing
${list(missingTables)}

## Model columns missing from the database
Queries through these models fail or silently lose data.

${list(missingColumns)}

## Tables used in hand-written SQL that do not exist
${missingInSql.length ? missingInSql.map(([name, where]) => `- \`${name}\` — ${where.slice(0, 5).join(', ')}${where.length > 5 ? `, +${where.length - 5} more` : ''}`).join('\n') : '- None'}

## Database tables with no model
Only reachable through hand-written SQL.

${list(tablesWithoutModel.map((t) => `\`${t}\``))}

## Database columns not declared on their model
Informational: usually read through hand-written SQL.

${list(unmappedColumns)}
`);
}

main()
  .catch((err) => { console.error(err.message); process.exitCode = 1; })
  .finally(() => sequelize.close());
