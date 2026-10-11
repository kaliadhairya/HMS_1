import { useState, useEffect } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Activity, ClipboardPlus, Droplets, FileText, HeartPulse, LogOut, NotebookPen, Pill } from 'lucide-react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import DischargeSummaryModal from '../../../components/DischargeSummaryModal';
import PageHeader from '../../../components/ui/PageHeader';
import EmptyState from '../../../components/ui/EmptyState';
import Modal from '../../../components/ui/Modal';
import { useAuth } from '../../../context/AuthContext';
import VitalTrends from '../../../components/patient/VitalTrends';

const TABS = [
  { id: 'progress', label: 'Progress notes', icon: NotebookPen },
  { id: 'nursing', label: 'Nursing', icon: ClipboardPlus },
  { id: 'vitals', label: 'Vitals', icon: HeartPulse },
  { id: 'mar', label: 'Medications', icon: Pill },
];
const MAR_TONE = { Given: 'success', Pending: 'neutral', Held: 'warning' };
const fmtDateTime = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
// IPD vitals come from a Sequelize model (camelCase); keep UPPER_CASE fallbacks for raw rows.
const num = (...vals) => Number(vals.find((v) => v !== undefined && v !== null) || 0);
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;
const EMPTY_VITALS = { bpSystolic: '', bpDiastolic: '', temperature: '', pulse: '', spo2: '', respiratoryRate: '', painScore: '', intakeOralMl: '', intakeIvMl: '', outputUrineMl: '', outputDrainMl: '' };
const DAY_MS = 864e5;
const signed = (n) => (n > 0 ? `+${n}` : String(n));

export default function IPDPatientChartPage() {
  const { id } = useParams();
  const { user } = useAuth();
  const [admission, setAdmission] = useState(null);
  const location = useLocation();
  const [activeTab, setActiveTab] = useState(location.state?.activeTab || 'progress');
  const [showDischargeModal, setShowDischargeModal] = useState(false);
  const [viewSummaryOnly, setViewSummaryOnly] = useState(false);
  
  // Tab Data States
  const [progressNotes, setProgressNotes] = useState([]);
  const [nursingNotes, setNursingNotes] = useState([]);
  const [vitals, setVitals] = useState([]);
  const [marRecords, setMarRecords] = useState([]);

  // Forms States
  const [pnForm, setPnForm] = useState({ subjective: '', objective: '', assessment: '', plan: '' });
  const [nnForm, setNnForm] = useState({ conditionNotes: '', complaints: '', actionsTaken: '' });
  const [vitalForm, setVitalForm] = useState({ ...EMPTY_VITALS, shift: 'Morning' });

  const fetchData = async () => {
    try {
      const ad = await api.get(`/ipd/admissions/${id}`);
      setAdmission(ad.data.data);
      if (activeTab === 'progress') fetchProgressNotes();
      else if (activeTab === 'nursing') fetchNursingNotes();
      else if (activeTab === 'vitals') fetchVitals(ad.data.data.PATIENT_ID);
      else if (activeTab === 'mar') fetchMar();
    } catch (err) {
      toast.error('Could not load admission details');
    }
  };

  const fetchProgressNotes = async () => {
    const res = await api.get(`/ipd/progress-notes/${id}`);
    setProgressNotes(res.data.data);
  };

  const fetchNursingNotes = async () => {
    const res = await api.get(`/ipd/nursing-notes/${id}`);
    setNursingNotes(res.data.data);
  };

  const fetchVitals = async (patientId) => {
    try {
      const res = await api.get(`/ipd/vitals/${id}`);
      let ipdVitals = res.data.data || [];
      
      const pId = patientId || admission?.PATIENT_ID;
      if (pId) {
        const genRes = await api.get(`/hms/vitals/history/${pId}`);
        const genVitals = genRes.data.data || [];
        
        const mappedGenVitals = genVitals.map(gv => ({
          id: 'gen_' + (gv.id || gv.ID),
          recordedAt: gv.recorded_at || gv.RECORDED_AT || gv.createdAt,
          bpSystolic: gv.bp_systolic || gv.BP_SYSTOLIC,
          bpDiastolic: gv.bp_diastolic || gv.BP_DIASTOLIC,
          pulse: gv.pulse || gv.PULSE,
          temperature: gv.temperature || gv.TEMPERATURE,
          tempUnit: gv.temp_unit || gv.TEMP_UNIT,
          respiratoryRate: gv.respiratory_rate || gv.RESPIRATORY_RATE,
          spo2: gv.spo2 || gv.SPO2,
          shift: (gv.encounter_type || gv.ENCOUNTER_TYPE || 'OPD') + ' Triage',
          isGeneral: true
        }));
        
        const merged = [...ipdVitals, ...mappedGenVitals].sort((a, b) => new Date(b.recordedAt || b.RECORDED_AT) - new Date(a.recordedAt || a.RECORDED_AT));
        setVitals(merged);
      } else {
        setVitals(ipdVitals);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchMar = async () => {
    const res = await api.get(`/ipd/mar/${id}`);
    setMarRecords(res.data.data);
  };

  useEffect(() => {
    fetchData();
  }, [id, activeTab]);

  const handleDischarge = async () => {
    setViewSummaryOnly(false);
    setShowDischargeModal(true);
  };

  const handleViewSummary = () => {
    setViewSummaryOnly(true);
    setShowDischargeModal(true);
  };

  const submitPn = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ipd/progress-notes', { ...pnForm, admissionId: id, patientId: admission.PATIENT_ID });
      toast.success('Progress note saved');
      setPnForm({ subjective: '', objective: '', assessment: '', plan: '' });
      fetchProgressNotes();
    } catch (err) { toast.error(errMsg(err, 'Could not save progress note')); }
  };

  const submitNn = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ipd/nursing-notes', { ...nnForm, admissionId: id });
      toast.success('Nursing note saved');
      setNnForm({ conditionNotes: '', complaints: '', actionsTaken: '' });
      fetchNursingNotes();
    } catch (err) { toast.error(errMsg(err, 'Could not save nursing note')); }
  };

  const submitVitals = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ipd/vitals', { ...vitalForm, admissionId: id, patientId: admission.PATIENT_ID });
      toast.success('Vitals saved');
      // Clear every measurement, intake and output included: they used to stay filled in and were
      // saved again with the next reading, double-counting the fluid balance. The shift is kept.
      setVitalForm((f) => ({ ...EMPTY_VITALS, shift: f.shift }));
      fetchVitals();
    } catch (err) { toast.error(errMsg(err, 'Could not save vitals')); }
  };

  // Medication administration (MAR)
  const [holdTarget, setHoldTarget] = useState(null);
  const [holdReason, setHoldReason] = useState('');
  const [marBusy, setMarBusy] = useState(false);

  const giveMedication = async (m) => {
    setMarBusy(true);
    try {
      await api.patch(`/ipd/mar/${m.ID}/status`, { status: 'Given' });
      toast.success('Medication marked as given');
      fetchMar();
    } catch (err) {
      toast.error(errMsg(err, 'Could not update medication'));
      fetchMar();
    } finally {
      setMarBusy(false);
    }
  };

  const submitHold = async (e) => {
    e.preventDefault();
    const reason = holdReason.trim();
    if (!holdTarget || !reason) return;
    setMarBusy(true);
    try {
      await api.patch(`/ipd/mar/${holdTarget.ID}/status`, { status: 'Held', holdReason: reason });
      toast.success('Medication held');
      setHoldTarget(null);
      fetchMar();
    } catch (err) {
      toast.error(errMsg(err, 'Could not update medication'));
      if (err?.response?.status === 409) { setHoldTarget(null); fetchMar(); }
    } finally {
      setMarBusy(false);
    }
  };

  if (!admission) {
    return (
      <>
        <Navbar />
        <main className="app-page"><p className="muted">Loading…</p></main>
      </>
    );
  }

  // Intake / output totals over the last 24 hours, from the inpatient (not OPD triage) readings.
  const fluid = (() => {
    const since = Date.now() - DAY_MS;
    const rows = vitals.filter((v) => !v.isGeneral && new Date(v.recordedAt || v.RECORDED_AT).getTime() >= since);
    if (rows.length === 0) return null;
    const sum = (a, b) => rows.reduce((t, v) => t + num(v[a], v[b]), 0);
    const oral = sum('INTAKE_ORAL_ML', 'intakeOralMl');
    const iv = sum('INTAKE_IV_ML', 'intakeIvMl');
    const urine = sum('OUTPUT_URINE_ML', 'outputUrineMl');
    const drain = sum('OUTPUT_DRAIN_ML', 'outputDrainMl');
    return { count: rows.length, oral, iv, urine, drain, intake: oral + iv, output: urine + drain, balance: oral + iv - urine - drain };
  })();

  const isActive = admission.STATUS === 'Active';
  const canDischarge = (user.role === 'admin' || user.role === 'doctor') && isActive;
  const canNurse = ['nurse', 'admin'].includes(user.role) && isActive;

  return (
    <>
    <Navbar />
    <main className="app-page">
      <PageHeader
        title={admission.PATIENT_NAME}
        description={`Inpatient chart · ${admission.WARD_NAME || 'Ward'}, bed ${admission.BED_NUMBER || '—'}`}
        meta={(
          <>
            <span className="mono muted">{admission.UHID}</span>
            <span className={`status ${isActive ? 'status-success' : 'status-neutral'}`}>{admission.STATUS}</span>
          </>
        )}
        actions={(
          <>
            {canDischarge && (
              <button type="button" className="btn btn-secondary btn-md" onClick={handleDischarge}>
                <LogOut size={16} aria-hidden="true" /> Discharge
              </button>
            )}
            {admission.STATUS === 'Discharged' && (
              <button type="button" className="btn btn-primary btn-md" onClick={handleViewSummary}>
                <FileText size={16} aria-hidden="true" /> View discharge summary
              </button>
            )}
          </>
        )}
      />

      {/* Admission facts */}
      <section className="panel panel-pad" style={{ marginBottom: 16 }}>
        <div className="facts">
          <div><div className="fact-label">Bed</div><div className="fact-value">{admission.WARD_NAME} / {admission.BED_NUMBER} ({admission.ROOM_NUMBER})</div></div>
          <div><div className="fact-label">Doctor</div><div className="fact-value">{admission.DOCTOR_NAME || '—'}</div></div>
          <div>
            <div className="fact-label">Admitted</div>
            <div className="fact-value tabular">{new Date(admission.ADMISSION_DATE).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })} ({admission.DAYS_ADMITTED} days)</div>
          </div>
          <div><div className="fact-label">Gender / age</div><div className="fact-value">{admission.GENDER || '—'}{admission.AGE ? `, ${admission.AGE} y` : ''}</div></div>
          {admission.PRIMARY_DIAGNOSIS && <div><div className="fact-label">Primary diagnosis</div><div className="fact-value">{admission.PRIMARY_DIAGNOSIS}</div></div>}
        </div>
      </section>

      {/* Tabs */}
      <div className="tabs" role="tablist" aria-label="Chart sections">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`tab${selected ? ' is-active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} aria-hidden="true" /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'progress' && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* List */}
          <div className="stack" style={{ flex: '2 1 480px', minWidth: 0 }}>
            {progressNotes.length === 0 ? (
              <section className="panel">
                <EmptyState icon={NotebookPen} title="No progress notes yet" description="Clinical progress notes for this admission appear here." />
              </section>
            ) : (
              progressNotes.map(pn => (
                <section key={pn.ID} className="panel">
                  <div className="panel-head">
                    <span className="cell-primary">{pn.DOCTOR_NAME}</span>
                    <span className="cell-secondary">{fmtDateTime(pn.NOTE_DATE)}</span>
                  </div>
                  <div className="panel-pad" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16 }}>
                    <div><div className="fact-label">Subjective</div><p className="fact-value" style={{ lineHeight: 1.6 }}>{pn.SUBJECTIVE}</p></div>
                    <div><div className="fact-label">Objective</div><p className="fact-value" style={{ lineHeight: 1.6 }}>{pn.OBJECTIVE}</p></div>
                    <div><div className="fact-label">Assessment</div><p className="fact-value" style={{ lineHeight: 1.6, fontWeight: 600 }}>{pn.ASSESSMENT}</p></div>
                    <div><div className="fact-label">Plan</div><p className="fact-value" style={{ lineHeight: 1.6 }}>{pn.PLAN}</p></div>
                  </div>
                </section>
              ))
            )}
          </div>
          {/* Add form */}
          {user.role === 'doctor' && isActive && (
            <section className="panel" style={{ flex: '1 1 300px', position: 'sticky', top: 20 }}>
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}>Add SOAP note</h2></div>
              <form onSubmit={submitPn} className="panel-pad stack-sm">
                <div className="form-group">
                  <label className="form-label" htmlFor="pn-subjective">Subjective</label>
                  <textarea id="pn-subjective" className="form-textarea" value={pnForm.subjective} onChange={e => setPnForm({...pnForm, subjective: e.target.value})} required rows="2" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pn-objective">Objective</label>
                  <textarea id="pn-objective" className="form-textarea" value={pnForm.objective} onChange={e => setPnForm({...pnForm, objective: e.target.value})} required rows="2" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pn-assessment">Assessment</label>
                  <textarea id="pn-assessment" className="form-textarea" value={pnForm.assessment} onChange={e => setPnForm({...pnForm, assessment: e.target.value})} required rows="2" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="pn-plan">Plan</label>
                  <textarea id="pn-plan" className="form-textarea" value={pnForm.plan} onChange={e => setPnForm({...pnForm, plan: e.target.value})} required rows="2" />
                </div>
                <button type="submit" className="btn btn-primary btn-md">Save progress note</button>
              </form>
            </section>
          )}
        </div>
      )}

      {activeTab === 'nursing' && (
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
          {/* List */}
          <div className="stack" style={{ flex: '2 1 480px', minWidth: 0 }}>
            {nursingNotes.length === 0 ? (
              <section className="panel">
                <EmptyState icon={ClipboardPlus} title="No nursing observations yet" description="Observations recorded by nursing staff appear here." />
              </section>
            ) : (
              nursingNotes.map(nn => (
                <section key={nn.ID} className="panel">
                  <div className="panel-head">
                    <span className="cell-primary">{nn.NURSE_NAME}</span>
                    <span className="cell-secondary">{fmtDateTime(nn.NOTE_DATE)}</span>
                  </div>
                  <div className="panel-pad stack-sm">
                    <div>
                      <div className="fact-label">Condition notes</div>
                      <p className="fact-value" style={{ lineHeight: 1.6 }}>{nn.CONDITION_NOTES}</p>
                    </div>
                    {nn.COMPLAINTS && (
                      <div className="alert-strip alert-warning" style={{ margin: 0, alignItems: 'flex-start', flexDirection: 'column', gap: 2 }}>
                        <strong style={{ fontSize: '0.78rem' }}>Patient complaints</strong>
                        <span>{nn.COMPLAINTS}</span>
                      </div>
                    )}
                    <div style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div className="fact-label">Actions taken</div>
                      <p className="fact-value" style={{ lineHeight: 1.5, color: 'var(--text-secondary)' }}>{nn.ACTIONS_TAKEN}</p>
                    </div>
                  </div>
                </section>
              ))
            )}
          </div>
          {/* Add form */}
          {canNurse && (
            <section className="panel" style={{ flex: '1 1 300px', position: 'sticky', top: 20 }}>
              <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}>Record observation</h2></div>
              <form onSubmit={submitNn} className="panel-pad stack-sm">
                <div className="form-group">
                  <label className="form-label" htmlFor="nn-condition">Condition summary</label>
                  <textarea id="nn-condition" className="form-textarea" placeholder="Patient's current status" value={nnForm.conditionNotes} onChange={e => setNnForm({...nnForm, conditionNotes: e.target.value})} required rows="3" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="nn-complaints">Complaints (if any)</label>
                  <textarea id="nn-complaints" className="form-textarea" placeholder="Specific complaints" value={nnForm.complaints} onChange={e => setNnForm({...nnForm, complaints: e.target.value})} rows="2" />
                </div>
                <div className="form-group">
                  <label className="form-label" htmlFor="nn-actions">Actions and care provided</label>
                  <textarea id="nn-actions" className="form-textarea" placeholder="Medications, dressings and so on" value={nnForm.actionsTaken} onChange={e => setNnForm({...nnForm, actionsTaken: e.target.value})} required rows="3" />
                </div>
                <button type="submit" className="btn btn-primary btn-md">Save nursing note</button>
              </form>
            </section>
          )}
        </div>
      )}

      {activeTab === 'vitals' && (
        <div className="stack">
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            {/* Enter Vitals */}
            {canNurse && (
              <section className="panel" style={{ flex: '1 1 320px' }}>
                <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}>Record vitals and fluid balance</h2></div>
                <form onSubmit={submitVitals} className="panel-pad stack-sm">
                   <div className="form-row-2">
                     <div className="form-group" role="group" aria-labelledby="v-bp-label">
                       <span className="form-label" id="v-bp-label">BP (sys / dia, mmHg)</span>
                       <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                         <input id="v-bp-sys" className="form-input" type="number" placeholder="120" aria-label="Systolic BP" value={vitalForm.bpSystolic} onChange={e=>setVitalForm({...vitalForm, bpSystolic:e.target.value})} />
                         <span className="muted" aria-hidden="true">/</span>
                         <input className="form-input" type="number" placeholder="80" aria-label="Diastolic BP" value={vitalForm.bpDiastolic} onChange={e=>setVitalForm({...vitalForm, bpDiastolic:e.target.value})} />
                       </div>
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="v-pulse">Pulse (bpm)</label>
                       <input id="v-pulse" className="form-input" type="number" placeholder="72" value={vitalForm.pulse} onChange={e=>setVitalForm({...vitalForm, pulse:e.target.value})} />
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="v-temp">Temperature (°F)</label>
                       <input id="v-temp" className="form-input" type="number" step="0.1" placeholder="98.6" value={vitalForm.temperature} onChange={e=>setVitalForm({...vitalForm, temperature:e.target.value})} />
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="v-spo2">SpO2 (%)</label>
                       <input id="v-spo2" className="form-input" type="number" placeholder="98" value={vitalForm.spo2} onChange={e=>setVitalForm({...vitalForm, spo2:e.target.value})} />
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="v-rr">Respiratory rate</label>
                       <input id="v-rr" className="form-input" type="number" placeholder="18" value={vitalForm.respiratoryRate} onChange={e=>setVitalForm({...vitalForm, respiratoryRate:e.target.value})} />
                     </div>
                     <div className="form-group">
                       <label className="form-label" htmlFor="v-shift">Shift</label>
                       <select id="v-shift" className="form-select" value={vitalForm.shift} onChange={e=>setVitalForm({...vitalForm, shift:e.target.value})}>
                          <option>Morning</option>
                          <option>Afternoon</option>
                          <option>Night</option>
                       </select>
                     </div>
                   </div>
                   <fieldset style={{ border: 0, borderTop: '1px solid var(--border)', paddingTop: 12, margin: 0 }}>
                     <legend className="form-label" style={{ padding: 0, marginBottom: 8 }}>Intake and output (mL)</legend>
                     <div className="form-row-2">
                       <input className="form-input" type="number" placeholder="Oral in" aria-label="Oral intake (mL)" value={vitalForm.intakeOralMl} onChange={e=>setVitalForm({...vitalForm, intakeOralMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="IV in" aria-label="IV intake (mL)" value={vitalForm.intakeIvMl} onChange={e=>setVitalForm({...vitalForm, intakeIvMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="Urine out" aria-label="Urine output (mL)" value={vitalForm.outputUrineMl} onChange={e=>setVitalForm({...vitalForm, outputUrineMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="Drain out" aria-label="Drain output (mL)" value={vitalForm.outputDrainMl} onChange={e=>setVitalForm({...vitalForm, outputDrainMl:e.target.value})}/>
                     </div>
                   </fieldset>
                   <button type="submit" className="btn btn-primary btn-md">Save vitals</button>
                </form>
              </section>
            )}

            {/* Trend chart */}
            <section className="panel panel-pad" style={{ flex: user.role === 'doctor' ? '1 1 480px' : '2 1 480px', minWidth: 0 }}>
               <h2 className="panel-title"><Activity size={16} aria-hidden="true" /> {user.role === 'doctor' ? 'Clinical trends' : 'Vital trends'}</h2>
               {vitals.length > 0 ? (
                 <VitalTrends vitals={vitals} height={user.role === 'doctor' ? 170 : 150} />
               ) : (
                 <EmptyState icon={Activity} title="No vital trends yet" description="Trends appear once vitals are recorded for this patient." />
               )}
            </section>
          </div>

          {fluid && (
            <section className="panel">
              <div className="panel-head">
                <h2 className="panel-title" style={{ margin: 0 }}><Droplets size={16} aria-hidden="true" /> Fluid balance</h2>
                <span className="cell-secondary">Last 24 hours · {fluid.count} {fluid.count === 1 ? 'entry' : 'entries'}</span>
              </div>
              <div className="panel-pad facts">
                <div><div className="fact-label">Intake</div><div className="fact-value tabular">{fluid.intake} mL</div><div className="cell-secondary">Oral {fluid.oral} · IV {fluid.iv}</div></div>
                <div><div className="fact-label">Output</div><div className="fact-value tabular">{fluid.output} mL</div><div className="cell-secondary">Urine {fluid.urine} · Drain {fluid.drain}</div></div>
                <div>
                  <div className="fact-label">Balance</div>
                  <div className="fact-value tabular" style={{ color: fluid.balance < 0 ? 'var(--amber)' : undefined }}>{signed(fluid.balance)} mL</div>
                </div>
              </div>
            </section>
          )}

          <section className="panel">
            <div className="panel-head"><h2 className="panel-title" style={{ margin: 0 }}><HeartPulse size={16} aria-hidden="true" /> Vitals log</h2></div>
            {vitals.length === 0 ? (
              <EmptyState icon={HeartPulse} title="No vitals recorded" description="No clinical vitals have been recorded for this admission." />
            ) : (
              <div className="dt-scroll">
                <table className="dt-table">
                  <thead>
                    <tr>
                      <th>Time and shift</th>
                      <th>BP (mmHg)</th>
                      <th>Pulse</th>
                      <th>Temp</th>
                      <th>SpO2</th>
                      <th style={{ textAlign: 'right' }}>Fluid balance (mL)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vitals.map(v => {
                      const sys = v.BP_SYSTOLIC || v.bpSystolic;
                      const dia = v.BP_DIASTOLIC || v.bpDiastolic;
                      const bpOut = sys != null && (sys > 140 || sys < 90);
                      const spo2 = v.SPO2 || v.spo2;
                      return (
                        <tr key={v.id || v.ID}>
                          <td>
                            <span className="cell-stack">
                              <span className="tabular" style={{ fontWeight: 600 }}>{fmtDateTime(v.RECORDED_AT || v.recordedAt)}</span>
                              <span className="cell-secondary">{v.SHIFT || v.shift}</span>
                            </span>
                          </td>
                          <td>
                            {sys ? (
                              <span className={`status ${bpOut ? 'status-danger' : 'status-success'}`}>{sys}/{dia || '—'}</span>
                            ) : <span className="muted">—</span>}
                          </td>
                          <td className="tabular">{(v.PULSE || v.pulse) ? <>{v.PULSE || v.pulse} <span className="cell-secondary">bpm</span></> : <span className="muted">—</span>}</td>
                          <td className="tabular">{(v.TEMPERATURE || v.temperature) ? <>{v.TEMPERATURE || v.temperature} <span className="cell-secondary">°{(v.tempUnit || 'F').toUpperCase().startsWith('C') ? 'C' : 'F'}</span></> : <span className="muted">—</span>}</td>
                          <td className="tabular" style={{ fontWeight: spo2 && spo2 < 95 ? 650 : undefined, color: spo2 && spo2 < 95 ? 'var(--red)' : undefined }}>{spo2 ? `${spo2}%` : <span className="muted">—</span>}</td>
                          <td className="tabular" style={{ textAlign: 'right' }}>
                            {v.isGeneral ? <span className="muted">—</span> : (
                              <span>
                                In {num(v.INTAKE_ORAL_ML, v.intakeOralMl) + num(v.INTAKE_IV_ML, v.intakeIvMl)}
                                <span className="muted" style={{ margin: '0 8px' }} aria-hidden="true">|</span>
                                Out {num(v.OUTPUT_URINE_ML, v.outputUrineMl) + num(v.OUTPUT_DRAIN_ML, v.outputDrainMl)}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'mar' && (
        <section className="panel">
          <div className="panel-head">
            <div className="cell-stack">
              <h2 className="panel-title" style={{ margin: 0 }}><Pill size={16} aria-hidden="true" /> Scheduled medications (MAR)</h2>
              <span className="cell-secondary">Today's doses for this admission, and earlier doses still to be given.</span>
            </div>
          </div>
          {marRecords.length === 0 ? (
            <EmptyState icon={Pill} title="No medications scheduled today" description="Scheduled doses for this admission appear here." />
          ) : (
            <div className="dt-scroll">
              <table className="dt-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Medicine</th>
                    <th>Dose and route</th>
                    <th>Status</th>
                    <th style={{ textAlign: 'right' }}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {marRecords.map(m => (
                    <tr key={m.ID}>
                      <td className="tabular" style={{ fontWeight: 600 }}>
                        {new Date(m.SCHEDULED_TIME).toDateString() !== new Date().toDateString() && <span className="cell-secondary">{new Date(m.SCHEDULED_TIME).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} </span>}
                        {new Date(m.SCHEDULED_TIME).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </td>
                      <td className="cell-primary">{m.MEDICINE_NAME}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>{m.DOSE} · {m.ROUTE}</td>
                      <td>
                        <span className="cell-stack" style={{ alignItems: 'flex-start', gap: 2 }}>
                          <span className={`status status-${MAR_TONE[m.STATUS] || 'danger'}`}>{m.STATUS}</span>
                          {m.STATUS !== 'Pending' && m.ADMINISTERED_AT && (
                            <span className="cell-secondary">{m.ADMINISTERED_BY_NAME || 'Staff'} · {new Date(m.ADMINISTERED_AT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          )}
                          {m.HOLD_REASON && <span className="cell-secondary">Reason: {m.HOLD_REASON}</span>}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        {m.STATUS === 'Pending' && canNurse && (
                          <span className="inline-actions">
                            <button type="button" className="btn btn-primary btn-sm" disabled={marBusy} onClick={() => giveMedication(m)}>Give</button>
                            <button type="button" className="btn btn-secondary btn-sm" disabled={marBusy} onClick={() => { setHoldReason(''); setHoldTarget(m); }}>Hold</button>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </main>

    <Modal
      open={Boolean(holdTarget)}
      onOpenChange={(open) => { if (!open && !marBusy) setHoldTarget(null); }}
      title="Hold medication"
      description={holdTarget ? `${holdTarget.MEDICINE_NAME} · ${holdTarget.DOSE} · ${holdTarget.ROUTE}` : ''}
      size="sm"
      footer={(
        <>
          <button type="button" className="btn btn-ghost btn-md" onClick={() => setHoldTarget(null)} disabled={marBusy}>Cancel</button>
          <button type="submit" form="hold-form" className="btn btn-primary btn-md" disabled={marBusy || !holdReason.trim()}>
            {marBusy ? 'Saving…' : 'Hold medication'}
          </button>
        </>
      )}
    >
      <form id="hold-form" onSubmit={submitHold}>
        <div className="form-group">
          <label className="form-label" htmlFor="hold-reason">Reason for holding</label>
          <textarea id="hold-reason" className="form-textarea" rows="3" value={holdReason} onChange={(e) => setHoldReason(e.target.value)} required autoFocus />
        </div>
      </form>
    </Modal>

    {showDischargeModal && (
      <DischargeSummaryModal 
        admission={admission} 
        viewOnly={viewSummaryOnly}
        onClose={() => setShowDischargeModal(false)}
        onDischargeComplete={() => {
          setShowDischargeModal(false);
          fetchData();
        }}
      />
    )}
    </>
  );
}
