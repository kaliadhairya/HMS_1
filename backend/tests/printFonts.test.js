const test = require('node:test');
const assert = require('node:assert/strict');
const PDFDocument = require('pdfkit');
const { enableUnicode, runs, familyOf } = require('../services/printFonts.cts');

test('text splits into runs by script; spaces and punctuation stay with their run', () => {
  assert.deepEqual(runs('Patient: रमेश कुमार'), [{ text: 'Patient: ', family: null }, { text: 'रमेश कुमार', family: 'NotoSansDevanagari' }]);
  assert.deepEqual(runs('Plain English 123').length, 1);
  assert.equal(familyOf('ગ'), 'NotoSansGujarati');
  assert.equal(familyOf('த'), 'NotoSansTamil');
  assert.equal(familyOf('ਪ'), 'NotoSansGurmukhi');
  assert.equal(familyOf('a'), null);
});

function render(write) {
  return new Promise((resolve) => {
    const doc = enableUnicode(new PDFDocument({ compress: false }));
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('latin1')));
    write(doc);
    doc.end();
  });
}

test('a PDF with Hindi and Gujarati text embeds those fonts; English-only text does not', async () => {
  const mixed = await render((doc) => { doc.font('Helvetica-Bold').text('Patient: रमेश कुमार', 50, 50); doc.font('Helvetica').text('ગુજરાતી'); });
  assert.match(mixed, /NotoSansDevanagari-Bold/);
  assert.match(mixed, /NotoSansGujarati/);
  assert.match(mixed, /Helvetica-Bold/);
  const english = await render((doc) => doc.text('Paracetamol 500 mg', 50, 50));
  assert.doesNotMatch(english, /NotoSans/);
});
