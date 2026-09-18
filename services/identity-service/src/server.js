const http = require('http');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createApplication } = require('./app');

const config = loadConfig();
const logger = createLogger(config);
const { app, sequelize } = createApplication(config, logger);
const server = http.createServer(app);
let stopping = false;

async function shutdown(signal, exitCode = 0) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'identity service shutdown started');
  const timer = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
  timer.unref();
  server.close(async () => {
    try { await sequelize.close(); }
    finally { clearTimeout(timer); process.exit(exitCode); }
  });
}

async function start() {
  try {
    await sequelize.authenticate();
    server.listen(config.port, '127.0.0.1', () => logger.info({ port: config.port }, 'identity service listening'));
  } catch (error) {
    logger.fatal({ err: error }, 'identity service startup failed');
    await sequelize.close().catch(() => {});
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('uncaughtException', (error) => { logger.fatal({ err: error }, 'uncaught exception'); shutdown('uncaughtException', 1); });
process.on('unhandledRejection', (error) => { logger.fatal({ err: error }, 'unhandled rejection'); shutdown('unhandledRejection', 1); });

start();
