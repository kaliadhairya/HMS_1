import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';

export default function RestFormPrintPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);

  useEffect(() => {
    api.get(`/hms/rest-forms/${id}`)
      .then(async (res) => {
        const d = res.data;
        setData(d);
        if (d.patient_id) {
          try {
            const pRes = await api.get(`/patients/${d.patient_id}`);
            const p = pRes.data.patient || pRes.data;
            setPatientInfo({
              name: p.name || p.NAME || d.patient_name || '',
              empNumber: p.empNumber || p.EMPNUMBER || d.emp_number || '',
              relationship: p.relationship || p.RELATIONSHIP || d.relationship || '',
            });
          } catch (e) {
            setPatientInfo({ name: d.patient_name || '', empNumber: d.emp_number || '', relationship: d.relationship || '' });
          }
        }
      })
      .catch(err => console.error(err));
  }, [id]);

  const getDisplayValues = (data, patientInfo) => {
    const name = patientInfo?.name || data.patient_name || '';
    const empNo = patientInfo?.empNumber || data.emp_number || '';
    const attendedDate = data.attended_date ? new Date(data.attended_date) : null;
    const attendedDateStr = attendedDate ? attendedDate.toLocaleDateString('en-GB') : '............';
    const attendedTimeStr = attendedDate ? attendedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }) : '......';
    const fromDate = data.from_date ? new Date(data.from_date).toLocaleDateString('en-GB') : '............';
    const toDate = data.to_date ? new Date(data.to_date).toLocaleDateString('en-GB') : '............';
    const fitDate = data.fit_date ? new Date(data.fit_date).toLocaleDateString('en-GB') : '............';
    const extendedDate = data.extended_date ? new Date(data.extended_date).toLocaleDateString('en-GB') : null;
    const formDate = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    return { name, empNo, attendedDateStr, attendedTimeStr, fromDate, toDate, fitDate, extendedDate, formDate };
  };

  const handlePrint = () => {
    if (!data) return;
    const { name, empNo, attendedDateStr, attendedTimeStr, fromDate, toDate, fitDate, extendedDate, formDate } = getDisplayValues(data, patientInfo);

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
      <html>
      <head>
        <title>Rest Form - ${name}</title>
        <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: 'Noto Sans Devanagari', 'Times New Roman', serif; color: #111; line-height: 1.5; font-size: 12pt; }
          .page { width: 210mm; margin: 0 auto; padding: 12mm 18mm; }

          .header-wrap { display: flex; align-items: center; justify-content: center; position: relative; margin-bottom: 7mm; min-height: 130px; }
          .header-logo { position: absolute; left: 0; top: 50%; transform: translateY(-50%); width: 130px; height: 130px; object-fit: contain; }
          .header-text { text-align: center; z-index: 1; }
          .header-text .h1 { font-size: 15pt; font-weight: 700; }
          .header-text .h2 { font-size: 12pt; font-weight: 600; margin-top: 3px; }

          .booksr { display: flex; justify-content: space-between; margin-bottom: 6mm; font-size: 11.5pt; }

          /* KEY FIX: flexWrap: nowrap so sentences never break mid-line */
          .row { display: flex; align-items: flex-end; flex-wrap: nowrap; margin-bottom: 5mm; line-height: 2; }
          .lbl { white-space: nowrap; font-size: 11.5pt; }
          .val {
            color: #1a237e; font-weight: 700; font-size: 13pt;
            border-bottom: 1px dotted #555;
            padding: 0 6px; display: inline-block; text-align: center; min-width: 40px;
          }
          .val-red { color: #c62828; font-weight: 800; font-size: 16pt; border-bottom: 2px dotted #c62828; }

          .center-section { text-align: center; margin: 8mm 0; font-size: 13.5pt; font-weight: 600; }
          .footer { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 14mm; }
          .footer-date { font-size: 13pt; font-weight: 700; color: #c62828; }
          .footer-sign { text-align: center; font-size: 11pt; }
          .sign-line { width: 170px; border-bottom: 1.2px solid #333; margin-bottom: 5px; }
          .copyright { text-align: center; font-size: 8pt; color: #aaa; margin-top: 10mm; }

          @media print {
            body { -webkit-print-color-adjust: exact; }
            .page { padding: 8mm 12mm; }
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="header-wrap">
            <img src="${window.location.origin}/logo.png" class="header-logo" />
            <div class="header-text">
              <div class="h1">अस्पताल प्रबंधन प्रणाली (एचएमएस)</div>
              <div class="h1">HOSPITAL MANAGEMENT SYSTEM (HMS)</div>
              <div class="h2">चिकित्सा विभाग MEDICAL DEPARTMENT</div>
              <div class="h2">रेस्ट फार्म REST FORM</div>
            </div>
          </div>

          <div class="booksr">
            <div>Sr. No. &nbsp;<span class="val val-red" style="min-width:110px">${data.sr_no || '........'}</span></div>
          </div>

          <div class="row">
            <span class="lbl">श्री / Shri.&nbsp;</span>
            <span class="val" style="flex:1; min-width:160px">${name}</span>
            <span class="lbl">&nbsp;&nbsp;कार्यरत / working as&nbsp;</span>
            <span class="val" style="min-width:120px">${data.working_as || '............'}</span>
            <span class="lbl">&nbsp;में / in&nbsp;</span>
            <span class="val" style="min-width:120px">${data.department || '............'}</span>
          </div>

          <div class="row">
            <span class="lbl">अनुभाग व विभाग क्रम.स० (Section or Department) E. No.:&nbsp;</span>
            <span class="val" style="flex:1">${empNo || '............'}</span>
          </div>

          <div class="row">
            <span class="lbl">मुख्य अस्पताल/प्रा० स्वा० के०में उपस्थित हुआ attended Main Hospital/FAP on&nbsp;</span>
            <span class="val" style="min-width:130px">${attendedDateStr}</span>
            <span class="lbl">&nbsp;दिनांक / Date</span>
          </div>

          <div class="row">
            <span class="lbl">को / at&nbsp;</span>
            <span class="val" style="min-width:110px">${attendedTimeStr}</span>
            <span class="lbl">&nbsp;ए.एम./पी.एम. a.m./p.m.</span>
          </div>

          <div class="row">
            <span class="lbl">को सलाह दी गई है कि वह आराम/लाईट ड्यूटी के लिए</span>
          </div>

          <div class="row">
            <span class="lbl">He has been advised rest/light duty for&nbsp;</span>
            <span class="val" style="min-width:110px">${data.advised_days || '............'}</span>
            <span class="lbl">&nbsp;दोनो / Days</span>
          </div>

          <div class="row">
            <span class="lbl">से लागू w.e.f.:&nbsp;</span>
            <span class="val" style="flex:1">${fromDate} to ${toDate}</span>
          </div>

          <div class="row">
            <span class="lbl">से वह बीमार as he/she is suffering from&nbsp;</span>
            <span class="val" style="flex:1; min-width:80px">${data.disease || '............'}</span>
            <span class="lbl">&nbsp;बीमारी (Disease)</span>
          </div>

          <div class="center-section">
            He is fit to join on &nbsp;<span class="val" style="min-width:150px; font-size:15pt">${fitDate}</span>
          </div>

          ${extendedDate ? `
          <div style="margin: 6mm 0 4mm; padding: 10px 16px; border: 2px solid #c62828; border-radius: 6px; background: rgba(198,40,40,0.04);">
            <div style="display: flex; align-items: flex-end; flex-wrap: nowrap; line-height: 2;">
              <span style="white-space: nowrap; font-size: 12pt; font-weight: 700; color: #c62828;">Rest further extended till / आराम आगे बढ़ाया गया:&nbsp;</span>
              <span class="val val-red" style="min-width:150px; font-size:15pt">${extendedDate}</span>
            </div>
          </div>
          ` : ''}

          <div class="footer">
            <div class="footer-date">${formDate}</div>
            <div class="footer-sign">
              <div class="sign-line"></div>
              चिकित्सा अधिकारी<br/>Medical Officer
            </div>
          </div>

          <div class="copyright">
            Designed, developed, and maintained by HMS IT Department © 2026. All rights reserved.
          </div>
        </div>
        <script>
          window.onload = function() { window.print(); window.onafterprint = function() { window.close(); }; };
        </script>
      </body>
      </html>
    `);
    printWindow.document.close();
  };

  if (!data) return <div style={{ padding: 40, textAlign: 'center', fontSize: '1.1rem' }}>Loading rest form...</div>;

  const { name, empNo, attendedDateStr, attendedTimeStr, fromDate, toDate, fitDate, extendedDate, formDate } = getDisplayValues(data, patientInfo);

  return (
    <div style={{ background: '#64748b', minHeight: '100vh' }}>

      {/* Controls bar */}
      <div style={{
        display: 'flex', gap: 12, justifyContent: 'center', padding: 16,
        background: '#1e293b', borderBottom: '1px solid #334155',
        position: 'sticky', top: 0, zIndex: 10
      }}>
        <button onClick={() => navigate(-1)} style={btnStyle('#334155', '#e2e8f0', '#475569')}>← Back</button>
        <button onClick={() => navigate(`/doctor/rest-forms/edit/${id}`)} style={btnStyle('#334155', '#e2e8f0', '#475569')}>✏️ Edit</button>
        <button onClick={handlePrint} style={btnStyle('#2563eb', '#fff', '#2563eb')}>🖨️ Print</button>
      </div>

      {/* Preview */}
      <div style={{ display: 'flex', justifyContent: 'center', padding: '30px 20px' }}>
        <div style={{
          width: '210mm', background: '#fff', padding: '12mm 18mm',
          boxShadow: '0 4px 25px rgba(0,0,0,0.25)',
          fontFamily: "'Noto Sans Devanagari', 'Times New Roman', serif",
          color: '#111', fontSize: '12pt', lineHeight: 1.5
        }}>

          {/* HEADER */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', marginBottom: '7mm', minHeight: 130 }}>
            <img src="/logo.png" alt="Logo" style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 130, height: 130, objectFit: 'contain' }} />
            <div style={{ textAlign: 'center', zIndex: 1 }}>
              <div style={{ fontSize: '15pt', fontWeight: 700 }}>अस्पताल प्रबंधन प्रणाली (एचएमएस)</div>
              <div style={{ fontSize: '15pt', fontWeight: 700 }}>HOSPITAL MANAGEMENT SYSTEM (HMS)</div>
              <div style={{ fontSize: '12pt', fontWeight: 600, marginTop: 3 }}>चिकित्सा विभाग MEDICAL DEPARTMENT</div>
              <div style={{ fontSize: '12pt', fontWeight: 600 }}>रेस्ट फार्म REST FORM</div>
            </div>
          </div>

          {/* SR */}
          <div style={{ display: 'flex', justifyContent: 'flex-start', marginBottom: '6mm', fontSize: '11.5pt' }}>
            <div>Sr. No. &nbsp;<span style={{ ...inkRed, minWidth: 110 }}>{data.sr_no || '........'}</span></div>
          </div>

          {/* NAME ROW */}
          <div style={row}>
            <span style={lbl}>श्री / Shri.&nbsp;</span>
            <span style={{ ...ink, flex: 1, minWidth: 160 }}>{name}</span>
            <span style={lbl}>&nbsp;&nbsp;कार्यरत / working as&nbsp;</span>
            <span style={{ ...ink, minWidth: 120 }}>{data.working_as || '............'}</span>
            <span style={lbl}>&nbsp;में / in&nbsp;</span>
            <span style={{ ...ink, minWidth: 120 }}>{data.department || '............'}</span>
          </div>

          {/* EMP NO */}
          <div style={row}>
            <span style={lbl}>अनुभाग व विभाग क्रम.स० (Section or Department) E. No.:&nbsp;</span>
            <span style={{ ...ink, flex: 1 }}>{empNo || '............'}</span>
          </div>

          {/* ATTENDED DATE */}
          <div style={row}>
            <span style={lbl}>मुख्य अस्पताल/प्रा० स्वा० के०में उपस्थित हुआ attended Main Hospital/FAP on&nbsp;</span>
            <span style={{ ...ink, minWidth: 130 }}>{attendedDateStr}</span>
            <span style={lbl}>&nbsp;दिनांक / Date</span>
          </div>

          {/* TIME */}
          <div style={row}>
            <span style={lbl}>को / at&nbsp;</span>
            <span style={{ ...ink, minWidth: 110 }}>{attendedTimeStr}</span>
            <span style={lbl}>&nbsp;ए.एम./पी.एम. a.m./p.m.</span>
          </div>

          {/* HINDI LABEL */}
          <div style={row}>
            <span style={lbl}>को सलाह दी गई है कि वह आराम/लाईट ड्यूटी के लिए</span>
          </div>

          {/* ADVISED DAYS */}
          <div style={row}>
            <span style={lbl}>He has been advised rest/light duty for&nbsp;</span>
            <span style={{ ...ink, minWidth: 110 }}>{data.advised_days || '............'}</span>
            <span style={lbl}>&nbsp;दोनो / Days</span>
          </div>

          {/* WEF */}
          <div style={row}>
            <span style={lbl}>से लागू w.e.f.:&nbsp;</span>
            <span style={{ ...ink, flex: 1 }}>{fromDate} to {toDate}</span>
          </div>

          {/* DISEASE */}
          <div style={row}>
            <span style={lbl}>से वह बीमार as he/she is suffering from&nbsp;</span>
            <span style={{ ...ink, flex: 1, minWidth: 80 }}>{data.disease || '............'}</span>
            <span style={lbl}>&nbsp;बीमारी (Disease)</span>
          </div>

          {/* FIT TO JOIN */}
          <div style={{ textAlign: 'center', margin: '8mm 0', fontSize: '13.5pt', fontWeight: 600 }}>
            He is fit to join on &nbsp;
            <span style={{ ...ink, minWidth: 150, fontSize: '15pt' }}>{fitDate}</span>
          </div>

          {/* EXTENSION (if applicable) */}
          {extendedDate && (
            <div style={{
              margin: '6mm 0 4mm', padding: '10px 16px',
              border: '2px solid #c62828', borderRadius: 6,
              background: 'rgba(198,40,40,0.04)',
            }}>
              <div style={row}>
                <span style={{ ...lbl, fontWeight: 700, color: '#c62828' }}>Rest further extended till / आराम आगे बढ़ाया गया:&nbsp;</span>
                <span style={{ ...inkRed, minWidth: 150, fontSize: '15pt' }}>{extendedDate}</span>
              </div>
            </div>
          )}

          {/* FOOTER */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: '14mm' }}>
            <div style={{ fontSize: '13pt', fontWeight: 700, color: '#c62828' }}>{formDate}</div>
            <div style={{ textAlign: 'center', fontSize: '11pt' }}>
              <div style={{ width: 170, borderBottom: '1.2px solid #333', marginBottom: 5 }}></div>
              चिकित्सा अधिकारी<br />Medical Officer
            </div>
          </div>

          {/* COPYRIGHT */}
          <div style={{ textAlign: 'center', fontSize: '7.5pt', color: '#aaa', marginTop: '8mm' }}>
            Designed, developed, and maintained by HMS IT Department © 2026. All rights reserved.
          </div>

        </div>
      </div>
    </div>
  );
}

/* ── Shared style objects ── */
const row = {
  display: 'flex',
  alignItems: 'flex-end',
  flexWrap: 'nowrap',        // ← KEY FIX: never wrap mid-sentence
  marginBottom: '5mm',
  lineHeight: 2,
};

const lbl = {
  whiteSpace: 'nowrap',
  fontSize: '11.5pt',
};

const ink = {
  color: '#1a237e',
  fontWeight: 700,
  fontSize: '13pt',
  borderBottom: '1px dotted #555',
  padding: '0 6px',
  display: 'inline-block',
  textAlign: 'center',
  minWidth: 40,
};

const inkRed = {
  color: '#c62828',
  fontWeight: 800,
  fontSize: '16pt',
  borderBottom: '2px dotted #c62828',
  padding: '0 8px',
  display: 'inline-block',
  textAlign: 'center',
};

const btnStyle = (bg, color, border) => ({
  padding: '10px 22px',
  borderRadius: 8,
  fontSize: '0.9rem',
  cursor: 'pointer',
  fontWeight: 600,
  border: `1px solid ${border}`,
  background: bg,
  color,
});