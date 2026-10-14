import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CalendarPlus, Download, FileText, HeartPulse, Plus, Receipt, Route, Ticket, TriangleAlert, UserRound } from 'lucide-react';
import api from '../../../api/axios';
import { openAuthenticatedBlob } from '../../../utils/authenticatedDownload';
import { useAuth } from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PatientBanner from '../../../components/patient/PatientBanner';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import PatientIdentityPanel, { ConfirmIdentityBanner, MergedRecordBanner } from './PatientIdentityPanel';
import PatientDocumentsPanel from './PatientDocumentsPanel';

const PATIENT_TYPE_LABEL = { corporate_employee: 'Corporate employee', other: 'General' };
const TABS = [
  ['overview', 'Overview'],
  ['identity', 'Identity and contacts'],
  ['visits', 'Visits'],
  ['documents', 'Documents'],
  ['prescriptions', 'Prescriptions'],
  ['billing', 'Billing'],
  ['clinical', 'Allergies and conditions'],
  ['vitals', 'Vitals'],
];
const VISIT_TONE = { Finalized: 'success', Final: 'success', Completed: 'success', Draft: 'info', Pending: 'warning' };
const BILL_TONE = { Paid: 'success', 'Partially Paid': 'warning', Pending: 'warning', Cancelled: 'neutral' };
const SEVERITIES = ['Mild', 'Moderate', 'Severe'];
const BILLING_ROLES = ['super_admin', 'admin', 'receptionist'];
const PRESCRIBER_ROLES = ['super_admin', 'doctor'];

const fmtDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pick = (row, ...keys) => { for (const k of keys) { if (row?.[k] !== undefined && row?.[k] !== null) return row[k]; } return undefined; };
const parseAlerts = (raw) => {
  if (!raw) return [];
  try { const p = typeof raw === 'string' ? JSON.parse(raw) : raw; return Array.isArray(p) ? p : []; } catch { return []; }
};

const EMPTY_ALLERGY = { allergen: '', reaction: '', severity: '' };
const EMPTY_CONDITION = { condition_name: '', since_when: '', notes: '' };

export default function PatientProfilePage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [patient, setPatient] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(true);

  // Tab data ('loading' | 'ok' | 'error' per tab)
  const [tabStatus, setTabStatus] = useState({});
  const [visits, setVisits] = useState([]);
  const [allergies, setAllergies] = useState([]);
  const [conditions, setConditions] = useState([]);
  const [bills, setBills] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [ipdVitals, setIpdVitals] = useState([]);

  // Add allergy / condition dialogs
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [allergyForm, setAllergyForm] = useState(EMPTY_ALLERGY);
  const [conditionOpen, setConditionOpen] = useState(false);
  const [conditionForm, setConditionForm] = useState(EMPTY_CONDITION);
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get(`/patients/hms/${id}`);
      setPatient(res.data.data);
      setAllergies(res.data.data.allergies || []);
      setConditions(res.data.data.chronic_conditions || []);
    } catch (err) {
      console.error(err);
      if (!silent) setPatient(null);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const loadTab = async (tab) => {
    const loaders = {
      visits: async () => setVisits((await api.get(`/patients/hms/${id}/visits`)).data.data || []),
      documents: async () => {}, // PatientDocumentsPanel loads and refreshes its own list.
      billing: async () => setBills((await api.get(`/billing/patient/${id}`)).data.data || []),
      prescriptions: async () => {
        const res = await api.get(`/hms/prescriptions/patient/${id}`);
        setPrescriptions(Array.isArray(res.data) ? res.data : res.data?.data || []);
      },
      vitals: async () => {
        const [opd, ipd] = await Promise.allSettled([
          api.get(`/hms/vitals/history/${id}`),
          api.get(`/ipd/vitals/patient/${id}`),
        ]);
        if (opd.status !== 'fulfilled') throw opd.reason;
        setVitals(opd.value.data.data || []);
        setIpdVitals(ipd.status === 'fulfilled' ? ipd.value.data.data || [] : []);
      },
    };
    if (!loaders[tab]) return;
    setTabStatus((s) => ({ ...s, [tab]: 'loading' }));
    try {
      await loaders[tab]();
      setTabStatus((s) => ({ ...s, [tab]: 'ok' }));
    } catch (err) {
      console.error(err);
      setTabStatus((s) => ({ ...s, [tab]: 'error' }));
    }
  };

  const openTab = (tab) => {
    setActiveTab(tab);
    loadTab(tab);
  };

  const saveAllergy = async (e) => {
    e.preventDefault();
    if (!allergyForm.allergen.trim()) { toast.error('Enter the allergen'); return; }
    setSaving(true);
    try {
      await api.post(`/patients/hms/${id}/allergies`, {
        allergen: allergyForm.allergen.trim(),
        reaction: allergyForm.reaction.trim() || null,
        severity: allergyForm.severity || null,
      });
      toast.success('Allergy recorded');
      setAllergyOpen(false);
      setAllergyForm(EMPTY_ALLERGY);
      await fetchProfile(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record the allergy');
    } finally {
      setSaving(false);
    }
  };

  const saveCondition = async (e) => {
    e.preventDefault();
    if (!conditionForm.condition_name.trim()) { toast.error('Enter the condition'); return; }
    setSaving(true);
    try {
      await api.post(`/patients/hms/${id}/chronic-conditions`, {
        condition_name: conditionForm.condition_name.trim(),
        since_when: conditionForm.since_when.trim() || null,
        notes: conditionForm.notes.trim() || null,
      });
      toast.success('Condition recorded');
      setConditionOpen(false);
      setConditionForm(EMPTY_CONDITION);
      await fetchProfile(true);
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not record the condition');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <><Navbar /><main className="app-page"><p className="muted">Loading patient…</p></main></>;
  if (!patient) {
    return (
      <>
        <Navbar />
        <main className="app-page">
          <h1 className="sr-only">Patient profile</h1>
          <section className="panel"><EmptyState icon={UserRound} title="Patient not found" description="The patient may have been removed, or the link is wrong." /></section>
        </main>
      </>
    );
  }

  const patientType = patient.patientType || patient.patient_type;
  const canBill = BILLING_ROLES.includes(user?.role);
  const canPrescribe = PRESCRIBER_ROLES.includes(user?.role);
  const status = tabStatus[activeTab];
  const tabNotice = status === 'loading'
    ? <p className="muted panel-pad">Loading…</p>
    : status === 'error'
      ? <div className="panel-pad"><div className="alert-strip alert-warning" role="status" style={{ marginBottom: 0 }}><TriangleAlert size={16} aria-hidden="true" /> This section could not be loaded, or your role cannot view it.</div></div>
      : null;

  return (
    <>
    <Navbar />
    <main>
    <PatientBanner
      patient={patient}
      allergies={allergies}
      conditions={conditions}
      actions={(
        <>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/hms/appointments/book', { state: { patient } })}>
            <CalendarPlus size={14} aria-hidden="true" /> Book appointment
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/hms/opd/token', { state: { patient } })}>
            <Ticket size={14} aria-hidden="true" /> Token
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/patient/${id}/journey`)}>
            <Route size={14} aria-hidden="true" /> Journey
          </button>
        </>
      )}
    />
    <div className="app-page">
      <MergedRecordBanner patient={patient} />
      <ConfirmIdentityBanner patient={patient} onConfirmed={() => fetchProfile(true)} />
      <section className="panel">
        <div className="tabs" role="tablist" aria-label="Patient record">
          {TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              className={`tab${activeTab === tab ? ' is-active' : ''}`}
              onClick={() => openTab(tab)}
            >
              {label}
            </button>
          ))}
        </div>

        {activeTab === 'identity' && <PatientIdentityPanel patientId={id} role={user?.role} />}

        {activeTab === 'overview' && (
          <div className="panel-pad split-2">
            <div>
              <h2 className="panel-subtitle" style={{ marginTop: 0 }}>Demographics</h2>
              <dl className="facts">
                <div><dt className="fact-label">Date of birth</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.dob || '—'}</dd></div>
                <div><dt className="fact-label">Patient type</dt><dd className="fact-value" style={{ margin: 0 }}>{PATIENT_TYPE_LABEL[patientType] || 'General'}</dd></div>
                {patientType === 'corporate_employee' && (
                  <>
                    <div><dt className="fact-label">Employee no.</dt><dd className="fact-value mono" style={{ margin: 0 }}>{patient.empNumber || '—'}</dd></div>
                    <div><dt className="fact-label">Relationship</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.relationship || 'Self'}</dd></div>
                  </>
                )}
                <div><dt className="fact-label">Aadhaar (masked)</dt><dd className="fact-value mono" style={{ margin: 0 }}>{patient.aadhaar_masked || '—'}</dd></div>
                <div><dt className="fact-label">Registered</dt><dd className="fact-value" style={{ margin: 0 }}>{fmtDate(patient.createdAt)}</dd></div>
              </dl>
            </div>
            <div>
              <h2 className="panel-subtitle" style={{ marginTop: 0 }}>Address and contact</h2>
              <dl className="facts">
                <div><dt className="fact-label">Email</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.email || '—'}</dd></div>
                <div><dt className="fact-label">Address</dt><dd className="fact-value" style={{ margin: 0 }}>{[patient.house_no, patient.street, patient.city].filter(Boolean).join(', ') || '—'}</dd></div>
                <div><dt className="fact-label">Emergency contact</dt><dd className="fact-value" style={{ margin: 0 }}>{patient.emergency_contact_name ? `${patient.emergency_contact_name}${patient.emergency_contact_relation ? ` (${patient.emergency_contact_relation})` : ''}` : '—'}</dd></div>
                <div><dt className="fact-label">Emergency phone</dt><dd className="fact-value tabular" style={{ margin: 0 }}>{patient.emergency_contact_phone || '—'}</dd></div>
              </dl>
            </div>
          </div>
        )}

        {activeTab === 'visits' && (tabNotice || (
          visits.length === 0 ? <EmptyState icon={HeartPulse} title="No visits yet" description="OPD consultations and lab reports appear here." /> : (
            <div className="panel-pad" style={{ overflowX: 'auto' }}>
              <table className="mini-table">
                <thead><tr><th>Date</th><th>Type</th><th>Department</th><th>Doctor</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {visits.map((v, i) => (
                    <tr key={`${v.type}-${v.reference_id || i}`}>
                      <td className="tabular">{fmtDate(v.date)}</td>
                      <td>{v.type}</td>
                      <td>{v.department || '—'}</td>
                      <td>{v.doctor || '—'}</td>
                      <td><span className={`status status-${VISIT_TONE[v.status] || 'neutral'}`}>{v.status || '—'}</span></td>
                      <td className="text-right">
                        {v.type === 'Lab Test' && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/report/${v.reference_id}`)}>View report</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ))}

        {activeTab === 'clinical' && (
          <div className="panel-pad split-2" style={{ alignItems: 'start' }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <h2 className="panel-subtitle" style={{ margin: 0 }}>Allergies</h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setAllergyForm(EMPTY_ALLERGY); setAllergyOpen(true); }}>
                  <Plus size={14} aria-hidden="true" /> Add allergy
                </button>
              </div>
              {allergies.length === 0 ? <p className="muted">No known allergies recorded.</p> : (
                <ul className="list-rows" style={{ marginTop: 10 }}>
                  {allergies.map((a) => (
                    <li key={a.id} className="list-row" style={{ cursor: 'default' }}>
                      <span className="cell-stack">
                        <span className="cell-primary">{a.allergen}</span>
                        <span className="cell-secondary">{a.reaction || 'Reaction not recorded'}{a.noted_at ? ` · noted ${fmtDate(a.noted_at)}` : ''}</span>
                      </span>
                      <span className={`status status-${a.severity === 'Severe' ? 'danger' : a.severity ? 'warning' : 'neutral'}`}>{a.severity || 'Severity not recorded'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <h2 className="panel-subtitle" style={{ margin: 0 }}>Chronic conditions</h2>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setConditionForm(EMPTY_CONDITION); setConditionOpen(true); }}>
                  <Plus size={14} aria-hidden="true" /> Add condition
                </button>
              </div>
              {conditions.length === 0 ? <p className="muted">No chronic conditions recorded.</p> : (
                <ul className="list-rows" style={{ marginTop: 10 }}>
                  {conditions.map((c) => (
                    <li key={c.id} className="list-row" style={{ cursor: 'default' }}>
                      <span className="cell-stack">
                        <span className="cell-primary">{c.condition_name}</span>
                        <span className="cell-secondary">{c.since_when ? `Since ${c.since_when}` : 'Onset not recorded'}{c.notes ? ` · ${c.notes}` : ''}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {activeTab === 'billing' && (tabNotice || (
          bills.length === 0 ? <EmptyState icon={Receipt} title="No bills yet" description="OPD and IPD bills for this patient appear here." /> : (
            <div className="panel-pad" style={{ overflowX: 'auto' }}>
              <table className="mini-table">
                <thead><tr><th>Bill no.</th><th>Date</th><th>Type</th><th className="text-right">Net payable</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {bills.map((b) => {
                    const billStatus = pick(b, 'STATUS', 'status');
                    const encounterId = pick(b, 'ENCOUNTER_ID', 'encounter_id');
                    const billId = pick(b, 'ID', 'id');
                    return (
                      <tr key={billId}>
                        <td className="mono">{pick(b, 'BILL_NUMBER', 'bill_number')}</td>
                        <td className="tabular">{fmtDate(pick(b, 'CREATED_AT', 'created_at'))}</td>
                        <td>{pick(b, 'BILL_TYPE', 'bill_type')}</td>
                        <td className="tabular text-right">{inr(pick(b, 'NET_PAYABLE', 'net_payable'))}</td>
                        <td><span className={`status status-${BILL_TONE[billStatus] || 'neutral'}`}>{billStatus}</span></td>
                        <td className="text-right">
                          {billStatus === 'Paid' ? (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => openAuthenticatedBlob(`/pdf/bill/${billId}`)}>
                              <Download size={14} aria-hidden="true" /> View PDF
                            </button>
                          ) : canBill && encounterId ? (
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate(`/billing/opd/${encounterId}`)}>Collect payment</button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ))}

        {activeTab === 'prescriptions' && (tabNotice || (
          prescriptions.length === 0 ? <EmptyState icon={FileText} title="No prescriptions yet" description="Prescriptions written for this patient appear here." /> : (
            <div className="panel-pad" style={{ overflowX: 'auto' }}>
              <table className="mini-table">
                <thead><tr><th>Date</th><th>Doctor</th><th>Medicines</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {prescriptions.map((p) => {
                    const count = p.items?.length || 0;
                    return (
                      <tr key={p.id}>
                        <td className="tabular">{fmtDate(p.created_at)}</td>
                        <td>{p.doctor_name || 'Doctor'}</td>
                        <td>
                          <span className="cell-stack">
                            <span>{count} {count === 1 ? 'medicine' : 'medicines'}</span>
                            {count > 0 && <span className="cell-secondary">{p.items.map((i) => i.medicine_name).join(', ')}</span>}
                          </span>
                        </td>
                        <td><span className={`status status-${p.status === 'Finalized' || p.status === 'Dispensed' ? 'success' : 'info'}`}>{p.status || '—'}</span></td>
                        <td className="text-right">
                          {canPrescribe && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(`/hms/prescription-slip?patientId=${id}&encounterId=${p.encounter_id}`)}>
                              View prescription
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        ))}

        {activeTab === 'documents' && (tabNotice || <PatientDocumentsPanel patientId={id} role={user?.role} />)}

        {activeTab === 'vitals' && (tabNotice || (
          vitals.length === 0 && ipdVitals.length === 0 ? <EmptyState icon={HeartPulse} title="No vitals recorded" description="Vitals from triage, OPD and the wards appear here." /> : (
            <div className="panel-pad stack" style={{ overflowX: 'auto' }}>
              {vitals.length > 0 && (
                <table className="mini-table">
                  <caption className="panel-subtitle" style={{ textAlign: 'left', marginTop: 0 }}>Triage and OPD</caption>
                  <thead><tr><th>Recorded</th><th>BP (mmHg)</th><th>Pulse (bpm)</th><th>Temperature</th><th>SpO2 (%)</th><th>Alerts</th></tr></thead>
                  <tbody>
                    {vitals.map((v) => {
                      const alerts = parseAlerts(pick(v, 'alerts', 'ALERTS'));
                      const sys = pick(v, 'bp_systolic', 'BP_SYSTOLIC');
                      return (
                        <tr key={pick(v, 'id', 'ID')}>
                          <td className="tabular">{fmtDateTime(pick(v, 'recorded_at', 'RECORDED_AT'))}</td>
                          <td className="tabular">{sys ? `${sys}/${pick(v, 'bp_diastolic', 'BP_DIASTOLIC') ?? '—'}` : '—'}</td>
                          <td className="tabular">{pick(v, 'pulse', 'PULSE') ?? '—'}</td>
                          <td className="tabular">{pick(v, 'temperature', 'TEMPERATURE') != null ? `${pick(v, 'temperature', 'TEMPERATURE')} °${pick(v, 'temp_unit', 'TEMP_UNIT') || 'F'}` : '—'}</td>
                          <td className="tabular">{pick(v, 'spo2', 'SPO2') ?? '—'}</td>
                          <td>{alerts.length ? <span className="chip-row">{alerts.map((a) => <span key={a} className="status status-danger">{a}</span>)}</span> : <span className="muted">None</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {ipdVitals.length > 0 && (
                <table className="mini-table">
                  <caption className="panel-subtitle" style={{ textAlign: 'left' }}>Inpatient charting</caption>
                  <thead><tr><th>Recorded</th><th>Shift</th><th>BP (mmHg)</th><th>Pulse (bpm)</th><th>Temperature</th><th>SpO2 (%)</th><th>In / out (mL)</th></tr></thead>
                  <tbody>
                    {ipdVitals.map((v) => {
                      const sys = pick(v, 'bpSystolic', 'BP_SYSTOLIC');
                      const intake = Number(pick(v, 'intakeOralMl', 'INTAKE_ORAL_ML') || 0) + Number(pick(v, 'intakeIvMl', 'INTAKE_IV_ML') || 0);
                      const output = Number(pick(v, 'outputUrineMl', 'OUTPUT_URINE_ML') || 0) + Number(pick(v, 'outputDrainMl', 'OUTPUT_DRAIN_ML') || 0);
                      return (
                        <tr key={pick(v, 'id', 'ID')}>
                          <td className="tabular">{fmtDateTime(pick(v, 'recordedAt', 'RECORDED_AT'))}</td>
                          <td>{pick(v, 'shift', 'SHIFT') || '—'}</td>
                          <td className="tabular">{sys ? `${sys}/${pick(v, 'bpDiastolic', 'BP_DIASTOLIC') ?? '—'}` : '—'}</td>
                          <td className="tabular">{pick(v, 'pulse', 'PULSE') ?? '—'}</td>
                          <td className="tabular">{pick(v, 'temperature', 'TEMPERATURE') ?? '—'}</td>
                          <td className="tabular">{pick(v, 'spo2', 'SPO2') ?? '—'}</td>
                          <td className="tabular">{intake} / {output}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )
        ))}
      </section>
    </div>
    </main>

    <Modal
      open={allergyOpen}
      onOpenChange={(open) => { if (!saving) setAllergyOpen(open); }}
      title="Add allergy"
      description="Prescribers are warned when a medicine matches a recorded allergy."
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setAllergyOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="allergy-form" className="btn btn-primary btn-md" disabled={saving}>{saving ? 'Saving…' : 'Save allergy'}</button>
        </>
      )}
    >
      <form id="allergy-form" className="stack-sm" onSubmit={saveAllergy}>
        <div className="form-group">
          <label className="form-label" htmlFor="allergy-allergen">Allergen</label>
          <input id="allergy-allergen" className="form-input" required maxLength={200} value={allergyForm.allergen} onChange={(e) => setAllergyForm((f) => ({ ...f, allergen: e.target.value }))} placeholder="e.g. Penicillin" />
          <p className="form-hint">Use the medicine or substance name, so prescriptions can be checked against it.</p>
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="allergy-reaction">Reaction</label>
          <input id="allergy-reaction" className="form-input" maxLength={200} value={allergyForm.reaction} onChange={(e) => setAllergyForm((f) => ({ ...f, reaction: e.target.value }))} placeholder="e.g. Rash, breathlessness" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="allergy-severity">Severity</label>
          <select id="allergy-severity" className="form-select" value={allergyForm.severity} onChange={(e) => setAllergyForm((f) => ({ ...f, severity: e.target.value }))}>
            <option value="">Not recorded</option>
            {SEVERITIES.map((sv) => <option key={sv} value={sv}>{sv}</option>)}
          </select>
        </div>
      </form>
    </Modal>

    <Modal
      open={conditionOpen}
      onOpenChange={(open) => { if (!saving) setConditionOpen(open); }}
      title="Add chronic condition"
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setConditionOpen(false)} disabled={saving}>Cancel</button>
          <button type="submit" form="condition-form" className="btn btn-primary btn-md" disabled={saving}>{saving ? 'Saving…' : 'Save condition'}</button>
        </>
      )}
    >
      <form id="condition-form" className="stack-sm" onSubmit={saveCondition}>
        <div className="form-group">
          <label className="form-label" htmlFor="condition-name">Condition</label>
          <input id="condition-name" className="form-input" required maxLength={200} value={conditionForm.condition_name} onChange={(e) => setConditionForm((f) => ({ ...f, condition_name: e.target.value }))} placeholder="e.g. Type 2 diabetes" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="condition-since">Since</label>
          <input id="condition-since" className="form-input" maxLength={50} value={conditionForm.since_when} onChange={(e) => setConditionForm((f) => ({ ...f, since_when: e.target.value }))} placeholder="e.g. 2019" />
        </div>
        <div className="form-group">
          <label className="form-label" htmlFor="condition-notes">Notes</label>
          <textarea id="condition-notes" className="form-textarea" rows={2} value={conditionForm.notes} onChange={(e) => setConditionForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>
      </form>
    </Modal>
    </>
  );
}
