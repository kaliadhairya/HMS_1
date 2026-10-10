import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, ClipboardList, Droplet, Eye, FileDown, FlaskConical, Microscope, NotebookPen, Pencil, Save, TestTube, TestTubes,
} from 'lucide-react';
import Navbar from '../components/Navbar';
import api from '../api/axios';
import { openAuthenticatedBlob } from '../utils/authenticatedDownload';
import PageHeader from '../components/ui/PageHeader';

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
function TestSection({ title, icon: Icon, rows, reportData, onChange }) {
  return (
    <section className="panel" style={{ overflow: 'hidden' }}>
      <div className="panel-head">
        <h2 className="panel-title" style={{ margin: 0 }}><Icon size={16} aria-hidden="true" /> {title}</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="test-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: '48%' }}>Test</th>
              <th style={{ width: '22%' }}>Result</th>
              <th style={{ width: '30%' }}>Normal value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.path}>
                <td className={`label-cell ${row.sub ? 'test-sub' : ''}`}>{row.label}</td>
                <td className="result-cell">
                  <input
                    className="result-input"
                    type="text"
                    aria-label={`${row.label} result`}
                    value={getNestedValue(reportData, row.path)}
                    onChange={(e) => onChange(row.path, e.target.value)}
                    placeholder="—"
                  />
                </td>
                <td className="normal-cell" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.normal || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
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
    <section className="panel" style={{ overflow: 'hidden' }}>
      <div className="panel-head">
        <h2 className="panel-title" style={{ margin: 0 }}><TestTubes size={16} aria-hidden="true" /> Widal test</h2>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table className="test-table" style={{ width: '100%', tableLayout: 'fixed', minWidth: 480 }}>
          <colgroup>
            <col style={{ width: 80 }} />
            {WIDAL_DILUTIONS.map((d) => <col key={d} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Antibody</th>
              {WIDAL_DILUTIONS.map((d) => <th key={d} style={{ textAlign: 'center' }}>{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {WIDAL_ANTIBODIES.map((ab) => {
              const key = ab.toLowerCase();
              return (
                <tr key={ab}>
                  <td className="label-cell" style={{ fontWeight: 700 }}>{ab}</td>
                  {WIDAL_DILUTIONS.map((d) => {
                    const dilKey = d.replace('/', '_');
                    const path = `serology.widal.${key}_${dilKey}`;
                    return (
                      <td key={d} className="result-cell" style={{ textAlign: 'center', padding: '6px 4px' }}>
                        <input
                          className="result-input"
                          type="text"
                          aria-label={`Widal ${ab} at ${d}`}
                          value={getNestedValue(reportData, path)}
                          onChange={(e) => onChange(path, e.target.value)}
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
    </section>
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
             // GET /patients/:id responds with { success, patient, report }
             setPatient(pRes.data?.patient || pRes.data);
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
    setReportData((prev) => setNestedValue(prev, path, value));
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
      toast.success('Report saved');
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
      toast.success('PDF downloading');
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
      toast.success('PDF preview opened');
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
        <main className="app-page"><p className="muted">Loading…</p></main>
      </>
    );
  }

  const isCorporate = patient?.patientType === 'corporate_employee';

  const TABS = [
    { id: 'haematology', label: 'Haematology', icon: Droplet },
    { id: 'biochemistry', label: 'Biochemistry', icon: FlaskConical },
    { id: 'serology', label: 'Serology', icon: Microscope },
    { id: 'urine', label: 'Urine', icon: TestTube },
    { id: 'other', label: 'Other tests', icon: ClipboardList },
    { id: 'remarks', label: 'Remarks', icon: NotebookPen },
  ];

  const facts = [
    { label: 'Age', value: patient?.age != null ? `${patient.age} y` : '—' },
    { label: 'Gender', value: patient?.gender || '—' },
    { label: isCorporate ? 'Employee no.' : 'Phone', value: (isCorporate ? patient?.empNumber : patient?.phoneNumber) || '—', mono: true },
    isCorporate && { label: 'Relation', value: patient?.relationship || '—' },
    { label: 'Ward', value: patient?.ward || '—' },
    { label: 'Test date', value: patient?.testDate ? new Date(patient.testDate).toLocaleDateString('en-IN') : '—' },
    patient?.provDiagnosis && { label: 'Provisional diagnosis', value: patient.provDiagnosis },
  ].filter(Boolean);

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title={patient?.name ? `Lab report: ${patient.name}` : 'Lab report'}
          description="Enter results by section. Saving marks the report as final."
          meta={(
            <>
              <span className={`status ${isCorporate ? 'status-info' : 'status-neutral'}`}>{isCorporate ? 'Corporate beneficiary' : 'General patient'}</span>
              <span className="status status-success">Report active</span>
            </>
          )}
          actions={(
            <>
              <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/dashboard')}>
                <ArrowLeft size={16} aria-hidden="true" /> Back to dashboard
              </button>
              {patient?.id && (
                <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate(`/edit/${patient.id}`)}>
                  <Pencil size={16} aria-hidden="true" /> Edit patient
                </button>
              )}
            </>
          )}
        />

        <section className="panel panel-pad" style={{ marginBottom: 16 }} aria-label="Patient details">
          <div className="facts">
            {facts.map((f) => (
              <div key={f.label}>
                <div className="fact-label">{f.label}</div>
                <div className={`fact-value${f.mono ? ' mono' : ''}`}>{f.value}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="tabs" role="tablist" aria-label="Report sections">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`rp-tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`rp-panel-${tab.id}`}
                className={`tab${activeTab === tab.id ? ' is-active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={16} aria-hidden="true" /> {tab.label}
              </button>
            );
          })}
        </div>

        <div role="tabpanel" id={`rp-panel-${activeTab}`} aria-labelledby={`rp-tab-${activeTab}`} className="stack" style={{ marginBottom: 16 }}>
          {activeTab === 'haematology' && <TestSection title="Haematology" icon={Droplet} rows={HAEMATOLOGY_ROWS} reportData={reportData} onChange={handleChange} />}
          {activeTab === 'biochemistry' && <TestSection title="Biochemistry" icon={FlaskConical} rows={BIOCHEMISTRY_ROWS} reportData={reportData} onChange={handleChange} />}
          {activeTab === 'serology' && (
            <>
              <TestSection title="Serology" icon={Microscope} rows={SEROLOGY_ROWS} reportData={reportData} onChange={handleChange} />
              <WidalGrid reportData={reportData} onChange={handleChange} />
            </>
          )}
          {activeTab === 'urine' && <TestSection title="Urine" icon={TestTube} rows={URINE_ROWS} reportData={reportData} onChange={handleChange} />}
          {activeTab === 'other' && <TestSection title="Other tests" icon={ClipboardList} rows={OTHER_ROWS} reportData={reportData} onChange={handleChange} />}

          {activeTab === 'remarks' && (
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><NotebookPen size={16} aria-hidden="true" /> Remarks and suggestions</h2></div>
              <div className="panel-pad">
                <div className="form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="rp-remarks">Remarks</label>
                    <textarea
                      id="rp-remarks"
                      className="form-textarea"
                      placeholder="Clinical remarks or observations"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      rows={6}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="rp-suggestions">Suggestions and advice</label>
                    <textarea
                      id="rp-suggestions"
                      className="form-textarea"
                      placeholder="Dietary advice, follow-up, referral, repeat tests"
                      value={suggestions}
                      onChange={(e) => setSuggestions(e.target.value)}
                      rows={6}
                    />
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>

        {/* Bottom action bar */}
        <div
          className="panel"
          style={{
            position: 'sticky', bottom: 0, zIndex: 100, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '12px 16px', boxShadow: 'var(--shadow-md)',
          }}
        >
          <span className="muted" style={{ marginRight: 'auto' }}>
            Report ID <span className="mono">{reportId?.slice(-8).toUpperCase()}</span>
          </span>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/search')}>View all records</button>
          <button type="button" className="btn btn-secondary btn-md" onClick={handleSave} disabled={saving}>
            <Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : 'Save report'}
          </button>
          <button type="button" className="btn btn-secondary btn-md" onClick={handlePreviewPDF} disabled={pdfLoading}>
            <Eye size={16} aria-hidden="true" /> {pdfLoading ? 'Generating…' : 'Preview PDF'}
          </button>
          <button type="button" className="btn btn-primary btn-md" onClick={handleDownloadPDF} disabled={pdfLoading}>
            <FileDown size={16} aria-hidden="true" /> {pdfLoading ? 'Generating…' : 'Download PDF'}
          </button>
        </div>
      </main>
    </>
  );
}
