import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import Navbar from '../components/Navbar';
import api from '../api/axios';
import { openAuthenticatedBlob } from '../utils/authenticatedDownload';

// ── Helper: nested path setter ─────────────────────
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  const result = JSON.parse(JSON.stringify(obj));
  let cur = result;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!cur[keys[i]]) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = { result: value };
  return result;
}

function getNestedValue(obj, path) {
  return path.split('.').reduce((o, k) => (o && o[k] !== undefined ? o[k] : {}), obj)?.result ?? '';
}

// ── Section component ──────────────────────────────
function TestSection({ title, icon, rows, reportData, onChange, accentColor = 'var(--teal)' }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, marginBottom: 16, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 18px',
        background: `linear-gradient(90deg, rgba(0,180,160,0.08), transparent)`,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: '1.1rem' }}>{icon}</span>
        <span style={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: accentColor }}>
          {title}
        </span>
      </div>
      <table className="test-table" style={{ width: '100%' }}>
        <thead>
          <tr>
            <th style={{ width: '48%' }}>Test</th>
            <th style={{ width: '22%' }}>Result</th>
            <th style={{ width: '30%' }}>Normal Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.path}>
              <td className={`label-cell ${row.sub ? 'test-sub' : ''}`}>{row.label}</td>
              <td className="result-cell">
                <input
                  className="result-input"
                  type="text"
                  value={getNestedValue(reportData, row.path)}
                  onChange={e => onChange(row.path, e.target.value)}
                  placeholder="—"
                />
              </td>
              <td className="normal-cell" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.normal || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Test definitions ───────────────────────────────
const HAEMATOLOGY_ROWS = [
  { path: 'haematology.hb', label: 'Hb (Haemoglobin)', normal: 'M: 12-16 g%, F: 10-14 g%' },
  { path: 'haematology.tlc', label: 'TLC (Total Leucocyte Count)', normal: '4000-11000/CMM' },
  { path: 'haematology.dlc.neutrophil', label: 'DLC — Neutrophil', normal: '', sub: true },
  { path: 'haematology.dlc.polymorphs', label: 'DLC — Polymorphs', normal: '40-75%', sub: true },
  { path: 'haematology.dlc.lymphocytes', label: 'DLC — Lymphocytes', normal: '', sub: true },
  { path: 'haematology.dlc.eosinophils', label: 'DLC — Eosinophils', normal: '20-40%', sub: true },
  { path: 'haematology.dlc.monocytes', label: 'DLC — Monocytes', normal: '1-6%', sub: true },
  { path: 'haematology.dlc.basophils', label: 'DLC — Basophils', normal: '0-1%', sub: true },
  { path: 'haematology.esr', label: 'E.S.R.', normal: '0-20 mm 1st Hr' },
  { path: 'haematology.bt', label: 'B.T. (Bleeding Time)', normal: '1-5 Minutes' },
  { path: 'haematology.ct', label: 'C.T. (Clotting Time)', normal: '2-6 Minutes' },
  { path: 'haematology.mp', label: 'M.P. (Malarial Parasite)', normal: '' },
];

const BIOCHEMISTRY_ROWS = [
  { path: 'biochemistry.fbs', label: 'F.B.S. (Fasting Blood Sugar)', normal: '70-110 mg/dl' },
  { path: 'biochemistry.ppbs', label: 'P.P.B.S. (Post Prandial Blood Sugar)', normal: '' },
  { path: 'biochemistry.rbs', label: 'R.B.S. (Random Blood Sugar)', normal: '' },
  { path: 'biochemistry.rft', label: 'R.F.T. (Renal Function Test)', normal: '' },
  { path: 'biochemistry.bloodUrea', label: 'Blood Urea', normal: '150 mg/dl' },
  { path: 'biochemistry.sCreatinine', label: 'S. Creatinine', normal: 'M: 0.7-1.4, F: 0.6-1.20 mg/dl' },
  { path: 'biochemistry.sUricAcid', label: 'S. Uric Acid', normal: 'M: 3.5-7.2, F: 2.5-6.2 mg/dl' },
  { path: 'biochemistry.sAlkPhosphatase', label: 'S. Alk. Phosphatase', normal: '15-112 U/L' },
  { path: 'biochemistry.sCalcium', label: 'S. Calcium', normal: '8.4-10.4 mg/dl' },
  { path: 'biochemistry.sAmylase', label: 'S. Amylase', normal: '20-115 U/L' },
  { path: 'biochemistry.lft.sBilirubin', label: 'LFT — S. Bilirubin', normal: 'A: 0.1-1.2 mEq/L', sub: true },
  { path: 'biochemistry.lft.sProteins', label: 'LFT — S. Proteins', normal: '6.0-8.3 g/dl', sub: true },
  { path: 'biochemistry.lft.sAlbumin', label: 'LFT — S. Albumin', normal: '3.2-5.0 g/dl', sub: true },
  { path: 'biochemistry.lft.sGlobulin', label: 'LFT — S. Globulin', normal: '', sub: true },
  { path: 'biochemistry.lft.sgot', label: 'SGOT', normal: '5-34 U/L', sub: true },
  { path: 'biochemistry.lft.sgpt', label: 'SGPT', normal: '0-40 U/L', sub: true },
  { path: 'biochemistry.lipidogram.sCholesterol', label: 'Lipidogram — S. Cholesterol', normal: '140-250 mg/dl', sub: true },
  { path: 'biochemistry.lipidogram.hdl', label: 'Lipidogram — HDL', normal: 'M: 30-65, F: 35-80 mg/dl', sub: true },
  { path: 'biochemistry.lipidogram.ldl', label: 'Lipidogram — LDL', normal: '', sub: true },
  { path: 'biochemistry.lipidogram.vldl', label: 'Lipidogram — VLDL', normal: '150-190 mg/dl', sub: true },
  { path: 'biochemistry.lipidogram.totalLipids', label: 'Lipidogram — Total Lipids', normal: '15-45 mg/dl', sub: true },
  { path: 'biochemistry.lipidogram.sTriglycerides', label: 'S. Triglycerides', normal: '25-160 mg/dl', sub: true },
];

const SEROLOGY_ROWS = [
  { path: 'serology.bloodGroup', label: 'Blood Group', normal: '' },
  { path: 'serology.rh', label: 'Rh Factor', normal: '' },
  { path: 'serology.vdrl', label: 'V.D.R.L.', normal: '' },
  { path: 'serology.hiv', label: 'H.I.V.', normal: '' },
  { path: 'serology.raFactor', label: 'R.A. Factor', normal: '' },
  { path: 'serology.hbsAg', label: 'HBsAg', normal: '' },
  { path: 'serology.crp', label: 'C.R.P.', normal: '' },
  { path: 'serology.asoTitre', label: 'ASO Titre', normal: '' },
  { path: 'serology.coombs', label: "Coomb's", normal: '' },
  { path: 'serology.toxoplasmosis', label: 'Toxoplasmosis', normal: '' },
  { path: 'serology.mantoux', label: 'Mantoux', normal: '' },
];

const WIDAL_ANTIBODIES = ['TO', 'TH', 'AH', 'BH'];
const WIDAL_DILUTIONS = ['1/20', '1/40', '1/80', '1/160', '1/320'];

function WidalGrid({ reportData, onChange }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, marginTop: 16, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 18px',
        background: 'linear-gradient(90deg, rgba(167,139,250,0.08), transparent)',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <span style={{ fontSize: '1.1rem' }}>🧫</span>
        <span style={{ fontWeight: 700, fontSize: '0.72rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: '#a78bfa' }}>
          Widal Test
        </span>
      </div>
      <table className="test-table" style={{ width: '100%', tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: 80 }} />
          {WIDAL_DILUTIONS.map(d => <col key={d} />)}
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>Antibody</th>
            {WIDAL_DILUTIONS.map(d => <th key={d} style={{ textAlign: 'center' }}>{d}</th>)}
          </tr>
        </thead>
        <tbody>
          {WIDAL_ANTIBODIES.map(ab => {
            const key = ab.toLowerCase();
            return (
              <tr key={ab}>
                <td className="label-cell" style={{ fontWeight: 700 }}>{ab}</td>
                {WIDAL_DILUTIONS.map(d => {
                  const dilKey = d.replace('/', '_');
                  const path = `serology.widal.${key}_${dilKey}`;
                  return (
                    <td key={d} className="result-cell" style={{ textAlign: 'center', padding: '6px 4px' }}>
                      <input
                        className="result-input"
                        type="text"
                        value={getNestedValue(reportData, path)}
                        onChange={e => onChange(path, e.target.value)}
                        placeholder="—"
                        style={{ textAlign: 'center', width: '100%', maxWidth: 'none' }}
                      />
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const URINE_ROWS = [
  { path: 'urine.sugar', label: 'Sugar', normal: '' },
  { path: 'urine.albumin', label: 'Albumin (Alb.)', normal: '' },
  { path: 'urine.bilePigments', label: 'Bile Pigments', normal: '' },
  { path: 'urine.bileSalts', label: 'Bile Salts', normal: '' },
  { path: 'urine.urobilinogen', label: 'Urobilinogen', normal: '' },
  { path: 'urine.ketones', label: 'Ketones', normal: '' },
  { path: 'urine.me', label: 'M/E (Microscopic Examination)', normal: '' },
];

const OTHER_ROWS = [
  { path: 'other.cs', label: 'C/S (Culture & Sensitivity)', normal: '' },
  { path: 'other.pregnancy', label: 'Pregnancy Test', normal: '' },
  { path: 'other.stool.ova', label: 'Stool — Ova', normal: '', sub: true },
  { path: 'other.stool.cyst', label: 'Stool — Cyst', normal: '', sub: true },
];

export default function ReportPage() {
  const { reportId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [report, setReport] = useState(null);
  const [patient, setPatient] = useState(location.state?.patient || null);
  const [reportData, setReportData] = useState({});
  const [remarks, setRemarks] = useState('');
  const [suggestions, setSuggestions] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('haematology');

  useEffect(() => {
    const fetchReport = async () => {
      try {
        const queryParams = new URLSearchParams(location.search);
        const forcedPatientId = queryParams.get('patient_id');

        if (reportId === 'new') {
           if (forcedPatientId) {
             const pRes = await api.get(`/patients/${forcedPatientId}`);
             setPatient(pRes.data);
           }
           setLoading(false);
           return;
        }

        const { data } = await api.get(`/reports/${reportId}`);
        setReport(data.report);
        setPatient(data.report.patient);
        setReportData(data.report);
        setRemarks(data.report.remarks || '');
        setSuggestions(data.report.suggestions || '');
      } catch {
        toast.error('Failed to load report.');
      } finally {
        setLoading(false);
      }
    };
    fetchReport();
  }, [reportId, location.search]);

  const handleChange = useCallback((path, value) => {
    setReportData(prev => setNestedValue(prev, path, value));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put(`/reports/${reportId}`, {
        haematology: reportData.haematology,
        biochemistry: reportData.biochemistry,
        serology: reportData.serology,
        urine: reportData.urine,
        other: reportData.other,
        remarks,
        suggestions,
        status: 'final',
      });
      toast.success('Report saved successfully!');
    } catch {
      toast.error('Failed to save report.');
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPDF = async () => {
    // Save first, then download
    setPdfLoading(true);
    try {
      await api.put(`/reports/${reportId}`, {
        haematology: reportData.haematology,
        biochemistry: reportData.biochemistry,
        serology: reportData.serology,
        urine: reportData.urine,
        other: reportData.other,
        remarks,
        suggestions,
        status: 'final',
      });
      await openAuthenticatedBlob(`/reports/${reportId}/pdf?download=true`, { download: true, filename: `lab-report-${reportId}.pdf` });
      toast.success('PDF downloading!');
    } catch {
      toast.error('PDF generation failed.');
    } finally {
      setPdfLoading(false);
    }
  };

  const handlePreviewPDF = async () => {
    // Save first, then preview
    setPdfLoading(true);
    try {
      await api.put(`/reports/${reportId}`, {
        haematology: reportData.haematology,
        biochemistry: reportData.biochemistry,
        serology: reportData.serology,
        urine: reportData.urine,
        other: reportData.other,
        remarks,
        suggestions,
        status: 'final',
      });
      await openAuthenticatedBlob(`/reports/${reportId}/pdf?preview=true`);
      toast.success('PDF Preview opened!');
    } catch {
      toast.error('PDF preview failed.');
    } finally {
      setPdfLoading(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
          <div className="spinner" style={{ width: 36, height: 36 }} />
        </div>
      </>
    );
  }

  const isCorporate = patient?.patientType === 'corporate_employee';

  const TABS = [
    { id: 'haematology', label: 'Haematology', icon: '🩸', color: 'var(--teal)' },
    { id: 'biochemistry', label: 'Bio-Chemistry', icon: '🧪', color: '#60a5fa' },
    { id: 'serology', label: 'Serology', icon: '🔬', color: '#a78bfa' },
    { id: 'urine', label: 'Urine', icon: '💛', color: '#fbbf24' },
    { id: 'other', label: 'Other Tests', icon: '📋', color: '#34d399' },
    { id: 'remarks', label: 'Remarks', icon: '📝', color: '#f43f5e' },
  ];

  return (
    <>
      <Navbar />
      <div className="page-wrapper" style={{ maxWidth: 1400, paddingBottom: 100 }}>
        {/* Back */}
        <button className="btn btn-ghost btn-sm" onClick={() => navigate('/dashboard')} style={{ marginBottom: 20 }}>
          ← Back to Dashboard
        </button>

        {/* Patient Info Card */}
        <div className="card fade-up" style={{ marginBottom: 20, padding: '20px 24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <span className={`badge ${isCorporate ? 'badge-teal' : 'badge-amber'}`}>
                  {isCorporate ? '🏢 Corporate Employee' : '🧑‍⚕️ Other Patient'}
                </span>
                <span className="badge badge-green">Report Active</span>
                <button 
                  className="btn btn-outline btn-sm" 
                  style={{ padding: '2px 8px', fontSize: '0.75rem', height: 'auto', marginLeft: 'auto' }}
                  onClick={() => navigate(`/edit/${patient.id}`)}
                >
                  ✏️ Edit Patient
                </button>
              </div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: '1.4rem', marginBottom: 4 }}>
                {patient?.name}
              </h2>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                <span>Age: <strong style={{ color: 'var(--text-primary)' }}>{patient?.age} yrs</strong></span>
                <span>Gender: <strong style={{ color: 'var(--text-primary)' }}>{patient?.gender}</strong></span>
                <span>{isCorporate ? 'Emp No.' : 'Phone No.'}: <strong style={{ color: 'var(--teal)' }}>
                  {isCorporate ? patient?.empNumber : patient?.phoneNumber}
                </strong></span>
                {isCorporate && <span>Relation: <strong style={{ color: 'var(--text-primary)' }}>{patient?.relationship}</strong></span>}
                <span>Ward: <strong style={{ color: 'var(--text-primary)' }}>{patient?.ward}</strong></span>
                <span>Date: <strong style={{ color: 'var(--text-primary)' }}>{new Date(patient?.testDate).toLocaleDateString('en-IN')}</strong></span>
                {patient?.provDiagnosis && <span>Dx: <strong style={{ color: 'var(--text-primary)' }}>{patient?.provDiagnosis}</strong></span>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-outline btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : '💾 Save'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={handlePreviewPDF} disabled={pdfLoading}>
                {pdfLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating…</> : '👁️ Preview PDF'}
              </button>
              <button className="btn btn-primary btn-sm" onClick={handleDownloadPDF} disabled={pdfLoading}>
                {pdfLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating…</> : '📄 Download PDF'}
              </button>
            </div>
          </div>
        </div>

        {/* Tabs Layout */}
        <div className="fade-up-2" style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginBottom: 24 }}>
          {/* Sidebar Tabs */}
          <div style={{ width: 250, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '14px 18px', borderRadius: 12,
                  background: activeTab === tab.id ? 'var(--tab-bg-active)' : 'var(--tab-bg)',
                  border: `1.5px solid ${activeTab === tab.id ? tab.color : 'var(--tab-border)'}`,
                  color: activeTab === tab.id ? tab.color : 'var(--text-secondary)',
                  fontWeight: activeTab === tab.id ? 600 : 500,
                  textAlign: 'left', cursor: 'pointer', transition: 'all 0.2s',
                  boxShadow: activeTab === tab.id ? 'var(--tab-shadow-active)' : 'var(--tab-shadow)'
                }}
              >
                <div style={{ 
                  width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem',
                  background: activeTab === tab.id ? tab.color : 'var(--surface-3)',
                  color: activeTab === tab.id ? '#fff' : 'inherit'
                }}>
                  {tab.icon}
                </div>
                {tab.label}
              </button>
            ))}
          </div>

          {/* Main Content Area */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {activeTab === 'haematology' && <TestSection title="Haematology" icon="🩸" rows={HAEMATOLOGY_ROWS} reportData={reportData} onChange={handleChange} accentColor="var(--teal)" />}
            {activeTab === 'biochemistry' && <TestSection title="Bio-Chemistry" icon="🧪" rows={BIOCHEMISTRY_ROWS} reportData={reportData} onChange={handleChange} accentColor="#60a5fa" />}
            {activeTab === 'serology' && (
              <>
                <TestSection title="Serology" icon="🔬" rows={SEROLOGY_ROWS} reportData={reportData} onChange={handleChange} accentColor="#a78bfa" />
                <WidalGrid reportData={reportData} onChange={handleChange} />
              </>
            )}
            {activeTab === 'urine' && <TestSection title="Urine" icon="💛" rows={URINE_ROWS} reportData={reportData} onChange={handleChange} accentColor="#fbbf24" />}
            {activeTab === 'other' && <TestSection title="Other Tests" icon="📋" rows={OTHER_ROWS} reportData={reportData} onChange={handleChange} accentColor="#34d399" />}
            
            {activeTab === 'remarks' && (
              <div className="card fade-in" style={{ padding: '24px 28px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                  <span style={{ fontSize: '1.4rem' }}>📝</span>
                  <div className="card-section-title" style={{ marginBottom: 0 }}>Remarks & Suggestions</div>
                </div>
                <div className="form-grid-2">
                  <div className="form-group">
                    <label className="form-label">Remarks</label>
                    <textarea
                      className="form-textarea"
                      placeholder="Any clinical remarks or observations…"
                      value={remarks}
                      onChange={e => setRemarks(e.target.value)}
                      rows={6}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Suggestions / Advice</label>
                    <textarea
                      className="form-textarea"
                      placeholder="Dietary advice, follow-up, referral, repeat tests…"
                      value={suggestions}
                      onChange={e => setSuggestions(e.target.value)}
                      rows={6}
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Bottom action bar */}
      </div>

      <div style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        display: 'flex', justifyContent: 'center',
        background: 'rgba(15,23,42,0.97)', backdropFilter: 'blur(12px)',
        borderTop: '1px solid rgba(255,255,255,0.1)',
        padding: '16px 24px',
        boxShadow: '0 -4px 20px rgba(0,0,0,0.2)'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', maxWidth: 1400, margin: '0 auto' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginRight: 'auto' }}>
            Report ID: {reportId?.slice(-8).toUpperCase()}
          </span>
          <button className="btn btn-ghost" onClick={() => navigate('/search')}>View All Records</button>
          <button className="btn btn-outline" onClick={handleSave} disabled={saving}>
            {saving ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Saving…</> : '💾 Save Report'}
          </button>
          <button className="btn btn-secondary" onClick={handlePreviewPDF} disabled={pdfLoading}>
            {pdfLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating…</> : '👁️ Preview PDF'}
          </button>
          <button className="btn btn-primary" onClick={handleDownloadPDF} disabled={pdfLoading}>
            {pdfLoading ? <><div className="spinner" style={{ width: 14, height: 14 }} /> Generating…</> : '📄 Download PDF Report'}
          </button>
        </div>
      </div>
    </>
  );
}
