import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

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
      toast.success('Consultation Finalized successfully!');
      clearPatient();
    } catch (err) { 
      toast.error('Failed to finalize encounter'); 
    }
  };

  return (
    <>
    <Navbar />
    <div style={{ display: 'flex', height: 'calc(100vh - 61px)' }}>
      {/* LEFT PANEL: Context & Search */}
      <div style={{ width: '30%', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', padding: 20, overflowY: 'auto' }}>
        
        {!activePatient ? (
          <div>
            <h2 style={{ fontSize: '1.25rem', marginBottom: 16 }}>🔍 Quick Consult Search</h2>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
              Enter a patient's name, ID, or UHID to instantly pull their profile, lab reports, and begin consultation.
            </p>
            <input 
              type="text" 
              className="form-input" 
              placeholder="Search patients..." 
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              autoFocus
            />

            {isSearching && <div style={{marginTop: 10, fontSize: '0.85rem', color: 'var(--text-muted)'}}>Searching...</div>}

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {searchResults.map(p => (
                <div key={p.id || p.ID} className="card" onClick={() => selectPatient(p)} style={{ cursor: 'pointer', padding: 16, borderLeft: '4px solid var(--primary)' }}>
                  <div style={{ fontWeight: 600 }}>{p.name} {p.last_name || ''}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                    UHID: {p.uhid || 'Legacy'} • {p.age} Yrs • {p.gender}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div>
            <button className="btn btn-sm btn-ghost" onClick={clearPatient} style={{ marginBottom: 16 }}>← Back to Search</button>
            <h2 style={{ fontSize: '1.2rem', marginBottom: 10 }}>{activePatient.name}</h2>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
              <p><strong>UHID:</strong> {activePatient.uhid}</p>
              <p><strong>Age/Sex:</strong> {activePatient.age} / {activePatient.gender}</p>
              <p><strong>Blood:</strong> <span className="badge badge-red">{activePatient.blood_group || 'Unknown'}</span></p>
              <p><strong>Phone:</strong> {activePatient.phoneNumber || '-'}</p>
            </div>

            {vitals ? (
              <div className="card-section" style={{marginBottom: 16}}>
                <div className="card-section-title">Today's Vitals</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.85rem' }}>
                  <div><strong>BP:</strong> {vitals.bp_systolic}/{vitals.bp_diastolic}</div>
                  <div><strong>Pulse:</strong> {vitals.pulse} bpm</div>
                  <div><strong>Temp:</strong> {vitals.temperature}°F</div>
                  <div><strong>SpO2:</strong> {vitals.spo2}%</div>
                </div>
              </div>
            ) : (
              <div className="alert alert-error" style={{marginBottom: 16}}>No vitals recorded today.</div>
            )}
			
            {/* Embedded Lab Reports */}
            <div className="card-section">
              <div className="card-section-title">Recent Lab Reports</div>
              {labReports.length === 0 ? (
                <p style={{fontSize: '0.8rem', color: 'var(--text-muted)'}}>No lab reports found.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {labReports.map((lr, i) => (
                    <div key={i} style={{ padding: '8px 12px', background: 'var(--surface)', borderRadius: 6, fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{new Date(lr.date).toLocaleDateString()}</strong>
                        <div style={{color: 'var(--text-muted)'}}>Routine Investigation</div>
                      </div>
                      <button className="btn btn-xs btn-outline" onClick={() => window.open(`/report/${lr.reference_id}`)}>View</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>

      {/* RIGHT PANEL: Docs */}
      {activePatient && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
            {['history', 'diagnosis', 'prescription'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '14px', background: 'none', border: 'none', cursor: 'pointer',
                  fontFamily: 'var(--font-body)', fontWeight: 600, fontSize: '0.85rem',
                  borderBottom: activeTab === tab ? '3px solid var(--green)' : '3px solid transparent',
                  color: activeTab === tab ? 'var(--text-primary)' : 'var(--text-secondary)',
                  textTransform: 'capitalize'
                }}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Content Area */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {activeTab === 'history' && (
              <div className="card form-group fade-up">
                <label className="form-label">Chief Complaint</label>
                <textarea name="chief_complaint" className="form-textarea" value={formData.chief_complaint} onChange={handleInputChange} />

                <label className="form-label" style={{ marginTop: 15 }}>History of Present Illness</label>
                <textarea name="hopi" className="form-textarea" value={formData.hopi} onChange={handleInputChange} style={{ minHeight: 120 }} />

                <label className="form-label" style={{ marginTop: 15 }}>General Examination Findings</label>
                <textarea name="general_examination" className="form-textarea" value={formData.general_examination} onChange={handleInputChange} style={{ minHeight: 80 }} />
              </div>
            )}

            {activeTab === 'diagnosis' && (
              <div className="card fade-up">
                <label className="form-label">Search ICD-10 Code</label>
                <div style={{ position: 'relative' }}>
                  <input type="text" className="form-input" value={icdSearch} onChange={(e) => searchIcd(e.target.value)} placeholder="Type condition or ICD code..." />
                  {icdResults.length > 0 && (
                    <div style={{ position: 'absolute', top: 40, left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', zIndex: 10, boxShadow: 'var(--shadow-md)', borderRadius: 5 }}>
                      {icdResults.map(r => (
                        <div key={r.code} onClick={() => addDiagnosis(r)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg)' }}>
                          <strong>{r.code}</strong> - {r.description}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: 20 }}>
                  <div className="card-section-title">Current Diagnoses</div>
                  {diagnoses.length === 0 ? <p style={{fontSize:'0.85rem', color: 'var(--text-muted)'}}>No diagnoses added.</p> : (
                    <table className="test-table">
                      <thead><tr><th>Code</th><th>Description</th><th>Type</th><th>Action</th></tr></thead>
                      <tbody>
                        {diagnoses.map(d => (
                          <tr key={d.id}>
                            <td><strong>{d.icd10_code}</strong></td>
                            <td>{d.icd10_description}</td>
                            <td><span className="badge badge-teal">{d.diagnosis_type}</span></td>
                            <td><button className="btn btn-sm btn-danger" onClick={() => removeDiagnosis(d.id)}>Remove</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'prescription' && (
              <div className="card fade-up">
                <label className="form-label">Search Medicine to Prescribe</label>
                <div style={{ position: 'relative' }}>
                  <input type="text" className="form-input" value={medSearch} onChange={(e) => searchMed(e.target.value)} placeholder="Type drug generic or brand name..." />
                  {medResults.length > 0 && (
                    <div style={{ position: 'absolute', top: 40, left: 0, right: 0, background: 'var(--surface)', border: '1px solid var(--border)', zIndex: 10, boxShadow: 'var(--shadow-md)', borderRadius: 5, maxHeight: 300, overflowY: 'auto' }}>
                      {medResults.map(m => (
                        <div key={m.id} onClick={() => addPrescriptionItem(m)} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--bg)' }}>
                          <strong>{m.generic_name}</strong> {m.brand_names ? `(${JSON.parse(m.brand_names).join(', ')})` : ''} - <small>{m.formulation} {m.strength} {m.strength_unit}</small>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="table-wrapper" style={{ marginTop: 20 }}>
                  <table className="test-table">
                    <thead><tr><th>Medicine</th><th>Dose</th><th>Unit</th><th>Route</th><th>Freq</th><th>Days</th><th>Action</th></tr></thead>
                    <tbody>
                      {prescriptionItems.length === 0 && <tr><td colSpan="7" style={{textAlign: 'center'}}>No medicines prescribed yet.</td></tr>}
                      {prescriptionItems.map((item, idx) => (
                        <tr key={idx}>
                          <td><strong>{item.medicine_name}</strong></td>
                          <td><input type="text" className="result-input" value={item.dose} onChange={e => updateItem(idx, 'dose', e.target.value)} /></td>
                          <td><input type="text" className="result-input" value={item.dose_unit} onChange={e => updateItem(idx, 'dose_unit', e.target.value)} /></td>
                          <td><input type="text" className="result-input" value={item.route} onChange={e => updateItem(idx, 'route', e.target.value)} /></td>
                          <td><input type="text" className="result-input" value={item.frequency} onChange={e => updateItem(idx, 'frequency', e.target.value)} /></td>
                          <td><input type="number" className="result-input" value={item.duration_days} onChange={e => updateItem(idx, 'duration_days', e.target.value)} style={{width: 60}} /></td>
                          <td><button className="btn btn-sm btn-ghost" onClick={() => removeRxItem(idx)}>❌</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM Sticky Bar */}
          <div style={{ padding: '16px 24px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Consulting: <strong>{activePatient?.name}</strong> 
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-primary" onClick={finalizeEncounter}>✔ Finalize & Close</button>
            </div>
          </div>

        </div>
      )}
    </div>
    </>
  );
}
