const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { storage } = require('./auditContext');

// Records an incoming message once (migration 0008). Call it in the same
// transaction that processes the message: it returns false for a message
// already processed, and if processing fails the record rolls back with it.
async function acceptOnce(source, messageId, { transaction } = {}) {
  if (!transaction && !storage.getStore()?.command?.active) throw new Error('Inbox acceptance requires the processing transaction');
  const rows = await sequelize.query(
    `INSERT INTO hms_inbox (source, message_id) VALUES (:source, :messageId)
     ON CONFLICT (source, message_id) DO NOTHING RETURNING 1 AS accepted`,
    { replacements: { source, messageId: String(messageId) }, type: QueryTypes.SELECT, transaction }
  );
  return rows.length > 0;
}

module.exports = { acceptOnce };
