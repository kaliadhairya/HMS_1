const test = require('node:test');
const assert = require('node:assert/strict');
const { serviceDate, facilityMidnight } = require('../utils/serviceDate');

// The hospital's day changes at midnight IST (18:30 UTC), not at UTC midnight.
test('the service date follows the hospital time zone across UTC midnight', () => {
  assert.equal(serviceDate(new Date('2026-10-13T18:29:59Z')), '2026-10-13');
  assert.equal(serviceDate(new Date('2026-10-13T18:30:00Z')), '2026-10-14');
  assert.equal(serviceDate(new Date('2026-10-13T23:59:00Z')), '2026-10-14', '05:29 IST is already the next day');
});

test('facility midnight is the instant the hospital day begins', () => {
  assert.equal(facilityMidnight('2026-10-14').toISOString(), '2026-10-13T18:30:00.000Z');
  assert.equal(serviceDate(facilityMidnight('2026-10-14')), '2026-10-14');
});

test('another facility time zone can be configured', () => {
  process.env.FACILITY_TZ = 'UTC';
  try { assert.equal(serviceDate(new Date('2026-10-13T23:59:00Z')), '2026-10-13'); } finally { delete process.env.FACILITY_TZ; }
});
