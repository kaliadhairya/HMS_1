const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const { sequelize } = require('../models');
const { protect } = require('../middleware/auth');

// ── Helpers ─────────────────────────────────────────────────────
const safe = (val, fallback = '') => {
  if (val === null || val === undefined) return fallback;
  return String(val).replace(/[^\x20-\x7E\xA0-\xFF]/g, '').trim() || fallback;
};

const uppercaseKeys = (row) => Object.fromEntries(
  Object.entries(row || {}).map(([key, value]) => [key.toUpperCase(), value])
);

// ── Fetch hospital profile (reusable) ──────────────────────────
async function getHospitalProfile() {
  const [rows] = await sequelize.query(`SELECT * FROM HMS_HOSPITAL_PROFILE LIMIT 1`);
  return rows[0] ? uppercaseKeys(rows[0]) : { NAME: 'City General Hospital', ADDRESS: '100 Medical Center Blvd', CITY: 'Metropolis', PHONE: '011-23456789', REG_NUMBER: 'HOSP-2024-001' };
}

// ── Draw Hospital Letterhead (shared between PDFs) ─────────────
function drawLetterhead(doc, hosp, MARGIN, CONTENT) {
  doc.y = 20;

  // Logo
  if (hosp.LOGO_URL) {
    const logoPath = path.join(__dirname, '..', hosp.LOGO_URL);
    if (fs.existsSync(logoPath)) {
      doc.image(logoPath, MARGIN, 20, { width: 55 });
    }
  } else {
    const fallbackLogo = path.join(__dirname, '../../frontend/public/logo.png');
    if (fs.existsSync(fallbackLogo)) {
      doc.image(fallbackLogo, MARGIN, 20, { width: 55 });
    }
  }

  // Hospital name
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#0f4c81')
    .text(safe(hosp.NAME, 'City General Hospital'), 110, 22, { width: 350 });
  
  if (hosp.TAGLINE) {
    doc.fontSize(9).font('Helvetica').fillColor('#555555')
      .text(safe(hosp.TAGLINE), 110, 44);
  }

  doc.fontSize(8).font('Helvetica').fillColor('#666666')
    .text(`${safe(hosp.ADDRESS)}, ${safe(hosp.CITY)} - ${safe(hosp.PIN)}`, 110, 56);
  doc.text(`Ph: ${safe(hosp.PHONE)} | Reg: ${safe(hosp.REG_NUMBER)}`, 110, 68);

  // Contact on right
  if (hosp.EMAIL) {
    doc.fontSize(8).font('Helvetica').fillColor('#666666')
      .text(safe(hosp.EMAIL), 420, 30, { lineBreak: false });
  }
  if (hosp.WEBSITE) {
    doc.text(safe(hosp.WEBSITE), 420, 42, { lineBreak: false });
  }

  // Blue rule
  doc.rect(MARGIN, 85, CONTENT, 3).fill('#0f4c81');
  doc.y = 95;
}

// ═══════════════════════════════════════════════════════════════
//  PRESCRIPTION PDF
// ═══════════════════════════════════════════════════════════════

async function generatePrescriptionPDF(prescriptionId, res) {
  const hosp = await getHospitalProfile();

  // Fetch prescription data
  const [prescriptions] = await sequelize.query(`
    SELECT pr.*, p.NAME as PATIENT_NAME, p.UHID, p.AGE, p.GENDER,
           u.NAME as DOCTOR_NAME, d.NAME as DOCTOR_DEPT
    FROM HMS_PRESCRIPTIONS pr
    JOIN HMS_PATIENTS p ON p.ID = pr.PATIENT_ID
    JOIN HMS_USERS u ON u.ID = pr.DOCTOR_ID
    LEFT JOIN HMS_DEPARTMENTS d ON d.ID = u.DEPARTMENT_ID
    WHERE pr.ID = :id
  `, { replacements: { id: prescriptionId } });

  if (prescriptions.length === 0) {
    return res.status(404).json({ success: false, message: 'Prescription not found' });
  }
  const data = uppercaseKeys(prescriptions[0]);

  // Fetch items
  let [items] = await sequelize.query(
    `SELECT * FROM HMS_PRESCRIPTION_ITEMS WHERE PRESCRIPTION_ID = :id ORDER BY ID`,
    { replacements: { id: prescriptionId } }
  );
  items = items.map(uppercaseKeys);

  // Fetch diagnoses
  let [diagnoses] = await sequelize.query(`
    SELECT ICD10_DESCRIPTION FROM HMS_DIAGNOSES
    WHERE ENCOUNTER_ID = (SELECT ENCOUNTER_ID FROM HMS_PRESCRIPTIONS WHERE ID = :id)
  `, { replacements: { id: prescriptionId } });
  diagnoses = diagnoses.map(uppercaseKeys);

  // ── PDF setup ──────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const MARGIN = 40;
  const PW = doc.page.width;
  const CONTENT = PW - MARGIN * 2;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="prescription-${prescriptionId}.pdf"`);
  doc.pipe(res);

  // ── Letterhead ─────────────────────────────────────────────────
  drawLetterhead(doc, hosp, MARGIN, CONTENT);

  // ── Doctor section ─────────────────────────────────────────────
  doc.moveDown(0.3);
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
    .text(`Dr. ${safe(data.DOCTOR_NAME)}`, MARGIN, doc.y);
  doc.fontSize(9).font('Helvetica').fillColor('#555555')
    .text(safe(data.DOCTOR_DEPT, 'General Medicine'), MARGIN, doc.y);
  doc.moveDown(0.5);

  // ── Patient details box ────────────────────────────────────────
  const patY = doc.y;
  doc.rect(MARGIN, patY, CONTENT, 45).fill('#f5f5f5');
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
  doc.text(`Patient: ${safe(data.PATIENT_NAME)}`, MARGIN + 10, patY + 8);
  doc.text(`UHID: ${safe(data.UHID)}`, 280, patY + 8);
  doc.text(`Age: ${safe(data.AGE)}Y / ${safe(data.GENDER)}`, 420, patY + 8);
  
  const prescDate = data.CREATED_AT ? new Date(data.CREATED_AT).toLocaleDateString('en-IN') : '';
  doc.fontSize(9).font('Helvetica').fillColor('#666666');
  doc.text(`Date: ${prescDate}`, MARGIN + 10, patY + 26);
  doc.y = patY + 55;

  // ── Diagnosis ──────────────────────────────────────────────────
  if (diagnoses.length > 0) {
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
      .text('Diagnosis: ', MARGIN, doc.y, { continued: true });
    doc.font('Helvetica').fillColor('#000000')
      .text(diagnoses.map(d => safe(d.ICD10_DESCRIPTION)).join(', '));
    doc.moveDown(0.5);
  }

  // ── Rx symbol + table ──────────────────────────────────────────
  doc.fontSize(28).font('Helvetica-Bold').fillColor('#0f4c81')
    .text('Rx', MARGIN, doc.y);
  doc.moveDown(0.3);

  // Table headers
  const colX = [MARGIN, MARGIN + 30, MARGIN + 180, MARGIN + 250, MARGIN + 310, MARGIN + 380, MARGIN + 430];
  const headers = ['#', 'Medicine', 'Dose', 'Route', 'Frequency', 'Duration', 'Instructions'];

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
  headers.forEach((h, i) => doc.text(h, colX[i], doc.y, { lineBreak: false }));
  doc.moveDown(0.4);

  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  // Table rows
  items.forEach((item, idx) => {
    const rowY = doc.y;
    // Alternate row shading
    if (idx % 2 === 0) {
      doc.rect(MARGIN, rowY - 2, CONTENT, 16).fill('#fafafa');
    }

    doc.fontSize(9).font('Helvetica').fillColor('#333333');
    doc.text(String(idx + 1), colX[0], rowY, { lineBreak: false });
    doc.font('Helvetica-Bold').text(safe(item.MEDICINE_NAME), colX[1], rowY, { lineBreak: false, width: 145 });
    doc.font('Helvetica');
    doc.text(safe(item.DOSAGE), colX[2], rowY, { lineBreak: false });
    doc.text(safe(item.ROUTE, 'Oral'), colX[3], rowY, { lineBreak: false });
    doc.text(safe(item.FREQUENCY), colX[4], rowY, { lineBreak: false });
    doc.text(safe(item.DURATION), colX[5], rowY, { lineBreak: false });
    doc.text(safe(item.INSTRUCTIONS), colX[6], rowY, { lineBreak: false, width: 85 });
    doc.y = rowY + 18;
  });

  doc.moveDown(1);

  // ── QR Code ────────────────────────────────────────────────────
  try {
    const qrBuffer = await QRCode.toBuffer(`HMS-PRESC-${prescriptionId}`, { width: 80 });
    const qrY = doc.y;
    doc.image(qrBuffer, 460, qrY, { width: 70 });
    doc.fontSize(7).font('Helvetica').fillColor('#888888')
      .text('Scan to verify', 462, qrY + 72);
  } catch (e) {
    // QR generation failed silently
  }

  // ── Signature ──────────────────────────────────────────────────
  const sigY = doc.page.height - 100;
  doc.moveTo(380, sigY).lineTo(MARGIN + CONTENT, sigY).lineWidth(0.5).strokeColor('#999999').stroke();
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
    .text(`Dr. ${safe(data.DOCTOR_NAME)}`, 380, sigY + 5);
  doc.fontSize(8).font('Helvetica').fillColor('#888888')
    .text(safe(data.DOCTOR_DEPT, 'General Medicine'), 380, sigY + 18);
  doc.text('Authorised Signatory', 380, sigY + 30);

  // Footer
  doc.fontSize(7).font('Helvetica').fillColor('#aaaaaa')
    .text('This is a computer-generated prescription', MARGIN, sigY + 30, { align: 'left' });

  doc.end();
}

// ═══════════════════════════════════════════════════════════════
//  OPD BILL PDF
// ═══════════════════════════════════════════════════════════════

async function generateOPDBillPDF(billId, res) {
  const hosp = await getHospitalProfile();

  // Fetch bill
  const [bills] = await sequelize.query(`
    SELECT b.*, p.NAME as PATIENT_NAME, p.UHID, p.AGE, p.GENDER, p.PHONENUMBER as PATIENT_PHONE,
           u.NAME as CREATED_BY_NAME
    FROM HMS_BILLS b
    JOIN HMS_PATIENTS p ON p.ID = b.PATIENT_ID
    LEFT JOIN HMS_USERS u ON u.ID = b.CREATED_BY
    WHERE b.ID = :billId
  `, { replacements: { billId } });

  if (bills.length === 0) {
    return res.status(404).json({ success: false, message: 'Bill not found' });
  }
  const bill = uppercaseKeys(bills[0]);

  let [items] = await sequelize.query(`SELECT * FROM HMS_BILL_ITEMS WHERE BILL_ID = :billId`, { replacements: { billId } });
  items = items.map(uppercaseKeys);
  let [payments] = await sequelize.query(
    `SELECT py.*, u.NAME as RECEIVED_BY_NAME FROM HMS_PAYMENTS py LEFT JOIN HMS_USERS u ON u.ID = py.RECEIVED_BY WHERE py.BILL_ID = :billId ORDER BY py.PAYMENT_DATE`,
    { replacements: { billId } }
  );
  payments = payments.map(uppercaseKeys);

  // ── PDF setup ──────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 40, size: 'A4' });
  const MARGIN = 40;
  const PW = doc.page.width;
  const CONTENT = PW - MARGIN * 2;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="bill-${billId}.pdf"`);
  doc.pipe(res);

  // ── Letterhead ─────────────────────────────────────────────────
  drawLetterhead(doc, hosp, MARGIN, CONTENT);

  // ── Title ──────────────────────────────────────────────────────
  doc.moveDown(0.5);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#0f4c81')
    .text('BILL / RECEIPT', MARGIN, doc.y, { align: 'center', width: CONTENT });
  doc.moveDown(0.5);

  // ── Bill + Patient Info ────────────────────────────────────────
  doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
  doc.text(`Bill No: ${safe(bill.BILL_NUMBER)}`, MARGIN, doc.y);
  const billDate = bill.CREATED_AT ? new Date(bill.CREATED_AT).toLocaleDateString('en-IN') : '';
  doc.text(`Date: ${billDate}`, 350, doc.y - 12, { lineBreak: false });
  doc.moveDown(0.3);

  doc.fontSize(10).font('Helvetica').fillColor('#333333');
  doc.text(`Patient: ${safe(bill.PATIENT_NAME)} (${safe(bill.UHID)})`, MARGIN, doc.y);
  doc.text(`Age: ${safe(bill.AGE)}Y / ${safe(bill.GENDER)}   Ph: ${safe(bill.PATIENT_PHONE)}`, MARGIN, doc.y);
  doc.moveDown(0.5);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // ── Items table ────────────────────────────────────────────────
  const tblCols = [MARGIN, MARGIN + 25, MARGIN + 150, MARGIN + 300, MARGIN + 340, MARGIN + 400, MARGIN + 450];
  const tblHeaders = ['#', 'Service / Description', 'Type', 'Qty', 'Rate', 'GST', 'Amount'];

  doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000');
  tblHeaders.forEach((h, i) => doc.text(h, tblCols[i], doc.y, { lineBreak: false }));
  doc.moveDown(0.4);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT, doc.y).lineWidth(0.3).strokeColor('#cccccc').stroke();
  doc.moveDown(0.3);

  items.forEach((item, idx) => {
    const rowY = doc.y;
    if (idx % 2 === 0) doc.rect(MARGIN, rowY - 2, CONTENT, 16).fill('#fafafa');
    doc.fontSize(9).font('Helvetica').fillColor('#333333');
    doc.text(String(idx + 1), tblCols[0], rowY, { lineBreak: false });
    doc.text(safe(item.ITEM_NAME), tblCols[1], rowY, { lineBreak: false, width: 145 });
    doc.text(safe(item.ITEM_TYPE), tblCols[2], rowY, { lineBreak: false });
    doc.text(String(item.QUANTITY || 1), tblCols[3], rowY, { lineBreak: false });
    doc.text(`${Number(item.RATE || 0).toFixed(0)}`, tblCols[4], rowY, { lineBreak: false });
    doc.text('-', tblCols[5], rowY, { lineBreak: false });
    doc.font('Helvetica-Bold').text(`${Number(item.AMOUNT || 0).toFixed(2)}`, tblCols[6], rowY, { lineBreak: false });
    doc.y = rowY + 18;
  });

  doc.moveDown(0.5);
  doc.moveTo(MARGIN, doc.y).lineTo(MARGIN + CONTENT, doc.y).lineWidth(0.5).strokeColor('#cccccc').stroke();
  doc.moveDown(0.5);

  // ── Summary ────────────────────────────────────────────────────
  const sumX = 350;
  const valX = 470;

  const drawSummaryRow = (label, value, bold) => {
    doc.fontSize(10).font(bold ? 'Helvetica-Bold' : 'Helvetica').fillColor('#333333');
    doc.text(label, sumX, doc.y, { lineBreak: false });
    doc.text(value, valX, doc.y, { lineBreak: false, align: 'right', width: 85 });
    doc.moveDown(0.4);
  };

  drawSummaryRow('Subtotal:', `${Number(bill.TOTAL_AMOUNT || 0).toFixed(2)}`);
  if (Number(bill.GST_AMOUNT) > 0) drawSummaryRow('GST:', `${Number(bill.GST_AMOUNT).toFixed(2)}`);
  if (Number(bill.DISCOUNT_AMOUNT) > 0) drawSummaryRow('Discount:', `- ${Number(bill.DISCOUNT_AMOUNT).toFixed(2)}`);
  if (Number(bill.ADVANCE_ADJUSTED) > 0) drawSummaryRow('Advance Adj:', `- ${Number(bill.ADVANCE_ADJUSTED).toFixed(2)}`);

  doc.moveTo(sumX, doc.y).lineTo(MARGIN + CONTENT, doc.y).lineWidth(1).strokeColor('#0f4c81').stroke();
  doc.moveDown(0.3);
  drawSummaryRow('Net Payable:', `Rs. ${Number(bill.NET_PAYABLE || 0).toFixed(2)}`, true);

  // ── Payments ───────────────────────────────────────────────────
  if (payments.length > 0) {
    doc.moveDown(0.5);
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#0f4c81')
      .text('Payment Details', MARGIN, doc.y);
    doc.moveDown(0.3);

    payments.forEach(py => {
      const pyDate = py.PAYMENT_DATE ? new Date(py.PAYMENT_DATE).toLocaleDateString('en-IN') : '';
      doc.fontSize(9).font('Helvetica').fillColor('#333333');
      doc.text(`${safe(py.PAYMENT_MODE)} - Rs. ${Number(py.AMOUNT).toFixed(2)} | Receipt: ${safe(py.RECEIPT_NUMBER)} | ${pyDate}`, MARGIN, doc.y);
      doc.moveDown(0.2);
    });

    const totalPaid = payments.reduce((s, p) => s + Number(p.AMOUNT || 0), 0);
    const balance = Number(bill.NET_PAYABLE || 0) - totalPaid;
    doc.moveDown(0.3);
    doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
    doc.text(`Total Paid: Rs. ${totalPaid.toFixed(2)}`, MARGIN, doc.y);
    if (balance > 0) {
      doc.fillColor('#c0392b').text(`Balance Due: Rs. ${balance.toFixed(2)}`, 300, doc.y - 12, { lineBreak: false });
    }
  }

  // ── Footer ─────────────────────────────────────────────────────
  const footY = doc.page.height - 90;
  doc.moveTo(MARGIN, footY).lineTo(MARGIN + CONTENT, footY).lineWidth(0.3).strokeColor('#cccccc').stroke();

  doc.fontSize(8).font('Helvetica').fillColor('#888888');
  if (bill.CREATED_BY_NAME) {
    doc.text(`Cashier: ${safe(bill.CREATED_BY_NAME)}`, MARGIN, footY + 8);
  }
  doc.text('Thank you for choosing City General Hospital', MARGIN, footY + 22, { align: 'center', width: CONTENT });

  doc.moveTo(380, footY + 8).lineTo(MARGIN + CONTENT, footY + 8).lineWidth(0.3).strokeColor('#999999').stroke();
  doc.fontSize(9).font('Helvetica-Bold').fillColor('#333333')
    .text('Authorised Signatory', 390, footY + 12);

  doc.end();
}

// ═══════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════

router.get('/prescription/:id', protect, async (req, res) => {
  try {
    await generatePrescriptionPDF(req.params.id, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

router.get('/bill/:id', protect, async (req, res) => {
  try {
    await generateOPDBillPDF(req.params.id, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.status(500).json({ success: false, message: err.message });
    }
  }
});

module.exports = router;
