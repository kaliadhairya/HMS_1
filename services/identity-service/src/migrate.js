const fs = require('fs');
const path = require('path');
const { loadConfig } = require('./config');
const { createLogger } = require('./logger');
const { createDatabase } = require('./db');

async function migrate() {
  const config = loadConfig();
  const logger = createLogger(config);
  const sequelize = createDatabase(config, logger);
  try {
    await sequelize.authenticate();
    const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_audit_idempotency.sql'), 'utf8');
    await sequelize.query(sql);
    logger.info({ migration: '001_audit_idempotency' }, 'identity migration applied');
  } catch (error) {
    logger.fatal({ err: error }, 'identity migration failed');
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
}

migrate();
