const AuditLog = require('../models/AuditLog');


// RECORD_ID is an INTEGER column; anything else (UUIDs, large numbers) stays in the values.
function recordIdOrNull(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id <= 2147483647 ? id : null;
}

// The readable activity log. It is not the record of what changed: the
// database captures every row change itself (audit.row_changes).
async function logAction(userId, action, module, recordId = null, oldValue = null, newValue = null, ipAddress = null) {
  // The tenant database is the audit authority. Direct remote publication
  // before a clinical commit could report a rolled-back action as completed.
  return AuditLog.create({
    user_id: userId,
    action,
    module,
    record_id: recordIdOrNull(recordId),
    old_value: typeof oldValue === 'object' && oldValue !== null ? JSON.stringify(oldValue) : oldValue,
    new_value: typeof newValue === 'object' && newValue !== null ? JSON.stringify(newValue) : newValue,
    ip_address: ipAddress,
  });
}

module.exports = logAction;
module.exports.logAction = logAction;

