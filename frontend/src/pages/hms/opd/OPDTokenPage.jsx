import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

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
    } catch(err) { console.error(err); }
  };

  const fetchQueue = async (docId) => {
    try {
      const res = await api.get(`/hms/tokens/queue?doctor_id=${docId}`);
      setQueue(res.data.data);
    } catch(err) { console.error(err); }
  };

  // Debounced patient search
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (searchQuery.length > 2 && !patient && !initialPatient) {
        try {
          const res = await api.get(`/patients/hms/search?q=${searchQuery}`);
          setSearchResults(res.data.data);
        } catch(err) {} 
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
        doctor_id: selectedDoctor
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

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      <div className="page-header">
        <h1>Generate OPD Token</h1>
        <p>Walk-in patient registration for today's consultation queue.</p>
      </div>

      <div className="form-grid-2">
        {/* Token Generation Form */}
        <div>
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="card-section-title">1. Patient Selection</div>
            
            {patient ? (
              <div style={{ background: 'var(--surface-3)', padding: 16, borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0' }}>{patient.name}</h3>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    {patient.uhid || 'Legacy'} • {patient.age} Yrs • {patient.gender}
                  </p>
                </div>
                {!initialPatient && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setPatient(null)}>✕ Change</button>
                )}
              </div>
            ) : (
              <div style={{ position: 'relative' }}>
                <input 
                  type="text" 
                  className="form-input" 
                  placeholder="Search Name or UHID..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                />
                {searchResults.length > 0 && (
                  <div className="card" style={{ position: 'absolute', top: 45, left: 0, right: 0, zIndex: 10, padding: 0, maxHeight: 200, overflowY: 'auto' }}>
                    {searchResults.map(p => (
                      <div key={p.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => { setPatient(p); setSearchQuery(''); }}>
                        <strong>{p.name}</strong> ({p.uhid || 'Old Record'}) - {p.age}/{p.phoneNumber || '-'}
                      </div>
                    ))}
                  </div>
                )}
                {!searchQuery && (
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                    Can't find patient? <a href="#" onClick={(e) => { e.preventDefault(); navigate('/hms/patients/new'); }} style={{ color: 'var(--blue)' }}>Register New</a>
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-section-title">2. Select Doctor</div>
            {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}

            <div className="form-group" style={{ marginBottom: 24 }}>
              <label className="form-label">Doctor</label>
              <select className="form-select" value={selectedDoctor} onChange={e => setSelectedDoctor(e.target.value)}>
                <option value="">-- Choose --</option>
                {doctors.map(d => <option key={d.id} value={d.id}>Dr. {d.user?.name || d.name} ({d.speciality || 'General'})</option>)}
              </select>
            </div>

            <button 
              className="btn btn-primary btn-lg btn-full" 
              onClick={handleGenerate}
              disabled={loading || !patient || !selectedDoctor}
            >
              {loading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : '🎫 Generate Token'}
            </button>

            {generatedToken && (
              <div className="fade-up opd-token-print" style={{ marginTop: 24, textAlign: 'center', background: 'var(--green-light)', border: '1px solid var(--green)', padding: 24, borderRadius: 12 }}>
                <p style={{ margin: 0, color: 'var(--green)', fontWeight: 'bold' }}>Success!</p>
                <div style={{ fontSize: '3.5rem', fontWeight: 800, color: 'var(--green)', lineHeight: 1 }}>
                  {String(generatedToken.token_number).padStart(3, '0')}
                </div>
                <p style={{ margin: '8px 0 0 0', color: 'var(--text-secondary)' }}>Token Number</p>
                <button className="btn btn-outline btn-sm" style={{ marginTop: 16 }} onClick={() => window.print()}>🖨️ Print</button>
              </div>
            )}
          </div>
        </div>

        {/* Live Queue Display */}
        <div>
          <div className="card" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div className="card-section-title" style={{ margin: 0 }}>Live OPD Queue</div>
              <button className="btn btn-ghost btn-sm" onClick={() => selectedDoctor && fetchQueue(selectedDoctor)}>↻ Refresh</button>
            </div>
            
            {!selectedDoctor ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', textAlign: 'center' }}>
                Select a doctor to view<br/>their live queue for today.
              </div>
            ) : queue.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                Queue is empty today.
              </div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto' }}>
                {queue.map((t) => (
                  <div key={t.id} style={{ 
                    display: 'flex', alignItems: 'center', padding: '12px 16px', 
                    borderBottom: '1px solid var(--border)', gap: 16,
                    background: t.status === 'Consulting' ? 'var(--blue-light)' : 'transparent'
                  }}>
                    <div style={{ 
                      width: 44, height: 44, borderRadius: '50%', 
                      background: t.status === 'Waiting' ? 'var(--surface-3)' : (t.status === 'Consulting' ? 'var(--blue)' : 'var(--green)'),
                      color: t.status === 'Waiting' ? 'var(--text-primary)' : '#fff',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontWeight: 'bold', fontSize: '1.2rem'
                    }}>
                      {t.token_number}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{t.patient?.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>{t.patient?.uhid} • {t.patient?.age} Yrs</div>
                    </div>
                    <div>
                      <span className={`badge badge-${t.status === 'Waiting' ? 'amber' : (t.status === 'Consulting' ? 'blue' : 'green')}`}>
                        {t.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
