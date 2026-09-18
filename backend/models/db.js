const { Sequelize } = require('sequelize');

const dbHost = process.env.DB_HOST || 'localhost';
const dbPort = process.env.DB_PORT || 5432;
const dbName = process.env.DB_NAME || 'hms';
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || 'postgres';

const sequelize = new Sequelize(
  dbName,
  dbUser,
  dbPassword,
  {
    host: dbHost,
    port: dbPort,
    dialect: 'postgres',
    quoteIdentifiers: false,
    pool: {
      max: 25,
      min: 4,
      acquire: 30000,
      idle: 10000,
      evict: 1000,
    },
    retry: {
      max: 3,
    },
    logging: false, // Set to console.log in dev if debugging
  }
);

module.exports = { sequelize };
