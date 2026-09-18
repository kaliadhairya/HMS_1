const { Sequelize } = require('sequelize');
function createDb(config) { return new Sequelize(config.db.name, config.db.user, config.db.password, { host: config.db.host, port: config.db.port, dialect: 'postgres', quoteIdentifiers: false, timezone: '+00:00', logging: false, pool: { max: config.db.poolMax, min: 0, idle: 10000 } }); }
module.exports = { createDb };
