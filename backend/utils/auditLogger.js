const crypto = require('crypto');
const { writeAudit } = require('./identityClient');
const AuditLog = require('../models/AuditLog');

async function logAction(userId, action, module, recordId = null, oldValue = null, newValue = null, ipAddress = null) {
  const requestId = crypto.randomUUID();
  try {
    return await writeAudit({ userId, action, module, recordId, oldValue, newValue, ipAddress }, `explicit:${requestId}`, requestId);
  } catch (error) {
    try {
      return await AuditLog.create({
        user_id: userId,
        action,
        module,
        record_id: recordId,
        old_value: typeof oldValue === 'object' && oldValue !== null ? JSON.stringify(oldValue) : oldValue,
        new_value: typeof newValue === 'object' && newValue !== null ? JSON.stringify(newValue) : newValue,
        ip_address: ipAddress,
      });
    } catch (dbErr) {
      console.error('Local audit log fallback error:', dbErr.message);
      return null;
    }
  }
}

module.exports = logAction;
module.exports.logAction = logAction;

