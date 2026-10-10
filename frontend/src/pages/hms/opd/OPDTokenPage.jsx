import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Search, X, Ticket, Printer, RefreshCw, UserPlus, UserRound, Stethoscope, ListOrdered, CircleAlert } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const QUEUE_TONE = { Waiting: 'warning', Consulting: 'info', Completed: 'success' };
const TOKEN_CLASS = { Waiting: 'token-waiting', Consulting: 'token-consulting' };

// /patients/hms/search returns raw SQL aliases (patient_name, phone_number); map them to the
// field names the rest of this page uses.
const normalizePatient = (p) => ({ ...p, name: p.name || p.patient_name, phoneNumber: p.phoneNumber || p.phone_number });

export default function OPDTokenPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPatient = location.state?.patient;

  const [patient, setPatient] = useState(initialPatient || null);
  const [doctors, setDoctors] = useState([]);
  const [queue, setQueue] = useState([]);

  const [selectedDoctor, setSelectedDoctor] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generatedToken, setGeneratedToken] = useState(null);

  // Quick Patient Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  useEffect(() => {
    fetchDoctors();
  }, []);

  useEffect(() => {
    if (selectedDoctor) fetchQueue(selectedDoctor);
  }, [selectedDoctor]);

  const fetchDoctors = async () => {
    try {
      const res = await api.get('/hms/doctors');
      const docs = res.data?.data || [];
      setDoctors(docs);
      if (docs.length === 1) setSelectedDoctor(String(docs[0].id));
    } catch (err) { console.error(err); }
  };

  const fetchQueue = async (docId) => {
    try {
      const res = await api.get(`/hms/tokens/queue?doctor_id=${docId}`);
      setQueue(res.data.data);
    } catch (err) { console.error(err); }
  };

  // Debounced patient search
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (searchQuery.length > 2 && !patient && !initialPatient) {
        try {
          const res = await api.get(`/patients/hms/search?q=${searchQuery}`);
          setSearchResults(res.data.data);
        } catch (err) { /* ignore search errors */ }
      } else {
        setSearchResults([]);
      }
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery, patient, initialPatient]);

  const handleGenerate = async () => {
    if (!patient || !selectedDoctor) {
      setError('Please select patient and doctor');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const payload = {
        patient_id: patient.id,
        department_id: 1,
        doctor_id: selectedDoctor,
      };
      const res = await api.post('/hms/tokens', payload);
      setGeneratedToken(res.data.data);
      fetchQueue(selectedDoctor); // Refresh queue
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to generate token');
    } finally {
      setLoading(false);
    }
  };

  const results = (Array.isArray(searchResults) ? searchResults : []).map(normalizePatient);
  const queueList = Array.isArray(queue) ? queue : [];

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader
          title="OPD token"
          description="Issue a walk-in token for today's consultation queue."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate('/hms/patients/new')}>
              <UserPlus size={16} aria-hidden="true" /> Register patient
            </button>
          )}
        />

        <div className="split-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><UserRound size={16} aria-hidden="true" /> 1. Patient</h2></div>
              <div className="panel-pad">
                {patient ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: 12, borderRadius: 8, background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
                    <span className="cell-person">
                      <span className="cell-avatar" aria-hidden="true">{(patient.name || '?').charAt(0).toUpperCase()}</span>
                      <span className="cell-stack">
                        <span className="cell-primary">{patient.name}</span>
                        <span className="cell-secondary"><span className="mono">{patient.uhid || 'Legacy'}</span> · {patient.age} y · {patient.gender}</span>
                      </span>
                    </span>
                    {!initialPatient && (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPatient(null)}>
                        <X size={14} aria-hidden="true" /> Change
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="stack-sm">
                    <label className="search-field">
                      <Search size={17} aria-hidden="true" />
                      <span className="sr-only">Search patient by name or UHID</span>
                      <input
                        type="text"
                        placeholder="Search name or UHID"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </label>
                    {results.length > 0 && (
                      <ul className="list-rows" aria-label="Matching patients" style={{ maxHeight: 240, overflowY: 'auto' }}>
                        {results.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="list-row" onClick={() => { setPatient(p); setSearchQuery(''); }}>
                              <span className="cell-stack">
                                <span className="cell-primary">{p.name}</span>
                                <span className="cell-secondary"><span className="mono">{p.uhid || 'Old record'}</span> · {p.age} y · {p.phoneNumber || '—'}</span>
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!searchQuery && (
                      <p className="form-hint" style={{ marginTop: 0 }}>
                        Type at least 3 characters. Patient not found?{' '}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/hms/patients/new')}>Register new patient</button>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><Stethoscope size={16} aria-hidden="true" /> 2. Doctor</h2></div>
              <div className="panel-pad stack">
                {error && (
                  <div className="alert-strip alert-danger" role="alert" style={{ marginBottom: 0 }}>
                    <CircleAlert size={16} aria-hidden="true" /> {error}
                  </div>
                )}

                <div className="form-group">
                  <label className="form-label" htmlFor="token-doctor">Doctor</label>
                  <select id="token-doctor" className="form-select" value={selectedDoctor} onChange={(e) => setSelectedDoctor(e.target.value)}>
                    <option value="">Choose a doctor</option>
                    {doctors.map((d) => <option key={d.id} value={d.id}>Dr. {d.user?.name || d.name} ({d.speciality || 'General'})</option>)}
                  </select>
                </div>

                <button
                  type="button"
                  className="btn btn-primary btn-md"
                  style={{ justifyContent: 'center' }}
                  onClick={handleGenerate}
                  disabled={loading || !patient || !selectedDoctor}
                >
                  <Ticket size={16} aria-hidden="true" /> {loading ? 'Generating…' : 'Generate token'}
                </button>

                {generatedToken && (
                  <div
                    className="opd-token-print"
                    role="status"
                    style={{ textAlign: 'center', background: 'var(--success-light)', border: '1px solid var(--success-border)', padding: 20, borderRadius: 10 }}
                  >
                    <p style={{ margin: 0, color: 'var(--success)', fontWeight: 600, fontSize: '0.88rem' }}>Token generated</p>
                    <div className="tabular" style={{ fontSize: '3rem', fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.1, marginTop: 6 }}>
                      {String(generatedToken.token_number).padStart(3, '0')}
                    </div>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Token number</p>
                    <button type="button" className="btn btn-secondary btn-sm" style={{ marginTop: 14 }} onClick={() => window.print()}>
                      <Printer size={14} aria-hidden="true" /> Print
                    </button>
                  </div>
                )}
              </div>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><ListOrdered size={16} aria-hidden="true" /> Live OPD queue</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => selectedDoctor && fetchQueue(selectedDoctor)} disabled={!selectedDoctor}>
                <RefreshCw size={14} aria-hidden="true" /> Refresh
              </button>
            </div>

            {!selectedDoctor ? (
              <div className="empty-state">
                <span className="empty-state-icon"><Stethoscope size={22} strokeWidth={1.75} aria-hidden="true" /></span>
                <h3>No doctor selected</h3>
                <p>Select a doctor to see their queue for today.</p>
              </div>
            ) : queueList.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-icon"><ListOrdered size={22} strokeWidth={1.75} aria-hidden="true" /></span>
                <h3>Queue is empty</h3>
                <p>No tokens have been issued for this doctor today.</p>
              </div>
            ) : (
              <ul style={{ listStyle: 'none', maxHeight: 640, overflowY: 'auto' }} aria-label="Today's queue">
                {queueList.map((t) => (
                  <li
                    key={t.id}
                    className="queue-item"
                    style={{ background: t.status === 'Consulting' ? 'var(--primary-light)' : undefined }}
                  >
                    <span className={`token-circle ${TOKEN_CLASS[t.status] || 'token-completed'} tabular`} aria-label={`Token ${t.token_number}`}>
                      {t.token_number}
                    </span>
                    <span className="cell-stack" style={{ flex: 1 }}>
                      <span className="cell-primary">{t.patient?.name}</span>
                      <span className="cell-secondary"><span className="mono">{t.patient?.uhid}</span> · {t.patient?.age} y</span>
                    </span>
                    <span className={`status status-${QUEUE_TONE[t.status] || 'success'}`}>{t.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
