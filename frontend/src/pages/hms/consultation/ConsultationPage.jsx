import MedicationAllergyPanel from './MedicationAllergyPanel';
import MedicationOrderPanel from './MedicationOrderPanel';
import { useState, useEffect, useRef } from 'react';
import CodedLabOrderPanel from './CodedLabOrderPanel';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { CircleCheck, FileWarning, HeartPulse, Lock, Plus, Printer, Save, Send, TriangleAlert, UserRound, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { useAuth } from '../../../context/AuthContext';

const TABS = [
  ['history', 'History'],
  ['examination', 'Examination'],
  ['diagnosis', 'Diagnosis'],
  ['prescription', 'Prescription'],
  ['investigations', 'Investigations'],
];
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
  const [prescriptionItems, setPrescriptionItems] = useState([]); // Historical, read-only.
  const [hasPendingMedication, setHasPendingMedication] = useState(true);
  const [hasPendingLabs, setHasPendingLabs] = useState(false);
  const labPanel = useRef(null);

  // Finalize dialogs
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [billPrompt, setBillPrompt] = useState(false);

  // Patient safety: the allergy record, and a confirmation before prescribing against it.
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
        setPrescriptionItems(encPrescriptions[0].items || []);
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

  const saveDraft = async () => {
    try {
      await persistNotes();
      toast.success('Consultation notes saved. Medication orders have their own save and sign actions.');
      if (hasPendingLabs) toast('Selected laboratory tests have not been confirmed yet.');
    } catch (err) { toast.error(err.response?.data?.message || err.response?.data?.error || 'Notes could not be saved. Your draft is preserved.'); }
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

  // ─── Finalize ───
  // Confirmation happens in a dialog (confirmFinalize) before this runs. Notes, medicines and any
  // tests still waiting to be sent are saved first; if any of that fails, nothing is finalized
  // (it used to finalize anyway, without the prescription).
  const canBill = ['super_admin', 'admin', 'receptionist'].includes(user?.role);
  const finalizeEncounter = async () => {
    if (hasPendingMedication) return toast.error('Save, assess and sign medication orders, or reconcile any uncertain save, before finalizing.');
    setFinalizing(true);
    try {
      await persistNotes();
      if (hasPendingLabs && !(await labPanel.current?.submitPending())) throw new Error('Confirm the coded laboratory order before finalizing.');

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
      toast.error(err.response?.data?.message || err.response?.data?.error || err.message || 'Failed to finalize encounter');
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
        <MedicationAllergyPanel key={`${patient?.id}:${id}`} patientId={patient?.id} />
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

            <div hidden={activeTab !== 'prescription'} className="stack" style={{ display: activeTab === 'prescription' ? undefined : 'none' }}>
              <MedicationOrderPanel key={`${patient?.id}:${id}`} patientId={patient?.id} encounterId={id} onPendingChange={setHasPendingMedication} />
              {prescriptionItems.length > 0 && <section aria-label="Historical prescription documentation">
                <h3>Historical prescription documentation</h3>
                <p>These retained entries are historical documentation. They do not authorize dispensing or administration.</p>
                <table className="mini-table"><thead><tr><th>Medicine</th><th>Recorded dose</th><th>Recorded instructions</th></tr></thead><tbody>
                  {prescriptionItems.map((item, index) => <tr key={item.id ?? index}><td>{item.medicine_name}</td><td>{item.dose} {item.dose_unit}</td><td>{item.instructions || '—'}</td></tr>)}
                </tbody></table>
              </section>}
            </div>
            <div hidden={activeTab !== 'investigations'} style={{ display: activeTab === 'investigations' ? undefined : 'none' }}>
              <CodedLabOrderPanel ref={labPanel} key={`${patient?.id}:${id}`} patientId={patient?.id} encounterId={id} onPendingChange={setHasPendingLabs} />
            </div>
          </fieldset>

          <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <span className="muted">Status: <strong>{encounter.status}</strong></span>
            <span className="inline-actions">
              <button type="button" className="btn btn-secondary btn-md" onClick={() => navigate(`/medication/orders?encounter_id=${encodeURIComponent(id)}`)}>
                <Printer size={16} aria-hidden="true" /> Review coded orders
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
      description="Notes and selected coded investigations are saved first. Medication orders must already be signed. Signed records are corrected through amendments."
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
        {hasPendingMedication && <p role="alert">Some medication orders are unconfirmed, unsigned or unavailable. Resolve them before finalization.</p>}
        {hasPendingLabs && <p role="status">Selected coded investigations will be submitted before finalization.</p>}
      </div>
    </Modal>

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
