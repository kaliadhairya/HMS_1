const express = require('express');
const router = express.Router();
const PDFDocument = require('pdfkit');
const TestReport = require('../models/TestReport');
const Patient = require('../models/Patient');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const path = require('path');
const fs = require('fs');

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip any non-printable / encoding-broken characters from a value */
const safe = (val, fallback = '—') => {
  if (val === null || val === undefined) return fallback;
  return String(val)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')   // strip broken Unicode/encoding artifacts
    .trim() || fallback;
};

/** Return a trimmed result string, or empty string if blank / dash */
const getResult = (val) => {
  const s = safe(val, '');
  return s === '—' ? '' : s;
};

// ─── PUT /api/reports/:id — Save test results ────────────────────────────────
router.put('/:id', protect, async (req, res) => {
  try {
    const report = await TestReport.findByPk(req.params.id);
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });

    const { haematology, biochemistry, serology, urine, other, remarks, suggestions, status } = req.body;

    if (haematology) report.haematology = { ...report.haematology, ...haematology };
    if (biochemistry) report.biochemistry = { ...report.biochemistry, ...biochemistry };
    if (serology) report.serology = { ...report.serology, ...serology };
    if (urine) report.urine = { ...report.urine, ...urine };
    if (other) report.other = { ...report.other, ...other };
    if (remarks !== undefined) report.remarks = remarks;
    if (suggestions !== undefined) report.suggestions = suggestions;
    if (status) report.status = status;

    report.reportedBy = req.user.id;
    report.reportDate = new Date();

    report.changed('haematology', true);
    report.changed('biochemistry', true);
    report.changed('serology', true);
    report.changed('urine', true);
    report.changed('other', true);

    await report.save();
    res.json({ success: true, message: 'Report saved.', report });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/reports/:id — Fetch a single report ───────────────────────────
router.get('/:id', protect, async (req, res) => {
  try {
    const report = await TestReport.findByPk(req.params.id, {
      include: [
        { model: Patient, as: 'patient', foreignKey: 'patientId' },
        { model: User, as: 'reportedByUser', attributes: ['name', 'role'], foreignKey: 'reportedBy' },
      ],
    });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });

    const result = report.toJSON();
    result.patient = result.patient || null;
    result.reportedBy = result.reportedByUser || null;

    res.json({ success: true, report: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

// ─── GET /api/reports/ordered-queue — Fetch Doctor ordered investigations ─────
router.get('/ordered-queue', protect, async (req, res) => {
  try {
    const { InvestigationOrder, InvestigationOrderItem } = require('../models');
    
    const orders = await InvestigationOrder.findAll({
      where: { status: ['Pending', 'In Progress'] },
      order: [
        ['priority', 'DESC'],
        ['order_date', 'ASC']
      ],
      include: [
        { model: Patient, as: 'patient', attributes: ['id', 'name', 'uhid'] },
        { model: User, as: 'doctor', attributes: ['id', 'name'] },
        { model: InvestigationOrderItem, as: 'items', attributes: ['test_name', 'department', 'status'] }
      ]
    });
    
    res.json(orders);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error fetching ordered queue.' });
  }
});

// ─── GET /api/reports/:id/pdf — Generate PDF ────────────────────────────────
router.get('/:id/pdf', protect, async (req, res) => {
  try {
    const report = await TestReport.findByPk(req.params.id, {
      include: [
        { model: Patient, as: 'patient', foreignKey: 'patientId' },
        { model: User, as: 'reportedByUser', attributes: ['name', 'role'], foreignKey: 'reportedBy' },
      ],
    });
    if (!report) return res.status(404).json({ success: false, message: 'Report not found.' });

    const patient = report.patient;
    if (!patient) return res.status(400).json({ success: false, message: 'No patient linked to this report.' });

    const reportedBy = report.reportedByUser;

    // ── PDF setup ──────────────────────────────────────────────────────────
    const doc = new PDFDocument({ margin: 40, size: 'A4', bufferPages: true });

    res.setHeader('Content-Type', 'application/pdf');
    const filename = `lab-report-${safe(patient.name, 'report').replace(/\s+/g, '-')}.pdf`;
    const disposition = req.query.preview === 'true' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
    doc.pipe(res);

    // ── Page dimensions ────────────────────────────────────────────────────
    const PW = doc.page.width;   // 595
    const PH = doc.page.height;  // 842
    const MARGIN = 40;
    const CONTENT = PW - MARGIN * 2;  // 515
    const FOOTER_H = 30;
    const FOOTER_Y = PH - FOOTER_H;
    const SAFE_BTM = PH - FOOTER_H - 20; // content must stay above this

    // ── Footer ─────────────────────────────────────────────────────────────
    const drawFooterBand = () => {
      // save & restore margins so pdfkit doesn't auto-paginate inside footer
      const savedBottom = doc.page.margins.bottom;
      doc.page.margins.bottom = 0;

      doc
        .moveTo(0, FOOTER_Y - 2)
        .lineTo(PW, FOOTER_Y - 2)
        .lineWidth(2)
        .strokeColor('#0f4c81')
        .stroke();

      doc.rect(0, FOOTER_Y, PW, FOOTER_H).fill('#0f4c81');

      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#ffffff')
        .text('CITY GENERAL HOSPITAL', 0, FOOTER_Y + 9, {
          align: 'center',
          width: PW,
          lineBreak: false,
        });

      doc.page.margins.bottom = savedBottom;
    };

    // ── Header ─────────────────────────────────────────────────────────────
    const drawHeader = () => {
      doc.y = 30;

      // Logo
      const logoPath = path.join(__dirname, '../../frontend/public/logo.png');
      if (fs.existsSync(logoPath)) {
        doc.image(logoPath, MARGIN, 20, { width: 60 });
      }

      // Hospital name block
      doc.fontSize(22).font('Helvetica-Bold').fillColor('#0f4c81').text('CITY GENERAL HOSPITAL', 110, 22);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000').text('METROPOLITAN HEALTHCARE DIVISION', 110, 48);
      doc.fontSize(9).font('Helvetica').fillColor('#555555').text('Accurate | Caring | Instant', 110, 63);

      // Contact — plain ASCII only, no special prefix chars
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#555555');
      doc.text('Ph: 01887-220000', 400, 30, { lineBreak: false });
      doc.text('Email: hospital@citygeneral.com', 400, 44, { lineBreak: false });

      // Blue rule
      doc.rect(MARGIN, 80, CONTENT, 5).fill('#0f4c81');

      // Patient info block
      const INFO_Y = 95;
      doc.fontSize(13).font('Helvetica-Bold').fillColor('#000000')
        .text(safe(patient.name), MARGIN, INFO_Y);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333');
      doc.text(`Age : ${safe(patient.age)} Years`, MARGIN, INFO_Y + 18);
      doc.text(`Sex : ${safe(patient.gender)}`, MARGIN, INFO_Y + 30);

      const pidValue = patient.patientType === 'corporate_employee'
        ? safe(patient.empNumber, '-')
        : safe(patient.phoneNumber, '-');
      doc.text(`PID : ${pidValue}`, MARGIN, INFO_Y + 42);

      // Dividers
      doc.moveTo(200, INFO_Y).lineTo(200, INFO_Y + 52).lineWidth(1).strokeColor('#cccccc').stroke();

      const patientTypeLabel = (patient.patientType === 'corporate_employee') ? 'Corporate Entitled' : 'Non-Entitled';
      const wardOpd = patient.opdIndoor === 'Indoor'
        ? `Indoor (${safe(patient.ward)})`
        : 'OPD';

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Patient Type:', 215, INFO_Y + 18);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333').text(patientTypeLabel, 290, INFO_Y + 18);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Type:', 215, INFO_Y + 30);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333').text(wardOpd, 290, INFO_Y + 30);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Diagnosis:', 215, INFO_Y + 42);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333').text(safe(patient.provDiagnosis, '—'), 290, INFO_Y + 42);

      doc.moveTo(380, INFO_Y).lineTo(380, INFO_Y + 52).lineWidth(1).strokeColor('#cccccc').stroke();

      const testDateStr = patient.testDate ? new Date(patient.testDate).toLocaleDateString('en-IN') : '—';
      const reportDateStr = report.reportDate ? new Date(report.reportDate).toLocaleDateString('en-IN') : '—';

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Test Date:', 395, INFO_Y + 18);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333').text(testDateStr, 460, INFO_Y + 18);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000').text('Report Date:', 395, INFO_Y + 30);
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333').text(reportDateStr, 460, INFO_Y + 30);

      // Section rules + column headers
      doc.moveTo(MARGIN, 160).lineTo(555, 160).lineWidth(1).strokeColor('#cccccc').stroke();

      doc.fontSize(14).font('Helvetica-Bold').fillColor('#000000')
        .text('LAB INVESTIGATION REPORT', MARGIN, 165, { align: 'center', width: CONTENT });

      doc.moveTo(MARGIN, 185).lineTo(555, 185).lineWidth(1).strokeColor('#cccccc').stroke();

      doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000');
      doc.text('Investigation', MARGIN, 195);
      doc.text('Result', 240, 195);
      doc.text('Reference Value', 350, 195);

      doc.moveTo(MARGIN, 210).lineTo(555, 210).lineWidth(1).strokeColor('#cccccc').stroke();

      doc.y = 220;
    };

    // Register page-added hook (fires for every new page)
    doc.on('pageAdded', () => {
      drawHeader();
      drawFooterBand();
      doc.y = 220;
    });

    // Draw first page
    drawHeader();
    drawFooterBand();
    doc.y = 220;

    // ── Section renderer ───────────────────────────────────────────────────
    const drawSection = (title, rowsData) => {
      // Filter: keep subheaders that have at least one child with a real result,
      // and keep data rows that have a non-empty result.
      const validRows = rowsData.filter(r =>
        r.isSubheader || (r.result != null && getResult(r.result) !== '')
      );

      // Drop orphan subheaders
      const finalRows = [];
      for (let i = 0; i < validRows.length; i++) {
        if (validRows[i].isSubheader) {
          let hasChild = false;
          for (let j = i + 1; j < validRows.length; j++) {
            if (validRows[j].isSubheader) break;
            hasChild = true;
            break;
          }
          if (hasChild) finalRows.push(validRows[i]);
        } else {
          finalRows.push(validRows[i]);
        }
      }
      if (finalRows.length === 0) return;

      if (doc.y + 40 > SAFE_BTM) doc.addPage();

      doc.moveDown(0.5);
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
        .text(title.toUpperCase(), MARGIN, doc.y);
      doc.moveDown(0.3);

      finalRows.forEach(r => {
        const labelH = doc.heightOfString(r.label, { width: 180, fontSize: 10 });
        const normalH = r.normal
          ? doc.heightOfString(String(r.normal).replace(/\\n/g, '\n'), { width: 190, fontSize: 10 })
          : 12;
        const rowH = Math.max(labelH, normalH) + 6;

        if (doc.y + rowH > SAFE_BTM) {
          doc.addPage();
          doc.moveDown(0.5);
          doc.fontSize(12).font('Helvetica-Bold').fillColor('#000000')
            .text(`${title.toUpperCase()} (Continued)`, MARGIN, doc.y);
          doc.moveDown(0.3);
        }

        const y = doc.y;

        if (r.isSubheader) {
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#222222')
            .text(r.label, MARGIN, y + 2, { lineBreak: false });
        } else {
          const indent = r.indent ? 10 : 0;
          doc.fontSize(10).font('Helvetica-Bold').fillColor('#333333')
            .text(r.label, MARGIN + indent, y + 2, { lineBreak: false });

          const resultStr = getResult(r.result);
          if (resultStr) {
            doc.fontSize(10).font('Helvetica-Bold').fillColor('#000000')
              .text(resultStr, 240, y + 2, { lineBreak: false });
          }

          if (r.normal) {
            doc.fontSize(10).font('Helvetica').fillColor('#333333')
              .text(String(r.normal).replace(/\\n/g, '\n'), 350, y + 2, { width: 190 });
          }
        }

        doc.y = y + rowH;
      });
    };

    // ── Widal renderer ────────────────────────────────────────────────────
    const drawWidal = (w) => {
      const getW = (k) => {
        const v = w[k]?.result;
        if (v == null) return '';
        const s = safe(v, '');
        return s === '—' ? '' : s;
      };
      const hasAny = Object.keys(w).some(k => getW(k) !== '');
      if (!hasAny) return;

      if (doc.y + 120 > SAFE_BTM) doc.addPage();
      else doc.y += 10;

      doc.moveDown(0.5);
      doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
        .text('WIDAL TEST', MARGIN, doc.y);

      let y = doc.y + 18;
      const cols = [180, 240, 300, 360, 420];

      doc.fontSize(8).font('Helvetica-Bold').fillColor('#333333');
      doc.text('Dilution ->', 100, y, { lineBreak: false });
      ['1/20', '1/40', '1/80', '1/160', '1/320'].forEach((lbl, i) => {
        doc.text(lbl, cols[i], y, { lineBreak: false });
      });
      y += 18;

      ['TO', 'TH', 'AH', 'BH'].forEach(ab => {
        const key = ab.toLowerCase();
        doc.font('Helvetica-Bold').fillColor('#000000').fontSize(8)
          .text(ab, MARGIN, y, { lineBreak: false });
        doc.font('Helvetica').fillColor('#555555');
        [`${key}_1_20`, `${key}_1_40`, `${key}_1_80`, `${key}_1_160`, `${key}_1_320`]
          .forEach((k, i) => {
            doc.text(getW(k) || '-', cols[i], y, { lineBreak: false });
          });
        y += 14;
      });

      doc.y = y;
    };

    // ── Row definitions ────────────────────────────────────────────────────
    const h = report.haematology || {};
    const b = report.biochemistry || {};
    const l = b.lft || {};
    const lip = b.lipidogram || {};
    const s = report.serology || {};
    const w = s.widal || {};
    const u = report.urine || {};
    const o = report.other || {};

    const haematologyRows = [
      { label: 'Hb', result: h.hb?.result, normal: 'M : 12-16 gm%  /  F : 10-14 gm%' },
      { label: 'TLC', result: h.tlc?.result, normal: '4000-11000/CMM' },
      { label: 'DLC', isSubheader: true },
      { label: 'Neutrophil', result: h.dlc?.neutrophil?.result, normal: '40-75%', indent: true },
      { label: 'Polymorphs', result: h.dlc?.polymorphs?.result, indent: true },
      { label: 'Lymphocytes', result: h.dlc?.lymphocytes?.result, normal: '20-40 %', indent: true },
      { label: 'Eosinophils', result: h.dlc?.eosinophils?.result, normal: '1-6 %', indent: true },
      { label: 'Monocytes', result: h.dlc?.monocytes?.result, normal: '2-5 %', indent: true },
      { label: 'Basophils', result: h.dlc?.basophils?.result, normal: '0-1 %', indent: true },
      { label: 'E.S.R.', result: h.esr?.result, normal: '0-20 mm 1st Hr' },
      { label: 'B.T.', result: h.bt?.result, normal: '1-5 Minutes' },
      { label: 'C.T.', result: h.ct?.result, normal: '2-6 Minutes' },
      { label: 'M.P.', result: h.mp?.result },
    ];

    const bioChemistryRows = [
      { label: 'F.B.S.', result: b.fbs?.result, normal: '70-110 mg/dl' },
      { label: 'P.P.B.S.', result: b.ppbs?.result, normal: '150 mg/dl' },
      { label: 'R.B.S.', result: b.rbs?.result, normal: '90-140 mg/dl' },
      { label: 'R.F.T.', isSubheader: true },
      { label: 'Blood Urea', result: b.bloodUrea?.result, normal: '13-45 mg%', indent: true },
      { label: 'S. Creatinine', result: b.sCreatinine?.result, normal: 'M : 0.7-1.4 mg/dl  /  F : 0.6-1.20 mg/dl', indent: true },
      { label: 'S. Uric Acid', result: b.sUricAcid?.result, normal: 'M : 3.5-7.2 mg/dl  /  F : 2.5-6.2 mg/dl', indent: true },
      { label: 'S. Alk. Phosphatase', result: b.sAlkPhosphatase?.result, normal: '15-112 U/L' },
      { label: 'S. Calcium', result: b.sCalcium?.result, normal: '8.4-10.4 mg/dl' },
      { label: 'S. Amylase', result: b.sAmylase?.result, normal: '20-115 U/L' },
      { label: 'L.F.T.', isSubheader: true },
      { label: 'S. Bilirubin', result: l.sBilirubin?.result, normal: '0.1-1.2 mEq/L', indent: true },
      { label: 'S. Proteins', result: l.sProteins?.result, normal: '6.0-8.3 g/dl', indent: true },
      { label: 'S. Albumin', result: l.sAlbumin?.result, normal: '3.2-5.0 g/dl', indent: true },
      { label: 'S. Globulin', result: l.sGlobulin?.result, indent: true },
      { label: 'SGOT', result: l.sgot?.result, normal: '5-34 U/L' },
      { label: 'SGPT', result: l.sgpt?.result, normal: '0-40 U/L' },
      { label: 'LIPIDOGRAM', isSubheader: true },
      { label: 'S. Cholesterol', result: lip.sCholesterol?.result, normal: '140-250 mg/dl', indent: true },
      { label: 'HDL', result: lip.hdl?.result, normal: 'M : 30-65 mg/dl  /  F : 35-80 mg/dl', indent: true },
      { label: 'LDL', result: lip.ldl?.result, normal: '150-190 mg/dl', indent: true },
      { label: 'VLDL', result: lip.vldl?.result, normal: '15-45 mg/dl', indent: true },
      { label: 'Total Lipids', result: lip.totalLipids?.result, normal: '400-700 mg/dl', indent: true },
      { label: 'S. Triglycerides', result: lip.sTriglycerides?.result, normal: '25-160 mg/dl', indent: true },
    ];

    const serologyRows = [
      { label: 'Blood Group', result: s.bloodGroup?.result },
      { label: 'Rh', result: s.rh?.result },
      { label: 'V.D.R.L.', result: s.vdrl?.result },
      { label: 'H.I.V.', result: s.hiv?.result },
      { label: 'R.A. Factor', result: s.raFactor?.result },
      { label: 'HBsAg', result: s.hbsAg?.result },
      { label: 'C.R.P.', result: s.crp?.result },
      { label: 'ASO Titre', result: s.asoTitre?.result },
      { label: "Coomb's", result: s.coombs?.result },
      { label: 'Toxoplasmosis', result: s.toxoplasmosis?.result },
      { label: 'Mantoux', result: s.mantoux?.result },
    ];

    const urineRows = [
      { label: 'Sugar', result: u.sugar?.result },
      { label: 'Albumin', result: u.albumin?.result },
      { label: 'Bile Pigments', result: u.bilePigments?.result },
      { label: 'Bile Salts', result: u.bileSalts?.result },
      { label: 'Urobilinogen', result: u.urobilinogen?.result },
      { label: 'Ketones', result: u.ketones?.result },
      { label: 'M/E', result: u.me?.result },
      { label: 'C/S', result: o.cs?.result },
      { label: 'Pregnancy', result: o.pregnancy?.result },
      { label: 'Stool', isSubheader: true },
      { label: 'Ova', result: o.stool?.ova?.result, indent: true },
      { label: 'Cyst', result: o.stool?.cyst?.result, indent: true },
    ];

    // ── Render all sections ────────────────────────────────────────────────
    doc.y += 10;
    drawSection('Haematology', haematologyRows);
    drawSection('Bio-Chemistry', bioChemistryRows);
    drawSection('Serology', serologyRows);
    drawWidal(w);
    drawSection('Urine / Others', urineRows);

    // ── Remarks / Suggestions ─────────────────────────────────────────────
    if (report.remarks || report.suggestions) {
      doc.moveDown(1);
      if (report.remarks) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Remarks:', MARGIN, doc.y);
        doc.moveDown(0.2);
        doc.fontSize(8).font('Helvetica').fillColor('#555555')
          .text(safe(report.remarks), MARGIN, doc.y, { width: CONTENT });
        doc.moveDown(0.5);
      }
      if (report.suggestions) {
        doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000').text('Suggestions:', MARGIN, doc.y);
        doc.moveDown(0.2);
        doc.fontSize(8).font('Helvetica').fillColor('#555555')
          .text(safe(report.suggestions), MARGIN, doc.y, { width: CONTENT });
      }
    }

    // ── End of report + signatures ────────────────────────────────────────
    if (doc.y + 60 > SAFE_BTM) doc.addPage();
    else doc.moveDown(2);

    doc.fontSize(8).font('Helvetica-Bold').fillColor('#000000')
      .text('*** End of Report ***', MARGIN, doc.y, { align: 'center', width: CONTENT });

    const signY = PH - 80;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
      .text('Medical Lab Technician', MARGIN, signY);
    doc.fontSize(7).font('Helvetica').fillColor('#555555')
      .text('(Hospital Authority)', MARGIN, signY + 12);

    doc.fontSize(9).font('Helvetica-Bold').fillColor('#000000')
      .text('Pathologist / Doctor', 420, signY);
    doc.fontSize(7).font('Helvetica').fillColor('#555555')
      .text(`Reported By: ${safe(reportedBy?.name, '-')}`, 420, signY + 12);

    doc.end();

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.stack || err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  PART C — ANALYTICS REPORT ENDPOINTS
//  (Appended below existing lab report code — DO NOT TOUCH ABOVE)
// ═══════════════════════════════════════════════════════════════

// ── GET /api/reports/opd-register ──────────────────────────────
const { clobToString } = require('../utils/clobToString');

router.get('/opd-register', protect, async (req, res) => {
  try {
    const { start_date, end_date, doctor_id, department } = req.query;
    const exportType = req.query.export;

    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }

    const replacements = { start_date, end_date };
    let doctorFilter = '';
    let deptFilter = '';
    if (doctor_id) { doctorFilter = 'AND e.DOCTOR_ID = :doctor_id'; replacements.doctor_id = doctor_id; }
    if (department) { deptFilter = "AND (dep.NAME = :department OR CAST(e.DEPARTMENT_ID AS TEXT) = :department)"; replacements.department = department; }

    const [rows] = await sequelize.query(`
      SELECT e.ID, t.TOKEN_NUMBER, p.NAME as PATIENT_NAME, p.UHID,
             p.AGE, p.GENDER, COALESCE(dep.NAME, 'General') as DEPARTMENT,
             u.NAME as DOCTOR_NAME,
             e.CHIEF_COMPLAINT, e.ENCOUNTER_DATE,
             b.NET_PAYABLE as FEE,
             (SELECT string_agg(d.ICD10_DESCRIPTION, ', ')
              FROM HMS_DIAGNOSES d WHERE d.ENCOUNTER_ID = e.ID) as DIAGNOSES
      FROM HMS_ENCOUNTERS e
      JOIN HMS_PATIENTS p ON p.ID = e.PATIENT_ID
      JOIN HMS_USERS u ON u.ID = e.DOCTOR_ID
      LEFT JOIN HMS_DEPARTMENTS dep ON dep.ID = e.DEPARTMENT_ID
      LEFT JOIN HMS_TOKENS t ON t.ID = e.TOKEN_ID
      LEFT JOIN HMS_BILLS b ON b.ENCOUNTER_ID = e.ID AND b.BILL_TYPE = 'OPD'
      WHERE trunc(e.ENCOUNTER_DATE) BETWEEN trunc(TO_DATE(:start_date,'YYYY-MM-DD'))
                                        AND trunc(TO_DATE(:end_date,'YYYY-MM-DD'))
      AND e.STATUS = 'Finalized'
      ${doctorFilter}
      ${deptFilter}
      ORDER BY e.ENCOUNTER_DATE DESC
    `, { replacements });

    // Process CLOB fields
    for (let r of rows) {
      if (r.CHIEF_COMPLAINT) r.CHIEF_COMPLAINT = await clobToString(r.CHIEF_COMPLAINT);
      if (r.DIAGNOSES) r.DIAGNOSES = await clobToString(r.DIAGNOSES);
    }

    if (exportType === 'excel') {
      const ExcelJS = require('exceljs');
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('OPD Register');
      sheet.columns = [
        { header: 'Date', key: 'date', width: 14 },
        { header: 'Token', key: 'token', width: 10 },
        { header: 'UHID', key: 'uhid', width: 15 },
        { header: 'Patient', key: 'patient', width: 25 },
        { header: 'Age', key: 'age', width: 8 },
        { header: 'Gender', key: 'gender', width: 10 },
        { header: 'Doctor', key: 'doctor', width: 22 },
        { header: 'Department', key: 'dept', width: 18 },
        { header: 'Complaint', key: 'complaint', width: 30 },
        { header: 'Diagnoses', key: 'diagnoses', width: 40 },
        { header: 'Fee', key: 'fee', width: 10 },
      ];
      rows.forEach(r => {
        sheet.addRow({
          date: r.ENCOUNTER_DATE ? new Date(r.ENCOUNTER_DATE).toLocaleDateString('en-IN') : '',
          token: r.TOKEN_NUMBER || '', uhid: r.UHID, patient: r.PATIENT_NAME,
          age: r.AGE, gender: r.GENDER, doctor: r.DOCTOR_NAME,
          dept: r.DEPARTMENT, complaint: r.CHIEF_COMPLAINT || '',
          diagnoses: r.DIAGNOSES || '', fee: r.FEE || 0
        });
      });
      // Style header row
      sheet.getRow(1).font = { bold: true };

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename=opd-register.xlsx');
      const buffer = await workbook.xlsx.writeBuffer();
      return res.send(buffer);
    }

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate OPD register' });
  }
});

// ── GET /api/reports/revenue ───────────────────────────────────
router.get('/revenue', protect, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }
    const replacements = { start_date, end_date };

    // Query 1: Totals
    const [totals] = await sequelize.query(`
      SELECT SUM(b.TOTAL_AMOUNT) as TOTAL_BILLED,
             SUM(b.NET_PAYABLE) as TOTAL_PAYABLE,
             SUM(COALESCE(paid.TOTAL_PAID,0)) as TOTAL_COLLECTED,
             SUM(b.NET_PAYABLE) - SUM(COALESCE(paid.TOTAL_PAID,0)) as OUTSTANDING
      FROM HMS_BILLS b
      LEFT JOIN (SELECT BILL_ID, SUM(AMOUNT) as TOTAL_PAID FROM HMS_PAYMENTS GROUP BY BILL_ID) paid
        ON paid.BILL_ID = b.ID
      WHERE trunc(b.CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      AND b.STATUS != 'Cancelled'
    `, { replacements });

    // Query 2: By payment mode
    const [byMode] = await sequelize.query(`
      SELECT PAYMENT_MODE, SUM(AMOUNT) as TOTAL
      FROM HMS_PAYMENTS
      WHERE trunc(PAYMENT_DATE) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      GROUP BY PAYMENT_MODE
    `, { replacements });

    // Query 3: Daily collection
    const [dailyCollection] = await sequelize.query(`
      SELECT trunc(PAYMENT_DATE) as DATE_VAL, SUM(AMOUNT) as DAILY_TOTAL
      FROM HMS_PAYMENTS
      WHERE trunc(PAYMENT_DATE) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      GROUP BY trunc(PAYMENT_DATE)
      ORDER BY DATE_VAL
    `, { replacements });

    // Query 4: By department
    const [byDepartment] = await sequelize.query(`
      SELECT e.DEPARTMENT, SUM(b.NET_PAYABLE) as REVENUE
      FROM HMS_BILLS b
      JOIN HMS_ENCOUNTERS e ON e.ID = b.ENCOUNTER_ID
      WHERE trunc(b.CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      GROUP BY e.DEPARTMENT
    `, { replacements });

    res.json({
      success: true,
      data: {
        totals: totals[0] || {},
        byMode,
        dailyCollection,
        byDepartment,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate revenue report' });
  }
});

// ── GET /api/reports/pharmacy-sales ────────────────────────────
router.get('/pharmacy-sales', protect, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }

    const [rows] = await sequelize.query(`
      SELECT m.GENERIC_NAME, m.CATEGORY, SUM(di.QUANTITY) as TOTAL_QTY,
             SUM(di.AMOUNT) as TOTAL_VALUE
      FROM HMS_DISPENSING_RECORDS dr
      JOIN HMS_DISPENSING_ITEMS di ON di.DISPENSING_RECORD_ID = dr.ID
      JOIN HMS_MEDICINES m ON m.ID = di.MEDICINE_ID
      WHERE trunc(dr.DISPENSED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      GROUP BY m.ID, m.GENERIC_NAME, m.CATEGORY
      ORDER BY TOTAL_VALUE DESC
    `, { replacements: { start_date, end_date } });

    res.json({ success: true, data: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate pharmacy sales report' });
  }
});

// ── GET /api/reports/lab-workload ──────────────────────────────
router.get('/lab-workload', protect, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'start_date and end_date are required' });
    }

    const [rows] = await sequelize.query(`
      SELECT io.STATUS, io.URGENCY,
             ioi.TEST_CATEGORY, ioi.ITEM_NAME,
             p.NAME as PATIENT_NAME,
             u.NAME as DOCTOR_NAME,
             io.CREATED_AT,
             ROUND((EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - io.CREATED_AT))/3600)::numeric, 1) as AGE_HOURS
      FROM HMS_INVESTIGATION_ORDERS io
      JOIN HMS_INVESTIGATION_ORDER_ITEMS ioi ON ioi.ORDER_ID = io.ID
      JOIN HMS_PATIENTS p ON p.ID = io.PATIENT_ID
      JOIN HMS_USERS u ON u.ID = io.DOCTOR_ID
      WHERE trunc(io.CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
      ORDER BY io.URGENCY DESC, io.CREATED_AT ASC
    `, { replacements: { start_date, end_date } });

    const totalOrdered = rows.length;
    const completed = rows.filter(r => r.STATUS === 'Completed').length;
    const pendingList = rows.filter(r => r.STATUS !== 'Completed');

    // By category
    const byCategory = {};
    rows.forEach(r => {
      const cat = r.TEST_CATEGORY || 'Other';
      byCategory[cat] = (byCategory[cat] || 0) + 1;
    });

    res.json({ success: true, data: { total_ordered: totalOrdered, total_completed: completed, pending_list: pendingList, by_category: byCategory } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to generate lab workload report' });
  }
});

// ── GET /api/reports/audit-trail ──────────────────────────────
router.get('/audit-trail', protect, async (req, res) => {
  try {
    const { start_date, end_date, user_id, module } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;

    const replacements = {};
    let dateFilter = '';
    let userFilter = '';
    let moduleFilter = '';

    if (start_date) { dateFilter += " AND trunc(a.CREATED_AT) >= trunc(TO_DATE(:start_date,'YYYY-MM-DD'))"; replacements.start_date = start_date; }
    if (end_date) { dateFilter += " AND trunc(a.CREATED_AT) <= trunc(TO_DATE(:end_date,'YYYY-MM-DD'))"; replacements.end_date = end_date; }
    if (user_id) { userFilter = ' AND a.USER_ID = :user_id'; replacements.user_id = user_id; }
    if (module) { moduleFilter = ' AND a.MODULE = :module'; replacements.module = module; }

    const [countResult] = await sequelize.query(`
      SELECT COUNT(*) as TOTAL FROM HMS_AUDIT_LOGS a WHERE 1=1 ${dateFilter} ${userFilter} ${moduleFilter}
    `, { replacements });
    const totalCount = countResult[0]?.TOTAL || 0;

    const [rows] = await sequelize.query(`
      SELECT a.ID, a.ACTION, a.MODULE, a.RECORD_ID, a.IP_ADDRESS, a.CREATED_AT,
             u.USERNAME, u.ROLE
      FROM HMS_AUDIT_LOGS a
      LEFT JOIN HMS_USERS u ON u.ID = a.USER_ID
      WHERE 1=1 ${dateFilter} ${userFilter} ${moduleFilter}
      ORDER BY a.CREATED_AT DESC
      LIMIT :limit OFFSET :offset
    `, { replacements: { ...replacements, limit, offset } });

    res.json({ success: true, data: rows, total_count: totalCount, page, total_pages: Math.ceil(totalCount / limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch audit trail' });
  }
});

// ── GET /api/reports/doctor-performance ────────────────────────
router.get('/doctor-performance', protect, async (req, res) => {
  try {
    const { doctor_id, start_date, end_date } = req.query;
    if (!doctor_id || !start_date || !end_date) {
      return res.status(400).json({ success: false, message: 'doctor_id, start_date, and end_date required' });
    }
    const replacements = { doctor_id, start_date, end_date };

    const [encounters] = await sequelize.query(`
      SELECT COUNT(*) as TOTAL FROM HMS_ENCOUNTERS
      WHERE DOCTOR_ID = :doctor_id
      AND trunc(ENCOUNTER_DATE) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
    `, { replacements });

    const [prescriptions] = await sequelize.query(`
      SELECT COUNT(*) as TOTAL FROM HMS_PRESCRIPTIONS
      WHERE DOCTOR_ID = :doctor_id
      AND trunc(CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
    `, { replacements });

    const [labOrders] = await sequelize.query(`
      SELECT COUNT(*) as TOTAL FROM HMS_INVESTIGATION_ORDERS
      WHERE DOCTOR_ID = :doctor_id
      AND trunc(CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
    `, { replacements });

    const [revenue] = await sequelize.query(`
      SELECT SUM(b.NET_PAYABLE) as TOTAL FROM HMS_BILLS b
      JOIN HMS_ENCOUNTERS e ON e.ID = b.ENCOUNTER_ID
      WHERE e.DOCTOR_ID = :doctor_id
      AND trunc(b.CREATED_AT) BETWEEN TO_DATE(:start_date,'YYYY-MM-DD') AND TO_DATE(:end_date,'YYYY-MM-DD')
    `, { replacements });

    res.json({
      success: true,
      data: {
        encounters: encounters[0]?.TOTAL || 0,
        prescriptions: prescriptions[0]?.TOTAL || 0,
        labOrders: labOrders[0]?.TOTAL || 0,
        revenue: revenue[0]?.TOTAL || 0,
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Failed to fetch doctor performance' });
  }
});

module.exports = router;
