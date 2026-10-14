// Background-worker process (completion A8): "node worker.js" runs the
// workers without serving HTTP, for deployments whose API instances run with
// HMS_PROCESS_ROLE=api. Live socket delivery stays with the API instances,
// which hold the sockets.
require('dotenv').config();
const { assertSecurityConfig } = require('./utils/authTokens');
const { sequelize } = require('./models');
const { schemaProblems } = require('./migrate');
const settings = require('./utils/settings');
const { startBackgroundWorkers } = require('./workers');

async function main() {
  assertSecurityConfig();
  require('./services/dataKeys.cts').assertDataKeys();
  await sequelize.authenticate();
  const problems = await schemaProblems();
  if (problems.length) throw new Error(`the database schema is not current. Run "node migrate.js up".\n  ${problems.join('\n  ')}`);
  await settings.loadSettings();
  settings.startSettingsRefresh();
  const { failed } = startBackgroundWorkers(sequelize);
  if (failed.length) process.exitCode = 1;
  // Timers are unref'd so they never hold an exiting process; this keeps the worker alive.
  const alive = setInterval(() => {}, 60 * 60 * 1000);
  const stop = () => { clearInterval(alive); sequelize.close().finally(() => process.exit()); };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch((err) => {
  console.error(`❌ Worker refusing to start: ${err.message}`);
  process.exit(1);
});
