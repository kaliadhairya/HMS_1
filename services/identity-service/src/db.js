const { Sequelize } = require('sequelize');

function createDatabase(config, logger) {
  return new Sequelize(config.db.name, config.db.user, config.db.password, {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres',
    timezone: '+00:00',
    quoteIdentifiers: false,
    logging: process.env.SQL_LOGGING === 'true' ? (message) => logger.debug({ sql: message }) : false,
    pool: { max: 5, min: 0, acquire: 10000, idle: 10000 },
  });
}

module.exports = { createDatabase };
