const test = require('node:test');
const assert = require('node:assert/strict');
const { assertMinimal, patientOf, needsCare, toClientEvent } = require('../domain/eventScope.cts');

test('an event payload carries identifiers, codes, counts and flags', () => {
  const body = { order_id: 7, patient_id: 3, state: 'VERIFIED', remaining: 2.5, urgent: true, ids: [1, 2], reportVersionId: 'abc' };
  assert.deepEqual(assertMinimal('x', body), body);
  assert.deepEqual(assertMinimal('x', undefined), {});
  assert.deepEqual(assertMinimal('x', { notes_document_id: 4 }), { notes_document_id: 4 });
  assert.deepEqual(assertMinimal('x', { orderStatus: 'RELEASED', status: 'FINAL' }), { orderStatus: 'RELEASED', status: 'FINAL' });
});

test('patient details and clinical text are refused', () => {
  for (const body of [{ PATIENT_NAME: 'A' }, { UHID: 'H-1' }, { primaryDiagnosis: 'x' }, { reason: 'grn' }, { phone: '9' },
    { INITIAL_ORDERS: 'x' }, { chief_complaint: 'x' }, { allergies: 'x' }]) {
    assert.throws(() => assertMinimal('x', body), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' }, JSON.stringify(body));
  }
  assert.throws(() => assertMinimal('x', { detail: { name: 'A' } }), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' });
  assert.throws(() => assertMinimal('x', { state: 'x'.repeat(101) }), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' });
  assert.throws(() => assertMinimal('x', [1]), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' });
});

test('the patient comes from the options or the payload', () => {
  assert.equal(patientOf({ patient_id: 5 }), 5);
  assert.equal(patientOf({ patientId: '6' }), 6);
  assert.equal(patientOf({ patient_id: 5 }, 9), 9);
  assert.equal(patientOf({ order_id: 1 }), null);
  assert.throws(() => patientOf({ patient_id: 'x' }), { code: 'EVENT_PAYLOAD_NOT_MINIMAL' });
});

test('only doctors need the patient in care', () => {
  assert.equal(needsCare('doctor'), true);
  for (const role of ['nurse', 'pharmacist', 'lab_technician', 'admin', undefined]) assert.equal(needsCare(role), false);
});

test('the envelope carries type, version, sequence, patient, record and correlation', () => {
  const e = toClientEvent({ id: '10', event_type: 'medication_order_changed', payload: '{"order_id":1}', created_at: 't', delivery_sequence: '42',
    patient_id: 3, schema_version: 1, aggregate_type: 'ipd.request', aggregate_id: '8', request_id: 'req-1' });
  assert.deepEqual(e, { order_id: 1, event_id: 10, event_type: 'medication_order_changed', schema_version: 1, delivery_sequence: 42,
    occurred_at: 't', patient_id: 3, aggregate: { type: 'ipd.request', id: '8' }, correlation_id: 'req-1' });
  const old = toClientEvent({ id: 1, event_type: 'y', payload: { a: 1 }, created_at: 't', delivery_sequence: 2 });
  assert.equal(old.schema_version, 1);
  assert.equal('patient_id' in old, false);
});
