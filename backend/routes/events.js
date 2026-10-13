const express = require('express');
const { protect } = require('../middleware/auth');
const { eventsSince, latestEventId, latestSequence, eventsPage } = require('../utils/outbox');
const router = express.Router();
router.get('/', protect, async (req, res) => {
  const parse = (value) => value === undefined ? null : Number(value);
  const after = parse(req.query.after);
  const sequence = parse(req.query.after_sequence);
  if ([after, sequence].some((value) => value !== null && (!Number.isSafeInteger(value) || value < 0))) return res.status(400).json({ success: false, message: 'Cursor must be a non-negative safe integer.' });
  if (after !== null && sequence !== null) return res.status(400).json({ success: false, message: 'Supply one cursor.' });
  try {
    if (sequence !== null) return res.json({ success: true, ...await eventsPage(req.user, sequence) });
    res.json({ success: true, data: after === null ? [] : await eventsSince(req.user, after), latest_id: await latestEventId(), latest_sequence: await latestSequence() });
  } catch (error) { res.status(500).json({ success: false, message: 'Could not load events.' }); }
});
module.exports = router;
