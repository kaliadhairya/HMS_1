const http = require('http');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createDb } = require('./db');
const { createModels } = require('./models');
const { createApp } = require('./app');

const config = loadConfig(); const logger = createLogger(config); const sequelize = createDb(config); const models = createModels(sequelize, config); const app = createApp(config, logger, models, sequelize); const server = http.createServer(app);
sequelize.authenticate().then(() => { server.listen(config.port, config.host, () => logger.info({ port: config.port, host: config.host }, 'patient service listening')); }).catch((error) => { logger.fatal({ err: error }, 'patient database connection failed'); process.exit(1); });
let stopping = false; function shutdown(signal) { if (stopping) return; stopping = true; logger.info({ signal }, 'patient service shutdown started'); const timer = setTimeout(() => process.exit(1), 10000); timer.unref(); server.close(async () => { await sequelize.close(); clearTimeout(timer); logger.info('patient service shutdown complete'); process.exit(0); }); }
process.on('SIGINT', () => shutdown('SIGINT')); process.on('SIGTERM', () => shutdown('SIGTERM')); process.on('uncaughtException', (e) => { logger.fatal({ err: e }, 'uncaught exception'); shutdown('uncaughtException'); }); process.on('unhandledRejection', (e) => { logger.fatal({ err: e }, 'unhandled rejection'); shutdown('unhandledRejection'); });
