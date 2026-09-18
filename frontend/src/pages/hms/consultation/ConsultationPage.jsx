import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import Navbar from '../../../components/Navbar';

export default function ConsultationPage() {
  const { id } = useParams(); // Encounter ID
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('history');
  
  // Data State
  const [encounter, setEncounter] = useState(null);
  const [patient, setPatient] = useState(null);
  const [vitals, setVitals] = useState(null);
  const [loading, setLoading] = useState(true);

  // Form State
  const [formData, setFormData] = useState({
    chief_complaint: '', hopi: '', past_medical_history: '',
    surgical_history: '', family_history: '', social_history: '', current_medications: '',
    general_examination: '', cvs_findings: '', rs_findings: '', abdomen_findings: '', cns_findings: ''
  });

  // Diagnoses State
  const [diagnoses, setDiagnoses] = useState([]);
  const [icdSearch, setIcdSearch] = useState('');
  const [icdResults, setIcdResults] = useState([]);

  // Prescription State
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState([]);

  // Lab Orders State
  const [labOrders, setLabOrders] = useState([]);
  const [newLabTest, setNewLabTest] = useState('');
  const [labCategory, setLabCategory] = useState('Haematology');

  useEffect(() => {
    fetchEncounterData();
  }, [id]);

  const fetchEncounterData = async () => {
    try {
      const res = await api.get(`/hms/encounters/${id}`);
      const enc = res.data;
      setEncounter(enc);
      setPatient(enc.patient);
      setDiagnoses(enc.diagnoses || []);
      
      if (enc.Prescriptions && enc.Prescriptions.length > 0) {
        setPrescriptionItems(enc.Prescriptions[0].items || []);
      }
      if (enc.InvestigationOrders && enc.InvestigationOrders.length > 0) {
        setLabOrders(enc.InvestigationOrders[0].items || []);
      }

      setFormData({
        chief_complaint: enc.chief_complaint || '',
        hopi: enc.hopi || '',
        past_medical_history: enc.past_medical_history || '',
        surgical_history: enc.surgical_history || '',
        family_history: enc.family_history || '',
        social_history: enc.social_history || '',
        current_medications: enc.current_medications || '',
        general_examination: enc.general_examination || '',
        cvs_findings: enc.cvs_findings || '',
        rs_findings: enc.rs_findings || '',
        abdomen_findings: enc.abdomen_findings || '',
        cns_findings: enc.cns_findings || ''
      });

      // Fetch latest vitals
      if (enc.patient_id) {
        const vitRes = await api.get(`/hms/vitals/latest/${enc.patient_id}`);
        if (vitRes.data.success) {
          setVitals(vitRes.data.vital);
        }
      }

    } catch (err) {
      console.error(err);
      toast.error('Failed to load consultation data');
    } finally {
      setLoading(false);
    }
  };

  // ─── Autosave logic (Every 60s when typing) ───
  useEffect(() => {
    if (!encounter) return;
    const timeout = setTimeout(() => {
      saveEncounter(false);
    }, 60000); // 60s
    return () => clearTimeout(timeout);
  }, [formData]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const saveEncounter = async (showToast = true) => {
    try {
      await api.put(`/hms/encounters/${id}`, formData);
      if (showToast) toast.success('Consultation Auto-saved', { icon: '💾' });
    } catch (err) {
      console.error(err);
      if (showToast) toast.error('Failed to save consultation');
    }
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
        encounter_id: id,
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

  const savePrescription = async () => {
    try {
      // 1. Ensure Presc shell exists
      const pRes = await api.post('/hms/prescriptions', { encounter_id: id, patient_id: patient.id });
      const presId = pRes.data.id;
      // 2. Put items
      await api.put(`/hms/prescriptions/${presId}/items`, { items: prescriptionItems });
      toast.success('Prescription Saved');
    } catch (err) { toast.error('Failed to save prescription'); }
  };

  // ─── Investigations Handlers ───
  const addLabOrder = (e) => {
    e.preventDefault();
    if (!newLabTest) return;
    setLabOrders([...labOrders, { id: Date.now(), name: newLabTest, category: labCategory }]);
    setNewLabTest('');
  };

  const submitLabOrder = async () => {
    try {
      if (labOrders.length === 0) return toast.error('Add tests to submit');
      const payload = {
        encounter_id: id,
        patient_id: patient.id,
        order_type: 'Lab',
        urgency: 'Routine',
        items: labOrders.map(lo => ({ name: lo.name, category: lo.category }))
      };
      await api.post('/hms/investigation-orders', payload);
      toast.success('Lab Order sent to Tech Queue!');
    } catch (err) { toast.error('Failed to submit lab order'); }
  };

  // ─── Finalize ───
  const finalizeEncounter = async () => {
    if (!confirm('Are you sure you want to finalize this encounter? No changes can be made after finalization.')) return;
    try {
      await saveEncounter(false);
      await savePrescription();
      
      await api.patch(`/hms/encounters/${id}/finalize`, {});
      toast.success('Encounter Finalized successfully!');
      
      // Prompt for bill generation
      const generateBill = confirm('Encounter finalized. Generate OPD Bill now?');
      if (generateBill) {
        navigate(`/billing/opd/${id}`);
      } else {
        navigate('/hms/dashboard');
      }
    } catch (err) { toast.error('Failed to finalize encounter'); }
  };

  if (loading) return <><Navbar /><div className="page-wrapper" style={{textAlign:'center',padding:60}}><div className="spinner" /></div></>;
  if (!encounter) return <><Navbar /><div className="page-wrapper"><h2>Encounter not found</h2></div></>;

  return (
    <>
    <Navbar />
    <div style={{ display: 'flex', height: 'calc(100vh - 61px)' }}>
      {/* LEFT PANEL: Patient Context */}
      <div style={{ width: '28%', background: 'var(--surface-2)', borderRight: '1px solid var(--border)', padding: 20, overflowY: 'auto' }}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: 10 }}>{patient?.name}</h2>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 20 }}>
          <p><strong>UHID:</strong> {patient?.uhid}</p>
          <p><strong>Age/Sex:</strong> {patient?.age} / {patient?.gender}</p>
          <p><strong>Blood:</strong> <span className="badge badge-red">{patient?.blood_group || 'Unknown'}</span></p>
        </div>

        {vitals ? (
          <div className="card-section">
            <div className="card-section-title">Today's Vitals</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: '0.85rem' }}>
              <div><strong>BP:</strong> {vitals.bp_systolic}/{vitals.bp_diastolic}</div>
              <div><strong>Pulse:</strong> {vitals.pulse} bpm</div>
              <div><strong>Temp:</strong> {vitals.temperature}°F</div>
              <div><strong>SpO2:</strong> {vitals.spo2}%</div>
              <div><strong>Weight:</strong> {vitals.weight} kg</div>
              <div><strong>BMI:</strong> {vitals.bmi}</div>
            </div>
            {vitals.alerts && JSON.parse(vitals.alerts).map((alert, i) => (
              <div key={i} className="alert alert-error" style={{ marginTop: 10, padding: 6, fontSize: '0.75rem' }}>
                ⚠️ {alert}
              </div>
            ))}
          </div>
        ) : (
          <div className="alert alert-error">No vitals recorded today.</div>
        )}
      </div>

      {/* RIGHT PANEL: Docs */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>
        
        {/* Tabs */}
        <div style={{ display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {['history', 'examination', 'diagnosis', 'prescription', 'investigations'].map(tab => (
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

              <label className="form-label" style={{ marginTop: 15 }}>HOPI</label>
              <textarea name="hopi" className="form-textarea" value={formData.hopi} onChange={handleInputChange} style={{ minHeight: 120 }} />

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 15 }}>
                <div className="form-group"><label className="form-label">Past Medical History</label><textarea name="past_medical_history" className="form-textarea" value={formData.past_medical_history} onChange={handleInputChange} /></div>
                <div className="form-group"><label className="form-label">Past Surgical History</label><textarea name="surgical_history" className="form-textarea" value={formData.surgical_history} onChange={handleInputChange} /></div>
              </div>
            </div>
          )}

          {activeTab === 'examination' && (
            <div className="card fade-up">
              <div className="form-group">
                <label className="form-label">General Examination</label>
                <textarea name="general_examination" className="form-textarea" value={formData.general_examination} onChange={handleInputChange} />
              </div>
              <div className="form-grid-2" style={{ marginTop: 20 }}>
                <div className="form-group"><label className="form-label">CVS</label><textarea name="cvs_findings" className="form-textarea" value={formData.cvs_findings} onChange={handleInputChange} /></div>
                <div className="form-group"><label className="form-label">Respiratory</label><textarea name="rs_findings" className="form-textarea" value={formData.rs_findings} onChange={handleInputChange} /></div>
                <div className="form-group"><label className="form-label">Abdomen</label><textarea name="abdomen_findings" className="form-textarea" value={formData.abdomen_findings} onChange={handleInputChange} /></div>
                <div className="form-group"><label className="form-label">CNS</label><textarea name="cns_findings" className="form-textarea" value={formData.cns_findings} onChange={handleInputChange} /></div>
              </div>
            </div>
          )}

          {activeTab === 'diagnosis' && (
            <div className="card fade-up">
              <label className="form-label">Search ICD-10</label>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
                <label className="form-label">Search Medicine</label>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-sm btn-outline" onClick={savePrescription}>Save Draft</button>
                  <button className="btn btn-sm btn-blue" onClick={() => window.open(`/prescription/${id}/print`, '_blank')}>🖨️ Preview Rx</button>
                </div>
              </div>
              
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

          {activeTab === 'investigations' && (
            <div className="card fade-up">
              <h3 style={{ marginBottom: 15 }}>Order Lab Tests</h3>
              <form onSubmit={addLabOrder} className="form-group" style={{ flexDirection: 'row', gap: 10 }}>
                <select className="form-select" value={labCategory} onChange={e => setLabCategory(e.target.value)} style={{ width: 150 }}>
                  <option>Haematology</option>
                  <option>Bio-Chemistry</option>
                  <option>Serology</option>
                  <option>Urine / Others</option>
                </select>
                <input type="text" className="form-input" placeholder="Test name (e.g. CBC)" value={newLabTest} onChange={e => setNewLabTest(e.target.value)} />
                <button type="submit" className="btn btn-primary">Add Test</button>
              </form>

              <div style={{ marginTop: 20 }}>
                {labOrders.length > 0 && (
                  <table className="test-table">
                    <thead><tr><th>Test Category</th><th>Test Name</th></tr></thead>
                    <tbody>
                      {labOrders.map((lo, i) => (
                        <tr key={i}><td>{lo.category || lo.test_category}</td><td>{lo.name || lo.item_name}</td></tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {labOrders.length > 0 && (
                  <button className="btn btn-blue" style={{ marginTop: 15 }} onClick={submitLabOrder}>Submit Orders to Lab</button>
                )}
              </div>
            </div>
          )}

        </div>

        {/* BOTTOM Sticky Bar */}
        <div style={{ padding: '16px 24px', background: 'var(--surface-2)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Status: <strong>{encounter.status}</strong> 
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-outline" onClick={() => saveEncounter(true)}>Save Draft</button>
            <button className="btn btn-primary" onClick={finalizeEncounter}>✔ Finalize Encounter</button>
          </div>
        </div>

      </div>
    </div>
    </>
  );
}
