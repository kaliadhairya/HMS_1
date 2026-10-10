import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, CircleAlert, CircleCheck, History, Save, Search, Stethoscope, TriangleAlert, UserRound, X } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import PatientBanner from '../../../components/patient/PatientBanner';

// /patients/hms/search returns raw SQL aliases (patient_name, phone_number); map them to the
// field names the rest of this page uses.
const normalizePatient = (p) => ({ ...p, name: p.name || p.patient_name, phoneNumber: p.phoneNumber || p.phone_number });
const ENCOUNTER_TONE = { IPD: 'info', ER: 'danger', OPD: 'neutral' };
const SEVERE_ALERTS = ['High BP', 'Low BP', 'Fever', 'Low SpO2', 'Tachycardia', 'Bradycardia'];

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

  // Allergies for the patient banner ('loading' | 'ok' | 'error')
  const [allergies, setAllergies] = useState([]);
  const [allergyStatus, setAllergyStatus] = useState('loading');

  // Form State
  const [formData, setFormData] = useState({
    encounter_type: 'OPD',
    bp_systolic: '', bp_diastolic: '', temperature: '', temp_unit: 'C',
    weight_kg: '', height_cm: '', spo2: '', pulse: '', respiratory_rate: '',
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

  // Allergies feed the patient banner, so it never claims "no known allergies" without checking.
  useEffect(() => {
    if (!patient?.id) { setAllergies([]); setAllergyStatus('loading'); return undefined; }
    let cancelled = false;
    setAllergyStatus('loading');
    api.get(`/patients/hms/${patient.id}/allergies`)
      .then((res) => { if (!cancelled) { setAllergies(res.data.data || []); setAllergyStatus('ok'); } })
      .catch(() => { if (!cancelled) { setAllergies([]); setAllergyStatus('error'); } });
    return () => { cancelled = true; };
  }, [patient?.id]);

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
        } catch (err) { /* ignore search errors */ }
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
      setFormData((prev) => ({ ...prev, bp_systolic: '', bp_diastolic: '', temperature: '', weight_kg: '', height_cm: '', spo2: '', pulse: '', respiratory_rate: '' }));
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

  // True when a recorded value is outside the normal range.
  const isAbnormal = (key, value, unit) => {
    if (!value && value !== 0) return false;
    const v = Number(value);
    if (key === 'bp_systolic' && (v > 140 || v < 90)) return true;
    if (key === 'bp_diastolic' && (v > 90 || v < 60)) return true;
    if (key === 'pulse' && (v > 100 || v < 60)) return true;
    if (key === 'spo2' && v < 95) return true;
    if (key === 'temperature') return unit === 'C' ? v > 37.5 : v > 99.5;
    return false;
  };

  const changePatient = () => { setPatient(null); setVitalsHistory([]); };
  const results = (Array.isArray(searchResults) ? searchResults : []).map(normalizePatient);
  const showBanner = Boolean(patient) && allergyStatus === 'ok';

  return (
    <>
      <Navbar />
      {showBanner && (
        <PatientBanner
          patient={patient}
          allergies={allergies}
          actions={!initialPatient && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={changePatient}>
              <X size={14} aria-hidden="true" /> Change patient
            </button>
          )}
        />
      )}
      <main className="app-page">
        <PageHeader
          title="Record vitals"
          description="Enter vital signs for triage assessment and monitoring."
          actions={(
            <button type="button" className="btn btn-ghost btn-md" onClick={() => navigate(-1)}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
          )}
        />

        {error && (
          <div className="alert-strip alert-danger" role="alert">
            <CircleAlert size={16} aria-hidden="true" /> {error}
          </div>
        )}
        {success && (
          <div className="alert-strip" role="status" style={{ background: 'var(--success-light)', borderColor: 'var(--success-border)', color: 'var(--success)' }}>
            <CircleCheck size={16} aria-hidden="true" /> Vitals recorded.
          </div>
        )}

        <div className="split-2" style={{ alignItems: 'start' }}>
          <div className="stack">
            {!showBanner && (
              <section className="panel">
                <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><UserRound size={16} aria-hidden="true" /> Patient</h2></div>
                <div className="panel-pad">
                  {patient ? (
                    <div className="stack-sm">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                        <span className="cell-person">
                          <span className="cell-avatar" aria-hidden="true">{(patient.name || '?').charAt(0).toUpperCase()}</span>
                          <span className="cell-stack">
                            <span className="cell-primary">{patient.name}</span>
                            <span className="cell-secondary">
                              <span className="mono">{patient.uhid || 'Legacy'}</span>
                              {patient.age ? ` · ${patient.age} y` : ''}{patient.gender ? ` · ${patient.gender}` : ''}
                            </span>
                          </span>
                        </span>
                        {!initialPatient && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={changePatient}>
                            <X size={14} aria-hidden="true" /> Change
                          </button>
                        )}
                      </div>
                      {allergyStatus === 'loading' && <p className="muted">Checking allergies…</p>}
                      {allergyStatus === 'error' && (
                        <div className="alert-strip alert-warning" role="status" style={{ marginBottom: 0 }}>
                          <TriangleAlert size={16} aria-hidden="true" /> Allergies could not be loaded. Check the patient record.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="stack-sm">
                      <label className="search-field">
                        <Search size={17} aria-hidden="true" />
                        <span className="sr-only">Search patient by name or UHID</span>
                        <input type="text" placeholder="Search patient name or UHID" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                      </label>
                      {results.length > 0 && (
                        <ul className="list-rows" aria-label="Matching patients" style={{ maxHeight: 260, overflowY: 'auto' }}>
                          {results.map((p) => (
                            <li key={p.id}>
                              <button type="button" className="list-row" onClick={() => { setPatient(p); setSearchQuery(''); }}>
                                <span className="cell-stack">
                                  <span className="cell-primary">{p.name}</span>
                                  <span className="cell-secondary mono">{p.uhid || 'Old record'}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      {!searchQuery && <p className="form-hint" style={{ marginTop: 0 }}>Type at least 3 characters to search.</p>}
                    </div>
                  )}
                </div>
              </section>
            )}

            <section className="panel">
              <div className="panel-head" style={{ flexWrap: 'wrap' }}>
                <h2 className="panel-title" style={{ margin: 0 }}><Stethoscope size={16} aria-hidden="true" /> Vital signs</h2>
                {alerts.length > 0 && (
                  <div className="chip-row" role="status" aria-label="Vital sign alerts">
                    {alerts.map((a) => <span key={a} className={`status ${SEVERE_ALERTS.includes(a) ? 'status-danger' : 'status-warning'}`}>{a}</span>)}
                  </div>
                )}
              </div>
              <form onSubmit={handleSubmit}>
                <div className="panel-pad stack">
                  <div className="form-row-2">
                    <div className="form-group">
                      <label className="form-label" htmlFor="v-bp-sys">Blood pressure (systolic / diastolic)</label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input id="v-bp-sys" type="number" className="form-input" name="bp_systolic" placeholder="120" aria-label="Systolic, mmHg" value={formData.bp_systolic} onChange={handleChange} />
                        <span style={{ color: 'var(--text-muted)', fontWeight: 600 }} aria-hidden="true">/</span>
                        <input type="number" className="form-input" name="bp_diastolic" placeholder="80" aria-label="Diastolic, mmHg" value={formData.bp_diastolic} onChange={handleChange} />
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="v-temp">Temperature</label>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <input id="v-temp" type="number" step="0.1" className="form-input" name="temperature" placeholder="98.6" value={formData.temperature} onChange={handleChange} style={{ flex: 2, minWidth: 0 }} />
                        <select className="form-select" name="temp_unit" aria-label="Temperature unit" value={formData.temp_unit} onChange={handleChange} style={{ flex: 1, maxWidth: 80 }}>
                          <option value="C">°C</option>
                          <option value="F">°F</option>
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="v-pulse">Heart rate (bpm)</label>
                      <input id="v-pulse" type="number" className="form-input" name="pulse" placeholder="bpm" value={formData.pulse} onChange={handleChange} />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="v-spo2">SpO2 (%)</label>
                      <input id="v-spo2" type="number" className="form-input" name="spo2" placeholder="98" value={formData.spo2} onChange={handleChange} />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="v-rr">Respiratory rate (breaths/min)</label>
                      <input id="v-rr" type="number" className="form-input" name="respiratory_rate" placeholder="breaths/min" value={formData.respiratory_rate} onChange={handleChange} />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="v-encounter">Encounter type</label>
                      <select id="v-encounter" className="form-select" name="encounter_type" value={formData.encounter_type} onChange={handleChange}>
                        <option value="OPD">OPD triage</option>
                        <option value="IPD">IPD rounds</option>
                        <option value="ER">Emergency</option>
                      </select>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
                    <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Anthropometry</h3>
                    <div className="form-grid-3">
                      <div className="form-group">
                        <label className="form-label" htmlFor="v-weight">Weight (kg)</label>
                        <input id="v-weight" type="number" step="0.1" className="form-input" name="weight_kg" value={formData.weight_kg} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="v-height">Height (cm)</label>
                        <input id="v-height" type="number" step="0.1" className="form-input" name="height_cm" value={formData.height_cm} onChange={handleChange} />
                      </div>
                      <div className="form-group">
                        <span className="form-label" id="v-bmi-label">BMI</span>
                        <div
                          aria-labelledby="v-bmi-label"
                          className="tabular"
                          style={{
                            padding: '9px 13px', background: 'var(--surface-2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                            fontWeight: 600, color: bmi && Number(bmi) > 25 ? 'var(--amber)' : 'var(--text-primary)',
                          }}
                        >
                          {bmi || '—'}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ padding: '12px 18px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'flex-end', borderRadius: '0 0 10px 10px' }}>
                  <button type="submit" className="btn btn-primary btn-md" disabled={loading || !patient}>
                    <Save size={16} aria-hidden="true" /> {loading ? 'Saving…' : 'Record vitals'}
                  </button>
                </div>
              </form>
            </section>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2 className="panel-title" style={{ margin: 0 }}><History size={16} aria-hidden="true" /> Previous vitals</h2>
              {vitalsHistory.length > 0 && <span className="muted">{vitalsHistory.length} records</span>}
            </div>

            <div style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              {!patient ? (
                <div className="empty-state">
                  <span className="empty-state-icon"><UserRound size={22} strokeWidth={1.75} aria-hidden="true" /></span>
                  <h3>No patient selected</h3>
                  <p>Select a patient to see their vitals history.</p>
                </div>
              ) : historyLoading ? (
                <div className="panel-pad"><p className="muted">Loading…</p></div>
              ) : vitalsHistory.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-icon"><History size={22} strokeWidth={1.75} aria-hidden="true" /></span>
                  <h3>No previous vitals</h3>
                  <p>This will be the first entry for this patient.</p>
                </div>
              ) : (
                <ol style={{ listStyle: 'none', padding: 12, display: 'grid', gap: 10 }}>
                  {vitalsHistory.map((v, idx) => {
                    const recordedAt = v.recorded_at || v.RECORDED_AT || v.createdAt;
                    const recBy = v.recordedByUser?.name || v.RECORDED_BY_NAME || '';
                    const isLatest = idx === 0;
                    const encType = v.encounter_type || v.ENCOUNTER_TYPE || 'OPD';
                    const tempUnit = v.temp_unit || v.TEMP_UNIT || 'F';
                    const bmiVal = v.bmi || v.BMI;
                    const sys = v.bp_systolic || v.BP_SYSTOLIC;
                    const dia = v.bp_diastolic || v.BP_DIASTOLIC;
                    const items = [
                      { label: 'BP', value: sys ? `${sys}/${dia}` : null, unit: 'mmHg', abnormal: isAbnormal('bp_systolic', sys) || isAbnormal('bp_diastolic', dia) },
                      { label: 'Pulse', value: v.pulse || v.PULSE, unit: 'bpm', abnormal: isAbnormal('pulse', v.pulse || v.PULSE) },
                      { label: 'SpO2', value: v.spo2 || v.SPO2, unit: '%', abnormal: isAbnormal('spo2', v.spo2 || v.SPO2) },
                      { label: 'Temp', value: v.temperature || v.TEMPERATURE, unit: `°${tempUnit}`, abnormal: isAbnormal('temperature', v.temperature || v.TEMPERATURE, tempUnit) },
                      { label: 'Resp', value: v.respiratory_rate || v.RESPIRATORY_RATE, unit: '/min' },
                      { label: 'Weight', value: v.weight_kg || v.WEIGHT_KG, unit: 'kg' },
                    ];
                    let recordAlerts = [];
                    const rawAlerts = v.alerts || v.ALERTS;
                    if (rawAlerts) {
                      try {
                        const parsed = typeof rawAlerts === 'string' ? JSON.parse(rawAlerts) : rawAlerts;
                        if (Array.isArray(parsed)) recordAlerts = parsed;
                      } catch (e) { /* ignore malformed alerts */ }
                    }
                    return (
                      <li
                        key={v.id || idx}
                        style={{ border: `1px solid ${isLatest ? 'var(--primary-border)' : 'var(--border)'}`, borderRadius: 8, overflow: 'hidden', background: 'var(--surface)' }}
                      >
                        <div style={{ padding: '10px 14px', background: isLatest ? 'var(--primary-light)' : 'var(--surface-2)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          <div className="cell-stack">
                            <span style={{ fontWeight: 600, fontSize: '0.86rem', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                              <CalendarDays size={14} aria-hidden="true" /> {formatDate(recordedAt)}
                              <span className="cell-secondary" style={{ fontWeight: 500 }}>at {formatTime(recordedAt)}</span>
                            </span>
                            {recBy && <span className="cell-secondary">By {recBy}</span>}
                          </div>
                          <div className="chip-row">
                            {isLatest && <span className="status status-info">Latest</span>}
                            <span className={`status status-${ENCOUNTER_TONE[encType] || 'neutral'}`}>{encType}</span>
                          </div>
                        </div>

                        <div style={{ padding: '12px 14px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px 14px' }}>
                            {items.map((item) => (
                              <div key={item.label}>
                                <div className="fact-label">{item.label}</div>
                                <div className="fact-value tabular" style={{ fontWeight: 600, color: !item.value ? 'var(--text-muted)' : item.abnormal ? 'var(--red)' : 'var(--text-primary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                  {item.value && item.abnormal && <TriangleAlert size={13} aria-hidden="true" />}
                                  {item.value || '—'}
                                  {item.value && <span style={{ fontSize: '0.72rem', fontWeight: 500, color: 'var(--text-muted)' }}>{item.unit}</span>}
                                  {item.value && item.abnormal && <span className="sr-only">(out of range)</span>}
                                </div>
                              </div>
                            ))}
                          </div>

                          {(bmiVal || recordAlerts.length > 0) && (
                            <div className="chip-row" style={{ marginTop: 10 }}>
                              {bmiVal && <span className={`status ${Number(bmiVal) > 25 ? 'status-warning' : 'status-neutral'}`}>BMI {bmiVal}</span>}
                              {recordAlerts.map((a) => <span key={a} className="status status-danger">{a}</span>)}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
