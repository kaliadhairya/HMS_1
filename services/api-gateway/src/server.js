const http = require('http');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createGateway } = require('./app');

const config = loadConfig();
const logger = createLogger(config);
const { app, proxy } = createGateway(config, logger);
const server = http.createServer(app);

server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/socket.io/')) {
    socket.destroy();
    return;
  }
  proxy.upgrade(req, socket, head);
});

server.requestTimeout = config.proxyTimeoutMs + 5000;
server.headersTimeout = config.proxyTimeoutMs + 10000;
server.keepAliveTimeout = 5000;

server.listen(config.port, () => {
  logger.info({ port: config.port, monolithUrl: config.monolithUrl, identityUrl: config.identityUrl, patientUrl: config.patientUrl, opdUrl: config.opdUrl }, 'API gateway listening');
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'gateway shutdown started');
  const forceTimer = setTimeout(() => {
    logger.error('gateway forced shutdown after timeout');
    process.exit(1);
  }, config.shutdownTimeoutMs);
  forceTimer.unref();
  server.close((error) => {
    clearTimeout(forceTimer);
    if (error) {
      logger.error({ err: error }, 'gateway shutdown failed');
      process.exit(1);
    }
    logger.info('gateway shutdown complete');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => {
  logger.fatal({ err: error }, 'uncaught exception');
  shutdown('uncaughtException');
});
process.on('unhandledRejection', (error) => {
  logger.fatal({ err: error }, 'unhandled rejection');
  shutdown('unhandledRejection');
});
