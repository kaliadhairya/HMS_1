import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';

export default function VitalsEntryPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const initialPatient = location.state?.patient;
  
  const [patient, setPatient] = useState(initialPatient || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  // Quick Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);

  // Vitals History
  const [vitalsHistory, setVitalsHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Form State
  const [formData, setFormData] = useState({
    encounter_type: 'OPD',
    bp_systolic: '', bp_diastolic: '', temperature: '', temp_unit: 'C',
    weight_kg: '', height_cm: '', spo2: '', pulse: '', respiratory_rate: ''
  });

  const [bmi, setBmi] = useState(null);
  const [alerts, setAlerts] = useState([]);

  // Auto calculate BMI
  useEffect(() => {
    if (formData.weight_kg && formData.height_cm) {
      const w = parseFloat(formData.weight_kg);
      const hStr = parseFloat(formData.height_cm) / 100;
      if (w > 0 && hStr > 0) {
        setBmi((w / (hStr * hStr)).toFixed(2));
      } else { setBmi(null); }
    } else { setBmi(null); }
  }, [formData.weight_kg, formData.height_cm]);

  // Fetch vitals history when patient is selected
  useEffect(() => {
    if (patient?.id) {
      fetchVitalsHistory(patient.id);
    } else {
      setVitalsHistory([]);
    }
  }, [patient]);

  const fetchVitalsHistory = async (patientId) => {
    setHistoryLoading(true);
    try {
      const res = await api.get(`/hms/vitals/history/${patientId}`);
      setVitalsHistory(res.data.data || []);
    } catch (err) {
      console.error('Failed to load vitals history:', err);
      setVitalsHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Live Alert Generation for UI guidance
  useEffect(() => {
    const newAlerts = [];
    const sys = Number(formData.bp_systolic);
    const dia = Number(formData.bp_diastolic);
    const temp = Number(formData.temperature);
    const pulse = Number(formData.pulse);
    const sp = Number(formData.spo2);

    if (sys > 140 || dia > 90) newAlerts.push('High BP');
    if ((sys > 0 && sys < 90) || (dia > 0 && dia < 60)) newAlerts.push('Low BP');
    if ((formData.temp_unit === 'C' && temp > 37.5) || (formData.temp_unit === 'F' && temp > 99.5)) newAlerts.push('Fever');
    if (sp > 0 && sp < 95) newAlerts.push('Low SpO2');
    if (pulse > 100) newAlerts.push('Tachycardia');
    if (pulse > 0 && pulse < 60) newAlerts.push('Bradycardia');
    if (bmi && Number(bmi) > 25) newAlerts.push('Overweight');

    setAlerts(newAlerts);
  }, [formData, bmi]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Debounced search
  useEffect(() => {
    const handler = setTimeout(async () => {
      if (searchQuery.length > 2 && !patient && !initialPatient) {
        try {
          const res = await api.get(`/patients/hms/search?q=${searchQuery}`);
          setSearchResults(res.data.data);
        } catch(err) {} 
      } else { setSearchResults([]); }
    }, 400);
    return () => clearTimeout(handler);
  }, [searchQuery, patient, initialPatient]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!patient) {
      setError('Please select a patient first.');
      return;
    }
    setLoading(true);
    setError('');
    setSuccess(false);

    try {
      await api.post('/hms/vitals', {
        patient_id: patient.id,
        ...formData,
        bp_systolic: formData.bp_systolic || null,
        bp_diastolic: formData.bp_diastolic || null,
        temperature: formData.temperature || null,
        weight_kg: formData.weight_kg || null,
        height_cm: formData.height_cm || null,
        spo2: formData.spo2 || null,
        pulse: formData.pulse || null,
        respiratory_rate: formData.respiratory_rate || null,
      });
      setSuccess(true);
      // Refresh vitals history
      fetchVitalsHistory(patient.id);
      // Reset form
      setFormData(prev => ({ ...prev, bp_systolic: '', bp_diastolic: '', temperature: '', weight_kg: '', height_cm: '', spo2: '', pulse: '', respiratory_rate: '' }));
    } catch (err) {
      setError('Failed to record vitals.');
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };
  const formatTime = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
  };

  const getVitalColor = (key, value) => {
    if (!value && value !== 0) return 'inherit';
    const v = Number(value);
    if (key === 'bp_systolic' && (v > 140 || v < 90)) return '#ef4444';
    if (key === 'bp_diastolic' && (v > 90 || v < 60)) return '#ef4444';
    if (key === 'pulse' && (v > 100 || v < 60)) return '#ef4444';
    if (key === 'spo2' && v < 95) return '#ef4444';
    if (key === 'temperature' && v > 99.5) return '#ef4444';
    return '#10b981';
  };

  return (
    <>
    <Navbar />
    <div className="container py-4">
      {/* Page Header */}
      <div className="hms-page-header" style={{ marginBottom: 28 }}>
        <div>
          <h1>
            <span className="header-icon" style={{ background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.25)' }}>❤️</span>
            Record Vitals
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: 6, marginLeft: 56 }}>
            Enter patient vitals for triage assessment and monitoring.
          </p>
        </div>
        <div className="header-actions">
          <button className="btn btn-ghost" onClick={() => navigate(-1)}>← Back</button>
        </div>
      </div>

      {error && <div className="alert alert-error" style={{ marginBottom: 16 }}>{error}</div>}
      {success && <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', color: '#10b981', marginBottom: 16, fontWeight: 600, fontSize: '0.88rem' }}>✅ Vitals recorded successfully!</div>}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        {/* LEFT: Entry Form */}
        <div>
          {/* Patient Selection Card */}
          <div className="card" style={{ padding: 0, overflow: 'visible', marginBottom: 20 }}>
            <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10, borderTopLeftRadius: 'inherit', borderTopRightRadius: 'inherit' }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(59,130,246,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>👤</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Patient</h3>
            </div>
            <div style={{ padding: '16px 24px' }}>
              {patient ? (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem' }}>{patient.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                      UHID: {patient.uhid || 'Legacy'} • {patient.age ? `${patient.age} Yrs` : ''} {patient.gender ? `• ${patient.gender}` : ''}
                    </div>
                  </div>
                  {!initialPatient && <button className="btn btn-ghost btn-sm" onClick={() => { setPatient(null); setVitalsHistory([]); }}>Change</button>}
                </div>
              ) : (
                <div style={{ position: 'relative' }}>
                  <input 
                    type="text" className="form-input" 
                    placeholder="🔍 Search Patient Name or UHID..." 
                    value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                  />
                  {searchResults.length > 0 && (
                    <div className="card" style={{ position: 'absolute', top: 45, left: 0, right: 0, zIndex: 10, padding: 0, maxHeight: 250, overflowY: 'auto' }}>
                      {searchResults.map(p => (
                        <div key={p.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background 0.15s' }}
                          onMouseEnter={e => e.currentTarget.style.background='var(--surface-2)'}
                          onMouseLeave={e => e.currentTarget.style.background=''}
                          onClick={() => { setPatient(p); setSearchQuery(''); }}>
                          <strong>{p.name}</strong>
                          <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', marginLeft: 8 }}>({p.uhid || 'Old'})</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Vitals Entry Form */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(239,68,68,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>🩺</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Vital Signs</h3>
              {alerts.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                  {alerts.map(a => <span key={a} style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '0.7rem', fontWeight: 700 }}>{a}</span>)}
                </div>
              )}
            </div>
            <form onSubmit={handleSubmit}>
              <div style={{ padding: '20px 24px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 20px' }}>
                  <div className="form-group">
                    <label className="form-label">Blood Pressure (Sys / Dia)</label>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="number" className="form-input" name="bp_systolic" placeholder="120" value={formData.bp_systolic} onChange={handleChange} />
                      <span style={{ color: 'var(--text-muted)', fontWeight: 700 }}>/</span>
                      <input type="number" className="form-input" name="bp_diastolic" placeholder="80" value={formData.bp_diastolic} onChange={handleChange} />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Temperature</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="number" step="0.1" className="form-input" name="temperature" placeholder="98.6" value={formData.temperature} onChange={handleChange} style={{ flex: 2 }} />
                      <select className="form-input" name="temp_unit" value={formData.temp_unit} onChange={handleChange} style={{ flex: 1, maxWidth: 70 }}>
                        <option value="C">°C</option>
                        <option value="F">°F</option>
                      </select>
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Heart Rate (Pulse)</label>
                    <input type="number" className="form-input" name="pulse" placeholder="bpm" value={formData.pulse} onChange={handleChange} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">SpO2 (%)</label>
                    <input type="number" className="form-input" name="spo2" placeholder="98" value={formData.spo2} onChange={handleChange} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Respiratory Rate</label>
                    <input type="number" className="form-input" name="respiratory_rate" placeholder="breaths/min" value={formData.respiratory_rate} onChange={handleChange} />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Encounter Type</label>
                    <select className="form-input" name="encounter_type" value={formData.encounter_type} onChange={handleChange}>
                      <option value="OPD">OPD Triage</option>
                      <option value="IPD">IPD Rounds</option>
                      <option value="ER">Emergency</option>
                    </select>
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', margin: '20px 0', paddingTop: 16 }}>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 12 }}>Anthropometry</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                    <div className="form-group">
                      <label className="form-label">Weight (kg)</label>
                      <input type="number" step="0.1" className="form-input" name="weight_kg" value={formData.weight_kg} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Height (cm)</label>
                      <input type="number" step="0.1" className="form-input" name="height_cm" value={formData.height_cm} onChange={handleChange} />
                    </div>
                    <div className="form-group">
                      <label className="form-label">BMI</label>
                      <div style={{ padding: '9px 13px', background: 'var(--surface-2)', borderRadius: 10, fontWeight: 700, color: bmi && Number(bmi) > 25 ? '#ef4444' : '#10b981', border: '1px solid var(--border)' }}>
                        {bmi || '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end' }}>
                <button type="submit" className="btn btn-primary btn-lg" disabled={loading || !patient} style={{ minWidth: 180 }}>
                  {loading ? <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> : '💾 Record Vitals'}
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* RIGHT: Vitals History */}
        <div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '14px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(139,92,246,0.1)', fontSize: '0.85rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>📊</span>
              <h3 style={{ margin: 0, fontSize: '0.95rem' }}>Previous Vitals</h3>
              {vitalsHistory.length > 0 && (
                <span style={{ marginLeft: 'auto', padding: '2px 10px', borderRadius: 10, background: 'rgba(139,92,246,0.08)', color: '#8b5cf6', fontSize: '0.72rem', fontWeight: 700 }}>
                  {vitalsHistory.length} records
                </span>
              )}
            </div>

            <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              {!patient ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.4 }}>👤</div>
                  <div style={{ fontSize: '0.88rem' }}>Select a patient to view vitals history</div>
                </div>
              ) : historyLoading ? (
                <div style={{ padding: 48, textAlign: 'center' }}>
                  <div className="spinner" style={{ width: 28, height: 28, margin: '0 auto' }} />
                </div>
              ) : vitalsHistory.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                  <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.4 }}>📋</div>
                  <div style={{ fontSize: '0.88rem' }}>No previous vitals recorded</div>
                  <div style={{ fontSize: '0.78rem', marginTop: 6 }}>This will be the first entry for this patient</div>
                </div>
              ) : (
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {vitalsHistory.map((v, idx) => {
                    const recordedAt = v.recorded_at || v.RECORDED_AT || v.createdAt;
                    const recBy = v.recordedByUser?.name || v.RECORDED_BY_NAME || '';
                    const isLatest = idx === 0;
                    return (
                      <div key={v.id || idx} style={{
                        border: `1px solid ${isLatest ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`,
                        borderRadius: 14,
                        background: isLatest ? 'rgba(59,130,246,0.02)' : 'var(--surface)',
                        overflow: 'hidden',
                        transition: 'all 0.2s',
                      }}>
                        {/* Header: Date/Time & Badge */}
                        <div style={{
                          padding: '10px 16px',
                          background: isLatest ? 'rgba(59,130,246,0.05)' : 'var(--surface-2)',
                          borderBottom: '1px solid var(--border)',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        }}>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 8 }}>
                              📅 {formatDate(recordedAt)}
                              <span style={{ color: 'var(--text-muted)', fontWeight: 500, fontSize: '0.78rem' }}>at {formatTime(recordedAt)}</span>
                            </div>
                            {recBy && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>By: {recBy}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            {isLatest && <span style={{ padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', color: '#3b82f6', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Latest</span>}
                            <span style={{
                              padding: '2px 8px', borderRadius: 6, fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
                              background: (v.encounter_type || v.ENCOUNTER_TYPE) === 'IPD' ? 'rgba(139,92,246,0.08)' : (v.encounter_type || v.ENCOUNTER_TYPE) === 'ER' ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                              color: (v.encounter_type || v.ENCOUNTER_TYPE) === 'IPD' ? '#8b5cf6' : (v.encounter_type || v.ENCOUNTER_TYPE) === 'ER' ? '#ef4444' : '#10b981',
                            }}>{v.encounter_type || v.ENCOUNTER_TYPE || 'OPD'}</span>
                          </div>
                        </div>

                        {/* Vitals Grid */}
                        <div style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px 14px' }}>
                            {[
                              { label: 'BP', value: (v.bp_systolic || v.BP_SYSTOLIC) ? `${v.bp_systolic || v.BP_SYSTOLIC}/${v.bp_diastolic || v.BP_DIASTOLIC}` : null, unit: 'mmHg', color: getVitalColor('bp_systolic', v.bp_systolic || v.BP_SYSTOLIC), icon: '🫀' },
                              { label: 'Pulse', value: v.pulse || v.PULSE, unit: 'bpm', color: getVitalColor('pulse', v.pulse || v.PULSE), icon: '💓' },
                              { label: 'SpO2', value: v.spo2 || v.SPO2, unit: '%', color: getVitalColor('spo2', v.spo2 || v.SPO2), icon: '🫁' },
                              { label: 'Temp', value: v.temperature || v.TEMPERATURE, unit: `°${v.temp_unit || v.TEMP_UNIT || 'F'}`, color: getVitalColor('temperature', v.temperature || v.TEMPERATURE), icon: '🌡️' },
                              { label: 'Resp', value: v.respiratory_rate || v.RESPIRATORY_RATE, unit: '/min', icon: '💨' },
                              { label: 'Weight', value: v.weight_kg || v.WEIGHT_KG, unit: 'kg', icon: '⚖️' },
                            ].map(item => (
                              <div key={item.label} style={{
                                padding: '8px 10px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--border)',
                                textAlign: 'center',
                              }}>
                                <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4, fontWeight: 600 }}>
                                  {item.icon} {item.label}
                                </div>
                                <div style={{ fontWeight: 700, fontSize: '0.95rem', color: item.value ? (item.color || 'inherit') : 'var(--text-muted)' }}>
                                  {item.value || '—'}
                                  {item.value && <span style={{ fontSize: '0.65rem', fontWeight: 500, color: 'var(--text-muted)', marginLeft: 2 }}>{item.unit}</span>}
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* BMI & Alerts row */}
                          {((v.bmi || v.BMI) || (v.alerts || v.ALERTS)) && (
                            <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              {(v.bmi || v.BMI) && (
                                <span style={{ padding: '3px 10px', borderRadius: 8, background: Number(v.bmi || v.BMI) > 25 ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)', color: Number(v.bmi || v.BMI) > 25 ? '#ef4444' : '#10b981', fontSize: '0.72rem', fontWeight: 700 }}>
                                  BMI: {v.bmi || v.BMI}
                                </span>
                              )}
                              {(v.alerts || v.ALERTS) && (() => {
                                try {
                                  const parsed = typeof (v.alerts || v.ALERTS) === 'string' ? JSON.parse(v.alerts || v.ALERTS) : (v.alerts || v.ALERTS);
                                  if (Array.isArray(parsed) && parsed.length > 0) {
                                    return parsed.map(a => (
                                      <span key={a} style={{ padding: '3px 8px', borderRadius: 6, background: 'rgba(239,68,68,0.08)', color: '#ef4444', fontSize: '0.65rem', fontWeight: 700 }}>⚠ {a}</span>
                                    ));
                                  }
                                } catch(e) {}
                                return null;
                              })()}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
