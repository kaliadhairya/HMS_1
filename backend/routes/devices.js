const express = require('express');
const { sequelize } = require('../models/db');
const { protect, restrictTo } = require('../middleware/auth');
const { storage } = require('../utils/auditContext');
const D = require('../services/devices');

// Device contracts (Phase 6F), mounted at /api/devices: drafted by one person,
// approved by another; the device key is shown once at approval.
const contracts = express.Router();
const MANAGERS = ['super_admin', 'admin', 'lab_technician'];
function observeAfterCommit(transaction) {
  while (transaction.parent) transaction = transaction.parent;
  transaction.afterCommit(() => storage.run({ requestId: require('crypto').randomUUID(), userId: null, sessionId: null },
    () => D.startMllp().catch((err) => console.error('Device listener reconciliation failed:', err.message))));
}
const handle = (fallback, fn, status = 200) => async (req, res) => {
  try {
    const data = await sequelize.transaction((t) => fn(req, t));
    if (!data) return res.status(404).json({ success: false, message: 'Not found or not active.' });
    res.set('Cache-Control', 'no-store');
    return res.status(status).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, ...(err.code ? { code: err.code } : {}) });
    const code = (err.original || err.parent)?.code;
    if (code === '22P02') return res.status(400).json({ success: false, message: 'That identifier is not valid.' });
    if (['23505', '23514', '23503'].includes(code)) return res.status(409).json({ success: false, code: 'REFUSED', message: (err.original || err.parent).message });
    console.error(`${fallback}:`, err.original?.message || err.message);
    return res.status(500).json({ success: false, message: fallback });
  }
};
contracts.use(protect, restrictTo(...MANAGERS));
contracts.get('/', handle('Could not load device contracts', (req, t) => D.list(t)));
contracts.post('/', handle('Could not save the draft', (req, t) => D.draft(req.body || {}, req.user, t), 201));
contracts.post('/:id/approve', handle('Could not approve the contract', async (req, t) => {
  const approved = await D.approve(req.params.id, req.user, t);
  // An MLLP device starts listening once the approval has committed.
  observeAfterCommit(t);
  return approved;
}));
contracts.post('/:id/retire', handle('Could not retire the contract', async (req, t) => {
  const result = await D.retire(req.params.id, req.user, t);
  observeAfterCommit(t);
  return result;
}));

// Messages from devices, mounted at /api/device-messages/:system. The device
// authenticates with its key (X-Device-Key). HL7 v2 is answered with an HL7
// acknowledgement, ASTM with JSON. Re-sending a message gets the same answer.
const inbound = express.Router();
inbound.post('/:system', express.text({ type: ['text/*', 'application/hl7-v2', 'x-application/hl7-v2+er7', 'application/edi-hl7'], limit: '2mb' }), async (req, res) => {
  try {
    const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body || '');
    const r = await sequelize.transaction((t) => D.receive(req.params.system, raw, { key: req.get('x-device-key') || '',host:req.socket.remoteAddress?.replace(/^::ffff:/,'') }, t));
    if (typeof r.ack === 'string') return res.status(200).type('x-application/hl7-v2+er7').send(r.ack);
    return res.status(200).json(r.ack);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message, code: err.code });
    console.error('Device message failed:', err.original?.message || err.message);
    return res.status(500).json({ success: false, message: 'Could not record the message; send it again.' });
  }
});

module.exports = { contracts, inbound };
