import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { ArrowLeft, ArrowRight, CircleCheck, FlaskConical, HeartPulse, Search, UserRound, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const rxInputStyle = { height: 32, padding: '4px 8px', minWidth: 64 };

export default function DoctorQuickConsultPage() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [activePatient, setActivePatient] = useState(null);
  const [activeEncounterId, setActiveEncounterId] = useState(null);

  // Tab State
  const [activeTab, setActiveTab] = useState('history');

  // Encounter State
  const [vitals, setVitals] = useState(null);
  const [labOrders, setLabOrders] = useState([]);
  const [labReports, setLabReports] = useState([]);
  const [formData, setFormData] = useState({
    chief_complaint: '', hopi: '', past_medical_history: '',
    general_examination: '', cvs_findings: '', rs_findings: ''
  });
  const [diagnoses, setDiagnoses] = useState([]);
  const [icdSearch, setIcdSearch] = useState('');
  const [icdResults, setIcdResults] = useState([]);

  // Prescription State
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState([]);

  // Patient Search Logic
  useEffect(() => {
    const delayDebounce = setTimeout(() => {
      if (searchQuery.trim().length >= 2) {
        performSearch(searchQuery);
      } else {
        setSearchResults([]);
      }
    }, 500);
    return () => clearTimeout(delayDebounce);
  }, [searchQuery]);

  const performSearch = async (q) => {
    try {
      setIsSearching(true);
      const res = await api.get(`/patients/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  const selectPatient = async (patient) => {
    setActivePatient(patient);
    setSearchQuery('');
    setSearchResults([]);
    setActiveTab('history');
    
    // Automatically create ad-hoc encounter if none active, or fetch latest
    try {
      const payload = {
        patient_id: patient.id || patient.ID,
        department_id: 1, // Generic OPD
        encounter_type: 'OPD'
      };
      const res = await api.post('/hms/encounters', payload);
      setActiveEncounterId(res.data.id);
      
      // Load patient context (Vitals, Lab Reports)
      const vp = await api.get(`/hms/vitals/latest/${patient.id || patient.ID}`);
      if (vp.data.success) setVitals(vp.data.vital);
      
      // Fetch historic lab reports for this patient directly into their profile
      const rpRes = await api.get(`/patients/hms/${patient.id || patient.ID}/visits`);
      const allVisits = rpRes.data.data || [];
      const labs = allVisits.filter(v => v.type === 'Lab Test');
      setLabReports(labs);

    } catch (error) {
      toast.error('Could not initialize consultation session.');
    }
  };

  const clearPatient = () => {
    setActivePatient(null);
    setActiveEncounterId(null);
    setVitals(null);
    setLabReports([]);
    setDiagnoses([]);
    setPrescriptionItems([]);
    setFormData({ chief_complaint: '', hopi: '', past_medical_history: '', general_examination: '', cvs_findings: '', rs_findings: '' });
  };

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // ─── Diagnosis Handlers ───
  const searchIcd = async (q) => {
    setIcdSearch(q);
    if (q.length < 2) return setIcdResults([]);
    try {
      const res = await api.get(`/hms/icd10/search?q=${q}`);
      setIcdResults(res.data);
    } catch (err) { console.error(err); }
  };

  const addDiagnosis = async (icd) => {
    try {
      const payload = {
        encounter_id: activeEncounterId,
        icd10_code: icd.code,
        icd10_description: icd.description,
        diagnosis_type: 'Primary',
        status: 'Provisional'
      };
      const res = await api.post('/hms/diagnoses', payload);
      setDiagnoses([...diagnoses, res.data]);
      setIcdSearch('');
      setIcdResults([]);
      toast.success('Diagnosis added');
    } catch (err) {
      toast.error('Failed to add diagnosis');
    }
  };

  const removeDiagnosis = async (dxId) => {
    try {
      await api.delete(`/hms/diagnoses/${dxId}`);
      setDiagnoses(diagnoses.filter(d => d.id !== dxId));
    } catch (err) { toast.error('Failed to remove diagnosis'); }
  };

  // ─── Prescription Handlers ───
  const searchMed = async (q) => {
    setMedSearch(q);
    if (q.length < 2) return setMedResults([]);
    try {
      const res = await api.get(`/hms/medicines/search?q=${q}`);
      setMedResults(res.data);
    } catch (err) { console.error(err); }
  };

  const addPrescriptionItem = (med) => {
    setPrescriptionItems([...prescriptionItems, {
      medicine_name: med.generic_name,
      dose: '1', dose_unit: 'Tablet', route: 'Oral', frequency: 'BD', duration_days: 5, instructions: 'After meal'
    }]);
    setMedSearch('');
    setMedResults([]);
  };

  const updateItem = (index, field, val) => {
    const updated = [...prescriptionItems];
    updated[index][field] = val;
    setPrescriptionItems(updated);
  };

  const removeRxItem = (index) => {
    setPrescriptionItems(prescriptionItems.filter((_, i) => i !== index));
  };

  // ─── Finalize ───
  const finalizeEncounter = async () => {
    try {
      // Save forms
      await api.put(`/hms/encounters/${activeEncounterId}`, formData);
      
      // Save prescription
      if (prescriptionItems.length > 0) {
        const pRes = await api.post('/hms/prescriptions', { encounter_id: activeEncounterId, patient_id: activePatient.id || activePatient.ID });
        const presId = pRes.data.id;
        await api.put(`/hms/prescriptions/${presId}/items`, { items: prescriptionItems });
      }

      await api.patch(`/hms/encounters/${activeEncounterId}/finalize`, {});
      toast.success('Consultation finalized');
      clearPatient();
    } catch (err) { 
      toast.error('Failed to finalize encounter'); 
    }
  };

  const TABS = [['history', 'History'], ['diagnosis', 'Diagnosis'], ['prescription', 'Prescription']];
  const dropdownStyle = {
    position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10, padding: 6,
    background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)',
    maxHeight: 300, overflowY: 'auto',
  };

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Quick consult"
        description={activePatient
          ? `Consulting ${activePatient.name}. Record history, diagnoses and medicines, then finalize.`
          : "Find a patient to pull up their profile and lab reports and start a consultation."}
        actions={activePatient && (
          <button type="button" className="btn btn-ghost btn-md" onClick={clearPatient}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to search
          </button>
        )}
      />

      {!activePatient ? (
        <section className="panel panel-pad" style={{ maxWidth: 720 }}>
          <label className="search-field" style={{ maxWidth: 'none' }}>
            <Search size={17} aria-hidden="true" />
            <span className="sr-only">Search patients</span>
            <input
              type="text"
              placeholder="Search patient name, ID or UHID"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />
          </label>

          {isSearching && <p className="muted" style={{ marginTop: 10 }}>Searching…</p>}

          {searchResults.length > 0 && (
            <ul className="list-rows" style={{ marginTop: 16 }}>
              {searchResults.map(p => (
                <li key={p.id || p.ID}>
                  <button type="button" className="list-row" onClick={() => selectPatient(p)}>
                    <span className="cell-person">
                      <span className="cell-avatar" aria-hidden="true">{(p.name || '?').charAt(0).toUpperCase()}</span>
                      <span className="cell-stack">
                        <span className="cell-primary">{p.name} {p.last_name || ''}</span>
                        <span className="cell-secondary"><span className="mono">{p.uhid || 'Legacy'}</span> · {p.age} y · {p.gender}</span>
                      </span>
                    </span>
                    <ArrowRight size={16} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
          {/* Patient context */}
          <aside className="stack" style={{ flex: '1 1 280px', maxWidth: 400, minWidth: 0 }}>
            <section className="panel panel-pad">
              <h2 className="panel-title"><UserRound size={16} aria-hidden="true" /> {activePatient.name}</h2>
              <div className="facts">
                <div><div className="fact-label">UHID</div><div className="fact-value mono">{activePatient.uhid}</div></div>
                <div><div className="fact-label">Age / sex</div><div className="fact-value">{activePatient.age} / {activePatient.gender}</div></div>
                <div><div className="fact-label">Blood group</div><div className="fact-value">{activePatient.blood_group || 'Unknown'}</div></div>
                <div><div className="fact-label">Phone</div><div className="fact-value tabular">{activePatient.phoneNumber || '—'}</div></div>
              </div>
            </section>

            <section className="panel panel-pad">
              <h2 className="panel-title"><HeartPulse size={16} aria-hidden="true" /> Today&apos;s vitals</h2>
              {vitals ? (
                <div className="facts">
                  <div><div className="fact-label">BP</div><div className="fact-value tabular">{vitals.bp_systolic}/{vitals.bp_diastolic}</div></div>
                  <div><div className="fact-label">Pulse</div><div className="fact-value tabular">{vitals.pulse} bpm</div></div>
                  <div><div className="fact-label">Temperature</div><div className="fact-value tabular">{vitals.temperature}°F</div></div>
                  <div><div className="fact-label">SpO2</div><div className="fact-value tabular">{vitals.spo2}%</div></div>
                </div>
              ) : (
                <div className="alert-strip alert-warning" style={{ marginBottom: 0 }}>No vitals recorded today.</div>
              )}
            </section>

            <section className="panel panel-pad">
              <h2 className="panel-title"><FlaskConical size={16} aria-hidden="true" /> Recent lab reports</h2>
              {labReports.length === 0 ? (
                <p className="muted">No lab reports found.</p>
              ) : (
                <ul className="list-rows">
                  {labReports.map((lr, i) => (
                    <li key={i} className="list-row" style={{ cursor: 'default' }}>
                      <span className="cell-stack">
                        <span className="cell-primary tabular">{new Date(lr.date).toLocaleDateString()}</span>
                        <span className="cell-secondary">Routine investigation</span>
                      </span>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.open(`/report/${lr.reference_id}`)}>View</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>

          {/* Documentation */}
          <section className="panel" style={{ flex: '3 1 520px', minWidth: 0 }}>
            <div className="tabs" role="tablist" aria-label="Consultation sections">
              {TABS.map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab}
                  className={`tab${activeTab === tab ? ' is-active' : ''}`}
                  onClick={() => setActiveTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="panel-pad">
              {activeTab === 'history' && (
                <div className="stack">
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-chief-complaint">Chief complaint</label>
                    <textarea id="qc-chief-complaint" name="chief_complaint" className="form-textarea" value={formData.chief_complaint} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-hopi">History of present illness</label>
                    <textarea id="qc-hopi" name="hopi" className="form-textarea" value={formData.hopi} onChange={handleInputChange} style={{ minHeight: 120 }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-general-exam">General examination findings</label>
                    <textarea id="qc-general-exam" name="general_examination" className="form-textarea" value={formData.general_examination} onChange={handleInputChange} style={{ minHeight: 80 }} />
                  </div>
                </div>
              )}

              {activeTab === 'diagnosis' && (
                <div className="stack">
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-icd-search">Search ICD-10 code</label>
                    <div style={{ position: 'relative' }}>
                      <input id="qc-icd-search" type="text" className="form-input" value={icdSearch} onChange={(e) => searchIcd(e.target.value)} placeholder="Type a condition or ICD code" autoComplete="off" />
                      {icdResults.length > 0 && (
                        <ul className="list-rows" style={dropdownStyle}>
                          {icdResults.map(r => (
                            <li key={r.code}>
                              <button type="button" className="list-row" onClick={() => addDiagnosis(r)} style={{ justifyContent: 'flex-start' }}>
                                <span className="mono" style={{ fontWeight: 600 }}>{r.code}</span> {r.description}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Current diagnoses</h3>
                    {diagnoses.length === 0 ? <p className="muted">No diagnoses added.</p> : (
                      <table className="mini-table">
                        <thead><tr><th>Code</th><th>Description</th><th>Type</th><th><span className="sr-only">Actions</span></th></tr></thead>
                        <tbody>
                          {diagnoses.map(d => (
                            <tr key={d.id}>
                              <td className="mono">{d.icd10_code}</td>
                              <td>{d.icd10_description}</td>
                              <td><span className="status status-info">{d.diagnosis_type}</span></td>
                              <td className="text-right">
                                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeDiagnosis(d.id)}>Remove</button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                </div>
              )}

              {activeTab === 'prescription' && (
                <div className="stack">
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-med-search">Search medicine to prescribe</label>
                    <div style={{ position: 'relative' }}>
                      <input id="qc-med-search" type="text" className="form-input" value={medSearch} onChange={(e) => searchMed(e.target.value)} placeholder="Type a generic or brand name" autoComplete="off" />
                      {medResults.length > 0 && (
                        <ul className="list-rows" style={dropdownStyle}>
                          {medResults.map(m => (
                            <li key={m.id}>
                              <button type="button" className="list-row" onClick={() => addPrescriptionItem(m)}>
                                <span className="cell-stack">
                                  <span className="cell-primary">{m.generic_name} {m.brand_names ? `(${JSON.parse(m.brand_names).join(', ')})` : ''}</span>
                                  <span className="cell-secondary">{m.formulation} {m.strength} {m.strength_unit}</span>
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div style={{ overflowX: 'auto' }}>
                    <table className="mini-table">
                      <thead><tr><th>Medicine</th><th>Dose</th><th>Unit</th><th>Route</th><th>Frequency</th><th>Days</th><th><span className="sr-only">Actions</span></th></tr></thead>
                      <tbody>
                        {prescriptionItems.length === 0 && <tr><td colSpan="7" className="muted" style={{ textAlign: 'center' }}>No medicines prescribed yet.</td></tr>}
                        {prescriptionItems.map((item, idx) => (
                          <tr key={idx}>
                            <td className="cell-primary">{item.medicine_name}</td>
                            <td><input type="text" className="form-input" style={rxInputStyle} aria-label={`Dose for ${item.medicine_name}`} value={item.dose} onChange={e => updateItem(idx, 'dose', e.target.value)} /></td>
                            <td><input type="text" className="form-input" style={rxInputStyle} aria-label={`Dose unit for ${item.medicine_name}`} value={item.dose_unit} onChange={e => updateItem(idx, 'dose_unit', e.target.value)} /></td>
                            <td><input type="text" className="form-input" style={rxInputStyle} aria-label={`Route for ${item.medicine_name}`} value={item.route} onChange={e => updateItem(idx, 'route', e.target.value)} /></td>
                            <td><input type="text" className="form-input" style={rxInputStyle} aria-label={`Frequency for ${item.medicine_name}`} value={item.frequency} onChange={e => updateItem(idx, 'frequency', e.target.value)} /></td>
                            <td><input type="number" className="form-input" style={{ ...rxInputStyle, width: 70 }} aria-label={`Days for ${item.medicine_name}`} value={item.duration_days} onChange={e => updateItem(idx, 'duration_days', e.target.value)} /></td>
                            <td className="text-right">
                              <button type="button" className="icon-btn" onClick={() => removeRxItem(idx)} aria-label={`Remove ${item.medicine_name}`}>
                                <X size={16} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>

            <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="muted">Consulting <strong>{activePatient?.name}</strong></span>
              <button type="button" className="btn btn-primary btn-md" onClick={finalizeEncounter}>
                <CircleCheck size={16} aria-hidden="true" /> Finalize and close
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
    </>
  );
}
