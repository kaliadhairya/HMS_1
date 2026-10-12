const crypto = require('crypto');
const { writeAudit } = require('./identityClient');
const AuditLog = require('../models/AuditLog');

const identityServiceEnabled = () => Boolean(process.env.INTERNAL_SERVICE_SECRET && process.env.IDENTITY_URL);

// RECORD_ID is an INTEGER column; anything else (UUIDs, large numbers) stays in the values.
function recordIdOrNull(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// The readable activity log. It is not the record of what changed: the
// database captures every row change itself (audit.row_changes).
async function logAction(userId, action, module, recordId = null, oldValue = null, newValue = null, ipAddress = null) {
  const requestId = crypto.randomUUID();
  try {
    if (!identityServiceEnabled()) throw new Error('local');
    return await writeAudit({ userId, action, module, recordId, oldValue, newValue, ipAddress }, `explicit:${requestId}`, requestId);
  } catch (error) {
    try {
      return await AuditLog.create({
        user_id: userId,
        action,
        module,
        record_id: recordIdOrNull(recordId),
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

