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
    // A runaway query or an abandoned transaction must not hold a pooled connection forever.
    dialectOptions: {
      statement_timeout: Number(process.env.DB_STATEMENT_TIMEOUT_MS) || 120000,
      idle_in_transaction_session_timeout: Number(process.env.DB_IDLE_TX_TIMEOUT_MS) || 300000,
    },
  }
);

// Every connection knows the hospital's time zone, so SQL "today"
// (hms_service_today(), migration 0096) agrees with utils/serviceDate.js.
sequelize.addHook('afterConnect', async (connection) => {
  await connection.query("SELECT set_config('hms.facility_tz', $1, false)", [process.env.FACILITY_TZ || 'Asia/Kolkata']);
});

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
  const command = require('../utils/auditContext').storage.getStore()?.command;
  if (command) {
    if (!command.active) throw new Error('Clinical command already finished');
    if (options.transaction === null) throw new Error('Clinical command cannot escape its transaction');
    options = { ...options, transaction: options.transaction || command.transaction, retry: { max: 0 } };
  }
  const result = await rawQuery(sql, options);
  if (options && (options.model || options.instance)) return result;
  const rows = options && options.type === 'SELECT' ? result : Array.isArray(result) ? result[0] : null;
  if (Array.isArray(rows)) rows.forEach(addUpperKeys);
  else addUpperKeys(rows);
  return result;
};

// Existing route transactions become savepoints of the command transaction.
const transaction = sequelize.transaction.bind(sequelize);
function protectCommitHooks(tx) {
  if (tx.hmsProtectedCommit || tx.parent) return tx;
  tx.hmsProtectedCommit = true;
  const commit = tx.commit.bind(tx);
  tx.commit = async () => {
    // Sequelize 6 invokes afterCommit hooks in finally, including on failure.
    // Publish settings and revocations only after a confirmed successful commit.
    const hooks = tx._afterCommitHooks;
    tx._afterCommitHooks = [];
    await commit();
    for (const hook of hooks) {
      try { await hook.call(tx, tx); } catch (error) { console.error('Post-commit observation failed:', error.code || error.name); }
    }
  };
  return tx;
}
sequelize.transaction = function commandTransaction(options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  options = options || {};
  const command = require('../utils/auditContext').storage.getStore()?.command;
  if (command) {
    if (!command.active) throw new Error('Clinical command already finished');
    options = { ...options, transaction: options.transaction || command.transaction };
  }
  return callback ? transaction(options, (tx) => callback(protectCommitHooks(tx))) : transaction(options).then(protectCommitHooks);
};
module.exports = { sequelize };
