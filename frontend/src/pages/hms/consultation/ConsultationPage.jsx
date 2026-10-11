import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { CircleCheck, FileWarning, HeartPulse, Lock, Plus, Printer, Save, Send, TriangleAlert, UserRound, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { useAuth } from '../../../context/AuthContext';
import { AllergyStatusPanel, findAllergyMatches, medicineNames, useAllergyGate, usePatientAllergies } from './allergySafety';

const TABS = [
  ['history', 'History'],
  ['examination', 'Examination'],
  ['diagnosis', 'Diagnosis'],
  ['prescription', 'Prescription'],
  ['investigations', 'Investigations'],
];
const rxInputStyle = { height: 32, padding: '4px 8px', minWidth: 64 };
// /hms/medicines/search returns camelCase fields (genericName, brandNames[]); older rows used snake case.
const medGeneric = (m) => m.genericName || m.generic_name || '';
const medBrands = (m) => {
  const raw = m.brandNames ?? m.brand_names;
  if (Array.isArray(raw)) return raw;
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : [String(parsed)]; } catch { return String(raw).split(',').map((b) => b.trim()).filter(Boolean); }
};
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '');
const isToday = (v) => v && new Date(v).toDateString() === new Date().toDateString();
// NUMERIC columns arrive as strings ("38.20"); show them as numbers (38.2).
const shown = (v, unit = '') => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${Number.isFinite(n) ? n : v}${unit}`;
};
const parseAlerts = (raw) => {
  if (!raw) return [];
  try { const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

const dropdownStyle = {
  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 10, padding: 6,
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-md)',
  maxHeight: 300, overflowY: 'auto',
};

export default function ConsultationPage() {
  const { id } = useParams(); // Encounter ID
  const navigate = useNavigate();
  const { user } = useAuth();
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
  const [prescriptionId, setPrescriptionId] = useState(null);
  const [prescriptionItems, setPrescriptionItems] = useState([]);
  const [medSearch, setMedSearch] = useState('');
  const [medResults, setMedResults] = useState([]);

  // Lab Orders State
  const [labOrders, setLabOrders] = useState([]); // new tests, not yet sent
  const [sentLabOrders, setSentLabOrders] = useState([]); // tests already ordered for this encounter
  const [submittingLab, setSubmittingLab] = useState(false);
  const [newLabTest, setNewLabTest] = useState('');
  const [labCategory, setLabCategory] = useState('Haematology');
  const [labPriority, setLabPriority] = useState('Routine');

  // Finalize dialogs
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [billPrompt, setBillPrompt] = useState(false);

  // Patient safety: the allergy record, and a confirmation before prescribing against it.
  const allergyState = usePatientAllergies(patient?.id);
  const allergyGate = useAllergyGate(allergyState);
  const readOnly = encounter?.status === 'Finalized';

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
      
      // The API returns the association as `prescriptions`; `Prescriptions` kept as a fallback.
      const encPrescriptions = enc.prescriptions || enc.Prescriptions;
      if (encPrescriptions && encPrescriptions.length > 0) {
        setPrescriptionId(encPrescriptions[0].id);
        setPrescriptionItems(encPrescriptions[0].items || []);
      }
      // Orders already placed are shown read-only so they are never re-sent.
      const encOrders = enc.investigationOrders || enc.InvestigationOrders || [];
      setSentLabOrders(encOrders.flatMap((o) => (o.items || []).map((it) => ({
        id: it.id, name: it.test_name, category: it.department, status: it.status || o.status, priority: o.priority || 'Routine',
      }))));

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

      // Latest vitals (the API answers { success, data })
      if (enc.patient_id) {
        try {
          const vitRes = await api.get(`/hms/vitals/latest/${enc.patient_id}`);
          if (vitRes.data.success) setVitals(vitRes.data.data || null);
        } catch { setVitals(null); }
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
    if (!encounter || encounter.status === 'Finalized') return undefined;
    const timeout = setTimeout(() => {
      api.put(`/hms/encounters/${id}`, formData).catch((err) => console.error(err));
    }, 60000); // 60s
    return () => clearTimeout(timeout);
  }, [formData]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  // Notes and prescription are saved together; errors propagate so callers can stop.
  const persistNotes = () => api.put(`/hms/encounters/${id}`, formData);

  const persistPrescription = async () => {
    if (prescriptionItems.length === 0 && !prescriptionId) return; // nothing prescribed yet
    const pRes = await api.post('/hms/prescriptions', { encounter_id: id, patient_id: patient.id });
    setPrescriptionId(pRes.data.id);
    await api.put(`/hms/prescriptions/${pRes.data.id}/items`, { items: prescriptionItems });
  };

  // "Save draft" keeps everything entered so far, medicines included (it used to save only the
  // notes, so medicines added without "Save prescription" were lost on reload).
  const saveDraft = async () => {
    try {
      await persistNotes();
      await persistPrescription();
      toast.success('Consultation draft saved');
      if (labOrders.length > 0) {
        toast(`${labOrders.length} ${labOrders.length === 1 ? 'lab test is' : 'lab tests are'} not sent to the lab yet`, { id: 'unsent-labs' });
      }
    } catch (err) {
      console.error(err);
      toast.error(err.response?.data?.error || 'Failed to save consultation');
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

  // Every medicine goes through the allergy check; a match needs "Prescribe anyway".
  const addPrescriptionItem = (med) => {
    const generic = medGeneric(med);
    setMedSearch('');
    setMedResults([]);
    if (!generic) return;
    allergyGate.check([generic, ...medBrands(med)], generic, () => {
      setPrescriptionItems((items) => [...items, {
        medicine_name: generic, generic_name: generic,
        dose: '1', dose_unit: 'Tablet', route: 'Oral', frequency: 'BD', duration_days: 5, instructions: 'After meal'
      }]);
    });
  };

  const allergyMatchesFor = (item) => (allergyState.status === 'ok' ? findAllergyMatches(allergyState.allergies, medicineNames(item)) : []);

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
      await persistPrescription();
      toast.success('Prescription saved');
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save prescription'); }
  };

  // ─── Investigations Handlers ───
  const addLabOrder = (e) => {
    e.preventDefault();
    if (!newLabTest) return;
    setLabOrders([...labOrders, { id: Date.now(), name: newLabTest, category: labCategory }]);
    setNewLabTest('');
  };

  const sendLabOrders = async () => {
    const payload = {
      encounter_id: id,
      patient_id: patient.id,
      order_type: 'Lab',
      priority: labPriority,
      items: labOrders.map(lo => ({ name: lo.name, category: lo.category }))
    };
    await api.post('/hms/investigation-orders', payload);
    setSentLabOrders((prev) => [...prev, ...labOrders.map((lo) => ({ ...lo, status: 'Pending', priority: labPriority }))]);
    setLabOrders([]);
    setLabPriority('Routine');
  };

  const submitLabOrder = async () => {
    if (submittingLab) return;
    try {
      if (labOrders.length === 0) return toast.error('Add tests to submit');
      setSubmittingLab(true);
      await sendLabOrders();
      toast.success('Lab order sent to the lab queue');
    } catch (err) {
      toast.error('Failed to submit lab order');
    } finally {
      setSubmittingLab(false);
    }
  };

  // ─── Finalize ───
  // Confirmation happens in a dialog (confirmFinalize) before this runs. Notes, medicines and any
  // tests still waiting to be sent are saved first; if any of that fails, nothing is finalized
  // (it used to finalize anyway, without the prescription).
  const canBill = ['super_admin', 'admin', 'receptionist'].includes(user?.role);
  const finalizeEncounter = async () => {
    setFinalizing(true);
    try {
      await persistNotes();
      await persistPrescription();
      if (labOrders.length > 0) await sendLabOrders();

      await api.patch(`/hms/encounters/${id}/finalize`, {});
      setConfirmFinalize(false);
      setEncounter((enc) => ({ ...enc, status: 'Finalized' }));

      if (canBill) {
        toast.success('Encounter finalized');
        setBillPrompt(true);
      } else {
        // Doctors cannot raise bills; the visit now waits in the front desk's billing list.
        toast.success('Encounter finalized. The front desk can now raise the OPD bill.');
        navigate('/dashboard');
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to finalize encounter');
    } finally { setFinalizing(false); }
  };

  const closeBillPrompt = (generateBill) => {
    setBillPrompt(false);
    if (generateBill) {
      navigate(`/billing/opd/${id}`);
    } else {
      navigate('/dashboard');
    }
  };

  const flaggedItems = useMemo(
    () => (allergyState.status === 'ok'
      ? prescriptionItems
        .map((item) => ({ item, matches: findAllergyMatches(allergyState.allergies, medicineNames(item)) }))
        .filter((x) => x.matches.length > 0)
      : []),
    [prescriptionItems, allergyState.status, allergyState.allergies],
  );

  if (loading) return <><Navbar /><main className="app-page"><p className="muted">Loading…</p></main></>;
  if (!encounter) return (
    <>
      <Navbar />
      <main className="app-page">
        <section className="panel">
          <EmptyState icon={FileWarning} title="Encounter not found" description="It may have been removed, or the link is incorrect." />
        </section>
      </main>
    </>
  );

  const vitalAlerts = parseAlerts(vitals?.alerts);
  const vitalsAt = vitals?.recorded_at || vitals?.RECORDED_AT;
  const tempUnit = vitals?.temp_unit || vitals?.TEMP_UNIT || 'F';

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title="Consultation"
        description="Record history, examination, diagnoses, prescription and investigations for this encounter."
        meta={(
          <span className="chip-row" style={{ alignItems: 'center' }}>
            <span className="mono muted">Encounter {id}</span>
            <span className={`status ${encounter.status === 'Finalized' || encounter.status === 'Completed' ? 'status-success' : 'status-info'}`}>{encounter.status}</span>
          </span>
        )}
      />

      <div className="panel panel-pad" style={{ marginBottom: 16 }}>
        <AllergyStatusPanel status={allergyState.status} allergies={allergyState.allergies} onRetry={allergyState.retry} />
      </div>

      {readOnly && (
        <div className="alert-strip alert-info" role="status">
          <Lock size={16} aria-hidden="true" /> This encounter is finalized. The notes, diagnoses and prescription can no longer be changed.
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        {/* Patient context */}
        <aside className="stack" style={{ flex: '1 1 280px', maxWidth: 400, minWidth: 0 }}>
          <section className="panel panel-pad">
            <h2 className="panel-title"><UserRound size={16} aria-hidden="true" /> {patient?.name}</h2>
            <div className="facts">
              <div><div className="fact-label">UHID</div><div className="fact-value mono">{patient?.uhid}</div></div>
              <div><div className="fact-label">Age / sex</div><div className="fact-value">{patient?.age} / {patient?.gender}</div></div>
              <div><div className="fact-label">Blood group</div><div className="fact-value">{patient?.blood_group || 'Unknown'}</div></div>
            </div>
          </section>

          <section className="panel panel-pad" aria-labelledby="cn-vitals-title">
            <h2 className="panel-title" id="cn-vitals-title"><HeartPulse size={16} aria-hidden="true" /> Latest vitals</h2>
            {vitals ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {isToday(vitalsAt) ? 'Recorded today' : 'Recorded'} {fmtDateTime(vitalsAt)}
                  {vitals.recorded_by_name || vitals.RECORDED_BY_NAME ? ` by ${vitals.recorded_by_name || vitals.RECORDED_BY_NAME}` : ''}
                </p>
                <div className="facts">
                  <div><div className="fact-label">BP</div><div className="fact-value tabular">{vitals.bp_systolic ? `${vitals.bp_systolic}/${shown(vitals.bp_diastolic)}` : '—'}</div></div>
                  <div><div className="fact-label">Pulse</div><div className="fact-value tabular">{shown(vitals.pulse, ' bpm')}</div></div>
                  <div><div className="fact-label">Temperature</div><div className="fact-value tabular">{shown(vitals.temperature, ` °${tempUnit}`)}</div></div>
                  <div><div className="fact-label">SpO2</div><div className="fact-value tabular">{shown(vitals.spo2, '%')}</div></div>
                  <div><div className="fact-label">Weight</div><div className="fact-value tabular">{shown(vitals.weight_kg ?? vitals.weight, ' kg')}</div></div>
                  <div><div className="fact-label">BMI</div><div className="fact-value tabular">{shown(vitals.bmi)}</div></div>
                </div>
                {vitalAlerts.map((alert, i) => (
                  <div key={i} className="alert-strip alert-danger" role="alert" style={{ marginTop: 10, marginBottom: 0 }}>
                    <TriangleAlert size={16} aria-hidden="true" /> {alert}
                  </div>
                ))}
              </>
            ) : (
              <div className="alert-strip alert-warning" style={{ marginBottom: 0 }}>No vitals recorded for this patient.</div>
            )}
          </section>
        </aside>

        {/* Documentation */}
        <section className="panel" style={{ flex: '3 1 560px', minWidth: 0 }}>
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

          <fieldset className="panel-pad" disabled={readOnly} style={{ border: 0, margin: 0, minWidth: 0 }}>
            {activeTab === 'history' && (
              <div className="stack">
                <div className="form-group">
                  <label className="form-label" htmlFor="cn-chief-complaint">Chief complaint</label>
                  <textarea id="cn-chief-complaint" name="chief_complaint" className="form-textarea" value={formData.chief_complaint} onChange={handleInputChange} />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="cn-hopi">History of present illness (HOPI)</label>
                  <textarea id="cn-hopi" name="hopi" className="form-textarea" value={formData.hopi} onChange={handleInputChange} style={{ minHeight: 120 }} />
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-pmh">Past medical history</label>
                    <textarea id="cn-pmh" name="past_medical_history" className="form-textarea" value={formData.past_medical_history} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-psh">Past surgical history</label>
                    <textarea id="cn-psh" name="surgical_history" className="form-textarea" value={formData.surgical_history} onChange={handleInputChange} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'examination' && (
              <div className="stack">
                <div className="form-group">
                  <label className="form-label" htmlFor="cn-general-exam">General examination</label>
                  <textarea id="cn-general-exam" name="general_examination" className="form-textarea" value={formData.general_examination} onChange={handleInputChange} />
                </div>
                <div className="form-row-2">
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-cvs">CVS</label>
                    <textarea id="cn-cvs" name="cvs_findings" className="form-textarea" value={formData.cvs_findings} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-rs">Respiratory</label>
                    <textarea id="cn-rs" name="rs_findings" className="form-textarea" value={formData.rs_findings} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-abdomen">Abdomen</label>
                    <textarea id="cn-abdomen" name="abdomen_findings" className="form-textarea" value={formData.abdomen_findings} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="cn-cns">CNS</label>
                    <textarea id="cn-cns" name="cns_findings" className="form-textarea" value={formData.cns_findings} onChange={handleInputChange} />
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'diagnosis' && (
              <div className="stack">
                <div className="form-group">
                  <label className="form-label" htmlFor="cn-icd-search">Search ICD-10</label>
                  <div style={{ position: 'relative' }}>
                    <input id="cn-icd-search" type="text" className="form-input" value={icdSearch} onChange={(e) => searchIcd(e.target.value)} placeholder="Type a condition or ICD code" autoComplete="off" />
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <label className="form-label" htmlFor="cn-med-search">Search medicine</label>
                    <span className="inline-actions">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={savePrescription}>
                        <Save size={14} aria-hidden="true" /> Save prescription
                      </button>
                    </span>
                  </div>
                  <div style={{ position: 'relative' }}>
                    <input id="cn-med-search" type="text" className="form-input" value={medSearch} onChange={(e) => searchMed(e.target.value)} placeholder="Type a generic or brand name" autoComplete="off" />
                    {medResults.length > 0 && (
                      <ul className="list-rows" style={dropdownStyle}>
                        {medResults.map(m => (
                          <li key={m.id}>
                            <button type="button" className="list-row" onClick={() => addPrescriptionItem(m)}>
                              <span className="cell-stack">
                                <span className="cell-primary">{medGeneric(m)}{medBrands(m).length ? ` (${medBrands(m).join(', ')})` : ''}</span>
                                <span className="cell-secondary">{[m.formulation, m.strength, m.strengthUnit || m.strength_unit].filter(Boolean).join(' ')}</span>
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
                      {prescriptionItems.map((item, idx) => {
                        const matches = allergyMatchesFor(item);
                        return (
                        <tr key={idx}>
                          <td>
                            <span className="cell-stack">
                              <span className="cell-primary">{item.medicine_name}</span>
                              {matches.length > 0 && (
                                <span className="status status-danger" style={{ alignSelf: 'flex-start' }}>
                                  <TriangleAlert size={12} aria-hidden="true" /> Allergy: {matches.map((a) => a.allergen).join(', ')}
                                </span>
                              )}
                            </span>
                          </td>
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
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'investigations' && (
              <div className="stack">
                <h3 className="panel-subtitle" style={{ marginTop: 0 }}>Order lab tests</h3>
                <form onSubmit={addLabOrder} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div className="form-group" style={{ width: 180 }}>
                    <label className="form-label" htmlFor="cn-lab-category">Category</label>
                    <select id="cn-lab-category" className="form-select" value={labCategory} onChange={e => setLabCategory(e.target.value)}>
                      <option>Haematology</option>
                      <option>Bio-Chemistry</option>
                      <option>Serology</option>
                      <option>Urine / Others</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ flex: '1 1 220px' }}>
                    <label className="form-label" htmlFor="cn-lab-test">Test name</label>
                    <input id="cn-lab-test" type="text" className="form-input" placeholder="e.g. CBC" value={newLabTest} onChange={e => setNewLabTest(e.target.value)} />
                  </div>
                  <button type="submit" className="btn btn-secondary btn-md"><Plus size={16} aria-hidden="true" /> Add test</button>
                </form>

                {sentLabOrders.length > 0 && (
                  <>
                    <h3 className="panel-subtitle" style={{ margin: 0 }}>Already ordered</h3>
                    <table className="mini-table">
                      <thead><tr><th>Category</th><th>Test name</th><th>Priority</th><th>Status</th></tr></thead>
                      <tbody>
                        {sentLabOrders.map((lo, i) => (
                          <tr key={lo.id || i}>
                            <td>{lo.category || '—'}</td>
                            <td>{lo.name}</td>
                            <td><span className={`status status-${lo.priority && lo.priority !== 'Routine' ? 'danger' : 'neutral'}`}>{lo.priority || 'Routine'}</span></td>
                            <td><span className={`status status-${lo.status === 'Completed' ? 'success' : lo.status === 'Cancelled' ? 'neutral' : 'warning'}`}>{lo.status || 'Pending'}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}

                {labOrders.length > 0 && (
                  <>
                    <h3 className="panel-subtitle" style={{ margin: 0 }}>New tests, not yet sent</h3>
                    <table className="mini-table">
                      <thead><tr><th>Category</th><th>Test name</th><th><span className="sr-only">Remove</span></th></tr></thead>
                      <tbody>
                        {labOrders.map((lo, i) => (
                          <tr key={lo.id || i}>
                            <td>{lo.category}</td>
                            <td>{lo.name}</td>
                            <td className="text-right">
                              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLabOrders(labOrders.filter((x) => x !== lo))} aria-label={`Remove ${lo.name}`}>Remove</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                      <div className="form-group" style={{ width: 160, marginBottom: 0 }}>
                        <label className="form-label" htmlFor="cn-lab-priority">Priority</label>
                        <select id="cn-lab-priority" className="form-select" value={labPriority} onChange={(e) => setLabPriority(e.target.value)}>
                          <option value="Routine">Routine</option>
                          <option value="Urgent">Urgent</option>
                          <option value="STAT">STAT</option>
                        </select>
                      </div>
                      <button type="button" className="btn btn-primary btn-md" onClick={submitLabOrder} disabled={submittingLab}>
                        <Send size={16} aria-hidden="true" /> {submittingLab ? 'Sending…' : `Send ${labOrders.length} ${labOrders.length === 1 ? 'test' : 'tests'} to lab`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
          </fieldset>

          <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">Status: <strong>{encounter.status}</strong></span>
            <span className="inline-actions">
              <button type="button" className="btn btn-secondary btn-md" onClick={() => window.open(`/prescription/${id}/print`, '_blank')}>
                <Printer size={16} aria-hidden="true" /> Preview Rx
              </button>
              {!readOnly && (
                <>
                  <button type="button" className="btn btn-ghost btn-md" onClick={saveDraft}>
                    <Save size={16} aria-hidden="true" /> Save draft
                  </button>
                  <button type="button" className="btn btn-primary btn-md" onClick={() => setConfirmFinalize(true)}>
                    <CircleCheck size={16} aria-hidden="true" /> Finalize encounter
                  </button>
                </>
              )}
            </span>
          </div>
        </section>
      </div>
    </main>

    <Modal
      open={confirmFinalize}
      onOpenChange={(open) => { if (!finalizing) setConfirmFinalize(open); }}
      title="Finalize this encounter?"
      description="The consultation notes and prescription are saved first. No changes can be made after finalization."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setConfirmFinalize(false)} disabled={finalizing}>Cancel</button>
          <button type="button" className="btn btn-primary btn-md" onClick={finalizeEncounter} disabled={finalizing}>
            {finalizing ? 'Finalizing…' : 'Finalize encounter'}
          </button>
        </>
      )}
    >
      <div className="stack-sm">
        <p className="muted" style={{ margin: 0 }}>Patient: {patient?.name} ({patient?.uhid})</p>
        {flaggedItems.length > 0 && (
          <div className="alert-strip alert-danger" style={{ marginBottom: 0 }}>
            <TriangleAlert size={16} aria-hidden="true" />
            <span>
              Prescribed despite a recorded allergy: {flaggedItems.map(({ item, matches }) => `${item.medicine_name} (allergy: ${matches.map((a) => a.allergen).join(', ')})`).join('; ')}
            </span>
          </div>
        )}
        {allergyState.status !== 'ok' && prescriptionItems.length > 0 && (
          <div className="alert-strip alert-warning" style={{ marginBottom: 0 }}>
            <TriangleAlert size={16} aria-hidden="true" /> Allergies were not checked for this patient.
          </div>
        )}
        {labOrders.length > 0 && (
          <div className="alert-strip alert-info" style={{ marginBottom: 0 }}>
            <Send size={16} aria-hidden="true" /> Also sent to the lab ({labPriority}): {labOrders.map((lo) => lo.name).join(', ')}
          </div>
        )}
      </div>
    </Modal>
    {allergyGate.modal}

    <Modal
      open={billPrompt}
      onOpenChange={(open) => { if (!open) closeBillPrompt(false); }}
      title="Generate the OPD bill now?"
      description="The encounter is finalized. You can bill now or return to the dashboard."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => closeBillPrompt(false)}>Not now</button>
          <button type="button" className="btn btn-primary btn-md" onClick={() => closeBillPrompt(true)}>Generate OPD bill</button>
        </>
      )}
    >
      <p className="muted">Not now takes you back to the dashboard.</p>
    </Modal>
    </>
  );
}
