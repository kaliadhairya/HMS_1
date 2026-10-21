// Background-worker process (completion A8): "node worker.js" runs the
// workers without serving HTTP, for deployments whose API instances run with
// HMS_PROCESS_ROLE=api. Live socket delivery stays with the API instances,
// which hold the sockets.
require('dotenv').config();
const { assertSecurityConfig } = require('./utils/authTokens');
const { sequelize } = require('./models');
require('./utils/auditContext').bindAuditActor(sequelize);
const { schemaProblems } = require('./migrate');
const settings = require('./utils/settings');
const { startBackgroundWorkers } = require('./workers');

async function main() {
  assertSecurityConfig();
  require('./services/dataKeys.cts').assertDataKeys();
  await sequelize.authenticate();
  const problems = await schemaProblems();
  if (problems.length) throw new Error(`the database schema is not current. Run "node migrate.js up".\n  ${problems.join('\n  ')}`);
  await require('./services/writerFence.cts').assertPrimary();
  await settings.loadSettings();
  settings.startSettingsRefresh();
  const { failed } = startBackgroundWorkers(sequelize);
  // Supervised (B8): a worker that did not start is not left half-running; the process exits and
  // its supervisor (Docker restart policy) starts it again, so the failure is visible.
  if (failed.length) throw new Error(`workers failed to start: ${failed.join(', ')}`);
  // Heartbeat (B8): while the database answers, the heartbeat file is refreshed; the container
  // health check (scripts/worker-health.cjs) reads its age. After three failed checks in a row
  // the process exits so the supervisor restarts it with fresh connections.
  const every = Math.max(200, Number(process.env.HMS_WORKER_HEARTBEAT_MS) || 15000);
  const file = process.env.HMS_WORKER_HEARTBEAT_FILE || '/tmp/hms-worker-heartbeat';
  let misses = 0;
  const beat = async () => {
    try {
      await sequelize.query('SELECT 1', { retry: { max: 0 } });
      misses = 0;
      require('fs').writeFileSync(file, new Date().toISOString());
    } catch (err) {
      misses += 1;
      console.error(`Worker heartbeat failed (${misses}/3): ${err.message}`);
      if (misses >= 3) { console.error('The database is unreachable; exiting for the supervisor to restart the worker.'); process.exit(1); }
    }
  };
  await beat();
  const alive = setInterval(beat, every);
  const stop = () => { clearInterval(alive); sequelize.close().finally(() => process.exit()); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(`❌ Worker refusing to start: ${err.message}`);
  process.exit(1);
});
