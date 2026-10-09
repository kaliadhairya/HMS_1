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

// PostgreSQL folds unquoted column names to lower case, but most of this code (ported from
// Oracle) reads raw query rows in upper case (row.GENERIC_NAME, row.TOTAL). Give raw query
// rows both spellings. Model queries (options.model) are left untouched.
function addUpperKeys(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row) || row instanceof Date || Buffer.isBuffer(row)) return;
  for (const key of Object.keys(row)) {
    const upper = key.toUpperCase();
    if (upper !== key && !(upper in row)) row[upper] = row[key];
  }
}
const rawQuery = sequelize.query.bind(sequelize);
sequelize.query = async function query(sql, options = {}) {
  const result = await rawQuery(sql, options);
  if (options && (options.model || options.instance)) return result;
  const rows = options && options.type === 'SELECT' ? result : Array.isArray(result) ? result[0] : null;
  if (Array.isArray(rows)) rows.forEach(addUpperKeys);
  else addUpperKeys(rows);
  return result;
};

module.exports = { sequelize };
