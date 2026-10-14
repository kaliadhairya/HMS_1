// Background workers (completion A8). They run in the API process by default
// (HMS_PROCESS_ROLE=all), or in their own process: API instances with
// HMS_PROCESS_ROLE=api serve requests and sockets only, and one "node
// worker.js" runs the workers. Each worker starts on its own, so one that
// fails to start does not stop the others, and each catches its own errors.
const { startAuditSealer } = require('./utils/auditSealer');
const { startAuditShipper } = require('./utils/auditShipper');
const { startFinanceWorker } = require('./services/reconciliation');

const ROLES = ['all', 'api', 'worker'];
function processRole() {
  const role = process.env.HMS_PROCESS_ROLE || 'all';
  if (!ROLES.includes(role)) throw new Error(`HMS_PROCESS_ROLE must be one of ${ROLES.join(', ')} (got "${role}")`);
  return role;
}

const WORKERS = {
  audit_sealer: (sequelize) => startAuditSealer(sequelize),
  audit_shipper: (sequelize) => startAuditShipper(sequelize),
  interfaces: () => require('./services/interfaces').startInterfaceWorker(),
  abdm: () => require('./services/abdm').startAbdmWorker(),
  device_listeners: () => { require('./services/devices').startMllp().catch((err) => console.error('Device listeners failed:', err.message)); },
  downtime_kit: () => require('./services/downtime').startDowntimeKit(),
  finance: () => startFinanceWorker(),
};

// Starts every worker; returns the names that started and those that failed.
function startBackgroundWorkers(sequelize) {
  const started = [];
  const failed = [];
  for (const [name, start] of Object.entries(WORKERS)) {
    try { start(sequelize); started.push(name); }
    catch (err) { failed.push(name); console.error(`Worker ${name} failed to start: ${err.message}`); }
  }
  console.log(`⚙️  Background workers started: ${started.join(', ') || 'none'}${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
  return { started, failed };
}

module.exports = { processRole, startBackgroundWorkers, WORKER_NAMES: Object.keys(WORKERS) };
