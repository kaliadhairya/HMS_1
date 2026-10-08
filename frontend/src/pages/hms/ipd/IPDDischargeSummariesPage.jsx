import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import DischargeSummaryModal from '../../../components/DischargeSummaryModal';
import toast from 'react-hot-toast';

export default function IPDDischargeSummariesPage() {
  const navigate = useNavigate();
  const [summaries, setSummaries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Modal State
  const [selectedAdmission, setSelectedAdmission] = useState(null);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    fetchSummaries();
  }, []);

  const fetchSummaries = async () => {
    try {
      const res = await api.get('/ipd/discharge-summaries');
      if (res.data.success) {
        setSummaries(res.data.data);
      }
    } catch (err) {
      console.error(err);
      toast.error('Failed to load discharge summaries');
    } finally {
      setLoading(false);
    }
  };

  const handleViewSummary = async (summary) => {
    try {
      toast('Loading summary...', { icon: '⏳', duration: 1000 });
      const res = await api.get(`/ipd/admissions/${summary.ADMISSION_ID}`);
      if (res.data.success) {
        setSelectedAdmission(res.data.data);
        setShowModal(true);
      } else {
        toast.error('Failed to load admission details');
      }
    } catch (err) {
      toast.error('Error fetching admission data');
    }
  };

  const filtered = summaries.filter(s => {
    const q = search.toLowerCase();
    return (s.PATIENT_NAME?.toLowerCase().includes(q) || s.UHID?.toLowerCase().includes(q) || String(s.ADMISSION_ID).includes(q) || s.FINAL_DIAGNOSIS?.toLowerCase().includes(q));
  });

  return (
    <>
      <Navbar />
      <div className="container py-4" style={{ maxWidth: '100%' }}>
        <div className="hms-page-header" style={{ marginBottom: 28 }}>
          <div>
            <h1>
              <span className="header-icon" style={{ background: 'rgba(59, 130, 246, 0.1)', borderColor: 'rgba(59, 130, 246, 0.25)' }}>📄</span>
              Discharge Summaries Hub
            </h1>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
              View and print saved discharge summaries for past admissions.
            </p>
          </div>
          <div className="header-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/ipd/patients')}>← Back to Admissions</button>
          </div>
        </div>

        {/* Search Bar */}
        <div className="hms-anim-2" style={{ marginBottom: 0 }}>
          <div className="card" style={{
            padding: '12px 20px',
            borderRadius: 40,
            boxShadow: 'var(--shadow-md)',
            border: '2.5px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            alignItems: 'center',
            gap: 16,
            transition: 'all 0.3s ease',
          }}
            onFocusCapture={e => e.currentTarget.style.borderColor = 'var(--green)'}
            onBlurCapture={e => e.currentTarget.style.borderColor = 'var(--border)'}
          >
            <span style={{ fontSize: '1.4rem', filter: 'grayscale(0.5)' }}>🔍</span>
            <input
              type="text"
              className="form-input"
              style={{
                fontSize: '1.1rem',
                border: 'none',
                boxShadow: 'none',
                background: 'transparent',
                padding: '10px 0',
                flex: 1,
              }}
              placeholder="Search by UHID, Patient Name, Admission ID, or Diagnosis..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Results count bar */}
        {filtered.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 4px', marginTop: 16,
          }}>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              Showing <strong style={{ color: 'var(--text-primary)' }}>{filtered.length}</strong> discharge summar{filtered.length !== 1 ? 'ies' : 'y'}
            </span>
          </div>
        )}

        {/* Results Table */}
        <div className="card hms-anim-3" style={{ padding: 0, overflow: 'hidden', marginTop: filtered.length > 0 ? 0 : 24 }}>
          {loading && filtered.length === 0 ? (
            <div style={{ padding: 80, textAlign: 'center' }}>
              <div className="spinner" style={{ width: 40, height: 40, margin: '0 auto 16px' }} />
              <p style={{ color: 'var(--text-muted)' }}>Loading discharge summaries...</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="hms-empty-state" style={{ margin: 24 }}>
              <span className="empty-icon">{search ? '👻' : '📄'}</span>
              <h3>{search ? 'No records found' : 'No Discharge Summaries Found'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {search ? `We couldn't find any summaries matching your search.` : 'No patients have been discharged with a summary yet.'}
              </p>
            </div>
          ) : (
            <div className="table-wrapper hms-table-anim" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table>
                <thead>
                  <tr>
                    <th>Discharge Date</th>
                    <th>Patient Info</th>
                    <th>Admission ID</th>
                    <th>Final Diagnosis</th>
                    <th>Consultant</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => (
                    <tr key={s.ID}>
                      <td>
                        <strong style={{ display: 'block' }}>
                          {new Date(s.DISCHARGE_DATE).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </strong>
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {new Date(s.DISCHARGE_DATE).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}
                        </span>
                      </td>
                      <td>
                        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.PATIENT_NAME}</div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{s.UHID || 'Legacy'}</div>
                      </td>
                      <td>
                        <strong style={{ color: 'var(--blue)' }}>
                          IPD-{s.ADMISSION_ID}
                        </strong>
                      </td>
                      <td>
                        <div style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontWeight: 500 }} title={s.FINAL_DIAGNOSIS}>
                          {s.FINAL_DIAGNOSIS || '—'}
                        </div>
                      </td>
                      <td>{s.DOCTOR_NAME || '—'}</td>
                      <td>
                        <button 
                          className="btn btn-outline btn-sm"
                          onClick={() => handleViewSummary(s)}
                          style={{ borderColor: '#3b82f6', color: '#3b82f6', padding: '4px 10px' }}
                        >
                          👁️ View Summary
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showModal && selectedAdmission && (
        <DischargeSummaryModal
          admission={selectedAdmission}
          onClose={() => { setShowModal(false); setSelectedAdmission(null); }}
          viewOnly={true}
        />
      )}
    </>
  );
}
