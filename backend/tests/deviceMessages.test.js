const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../utils/deviceMessages');

// Synthetic messages in the shape analyzers send; no real device content.
const ORU = [
  'MSH|^~\\&|ANALYZER1|LAB|HMS|HOSP|20261014120000||ORU^R01|CTRL-001|P|2.5.1',
  'PID|1||UHID-42^^^HOSP^MR||Synthetic^Patient',
  'OBR|1|ORD-7|ACC-0001|GLU^Glucose',
  'OBX|1|NM|GLU^Glucose||5.4|mmol/L|3.9-5.5|N|||F|||20261014115500||||ANALYZER1-SN9',
  'OBX|2|ST|NOTE^Comment||Haemolysed \\T\\ repeat|',
].join('\r');

test('HL7 v2 ORU is parsed into one result per OBX with its specimen and patient', () => {
  const msg = M.parseHl7(ORU);
  assert.equal(msg.type, 'ORU^R01');
  assert.equal(msg.controlId, 'CTRL-001');
  const results = M.hl7Results(msg);
  assert.equal(results.length, 2);
  assert.deepEqual({ code: results[0].code, value: results[0].value, unit: results[0].unit, specimen: results[0].specimen, patient: results[0].patientIdentifier, instrument: results[0].instrument },
    { code: 'GLU', value: '5.4', unit: 'mmol/L', specimen: 'ACC-0001', patient: 'UHID-42', instrument: 'ANALYZER1-SN9' });
  assert.equal(results[1].value, 'Haemolysed & repeat', 'escape sequences are decoded');
});

test('HL7 acknowledgement echoes the control ID and never carries delimiters from the error text', () => {
  const ack = M.hl7Ack(M.parseHl7(ORU), 'AE', 'bad|value^here');
  const msa = ack.split('\r').find((l) => l.startsWith('MSA'));
  assert.deepEqual(msa.split('|').slice(0, 3), ['MSA', 'AE', 'CTRL-001']);
  assert.ok(!msa.split('|')[3].includes('^'));
});

test('MLLP framing round-trips and keeps a partial message for the next read', () => {
  const two = Buffer.concat([M.frame('MSH|a'), M.frame('MSH|b')]);
  const [msgs, rest] = M.unframe(Buffer.concat([two, Buffer.from([0x0b]), Buffer.from('MSH|c')]));
  assert.deepEqual(msgs, ['MSH|a', 'MSH|b']);
  assert.equal(rest.toString().slice(1), 'MSH|c');
});

test('ASTM E1394 records are parsed into results with specimen and test', () => {
  const astm = ['H|\\^&|||ANALYZER2^1.0|||||||P|1', 'P|1||PID-9', 'O|1|ACC-0002||^^^HB', 'R|1|^^^HB|13.2|g/dL||N||F||||20261014120000|ANALYZER2', 'L|1|N'].join('\r');
  const r = M.astmResults(M.parseAstm(astm));
  assert.equal(r.length, 1);
  assert.deepEqual({ code: r[0].code, value: r[0].value, unit: r[0].unit, specimen: r[0].specimen, patient: r[0].patientIdentifier }, { code: 'HB', value: '13.2', unit: 'g/dL', specimen: 'ACC-0002', patient: 'PID-9' });
});

test('Anything that is not HL7 or ASTM is refused, not guessed', () => {
  assert.throws(() => M.parseHl7('hello'), /HL7/);
  assert.throws(() => M.parseAstm('hello'), /ASTM/);
});

test('reused result set IDs retain their distinct HL7 order groups', () => {
  const text = ORU + '\rOBR|2||ACC-0002|GLU^Glucose\rOBX|1|NM|GLU^Glucose||6|mmol/L';
  const results = M.hl7Results(M.parseHl7(text));
  assert.equal(results[0].setId, results[2].setId);
  assert.notEqual(results[0].groupIndex, results[2].groupIndex);
  assert.equal(results[2].specimen, 'ACC-0002');
});
