// The writer fence (completion B7, migration 0154). HMS refuses to start on
// a database that a recovery fenced, and reports not ready while fenced, so
// a load balancer stops sending it work. The fenced database itself is also
// read-only, so a writer that was already running cannot change it.
const { sequelize } = require('../models/db');

type Fence = { cluster_id: string; epoch: number; role: string; changed_at: string; reason: string };

async function fenceState(): Promise<Fence | null> {
  const [row] = await sequelize.query('SELECT cluster_id, epoch, role, changed_at, reason FROM hms_writer_fence', { type: 'SELECT', retry: { max: 0 } });
  return (row as Fence) || null;
}

// Throws when this database must not be written by HMS.
async function assertPrimary(): Promise<Fence> {
  const f = await fenceState();
  if (!f) throw new Error('the database has no writer fence (migration 0154)');
  if (f.role !== 'primary') throw new Error(`this database was fenced at ${new Date(f.changed_at).toISOString()} (${f.reason}). Point HMS at the current primary.`);
  return f;
}

module.exports = { fenceState, assertPrimary };
