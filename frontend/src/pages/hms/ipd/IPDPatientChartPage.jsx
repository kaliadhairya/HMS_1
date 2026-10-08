import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import api from '../../../api/axios';
import toast from 'react-hot-toast';
import Navbar from '../../../components/Navbar';
import DischargeSummaryModal from '../../../components/DischargeSummaryModal';
import { useAuth } from '../../../context/AuthContext';
// Assuming recharts is installed based on standard dashboard tech stack
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

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
  const [vitalForm, setVitalForm] = useState({ bpSystolic: '', bpDiastolic: '', temperature: '', pulse: '', spo2: '', respiratoryRate: '', painScore: '', intakeOralMl: '', intakeIvMl: '', outputUrineMl: '', outputDrainMl: '', shift: 'Morning' });

  const fetchData = async () => {
    try {
      const ad = await api.get(`/ipd/admissions/${id}`);
      setAdmission(ad.data.data);
      if (activeTab === 'progress') fetchProgressNotes();
      else if (activeTab === 'nursing') fetchNursingNotes();
      else if (activeTab === 'vitals') fetchVitals(ad.data.data.PATIENT_ID);
      else if (activeTab === 'mar') fetchMar();
    } catch (err) {
      toast.error('Failed to load admission details');
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
      toast.success('Progress Note saved');
      setPnForm({ subjective: '', objective: '', assessment: '', plan: '' });
      fetchProgressNotes();
    } catch (err) { toast.error('Failed'); }
  };

  const submitNn = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ipd/nursing-notes', { ...nnForm, admissionId: id });
      toast.success('Nursing Note saved');
      setNnForm({ conditionNotes: '', complaints: '', actionsTaken: '' });
      fetchNursingNotes();
    } catch (err) { toast.error('Failed'); }
  };

  const submitVitals = async (e) => {
    e.preventDefault();
    try {
      await api.post('/ipd/vitals', { ...vitalForm, admissionId: id, patientId: admission.PATIENT_ID });
      toast.success('Vitals saved');
      // Reset numeric fields
      setVitalForm({ ...vitalForm, bpSystolic: '', bpDiastolic: '', temperature: '', pulse: '', spo2: '', respiratoryRate: '', painScore: '' });
      fetchVitals();
    } catch (err) { toast.error('Failed'); }
  };

  if (!admission) return <div>Loading...</div>;

  return (
    <>
    <Navbar />
    <div className="page-wrapper fade-up">
      {/* HEADER CARD */}
      <div className="card" style={{ padding: 24, marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderLeft: admission.STATUS === 'Active' ? '4px solid #48bb78' : '4px solid #cbd5e0' }}>
        <div>
          <h2 style={{ margin: 0 }}>{admission.PATIENT_NAME} ({admission.UHID})</h2>
          <div style={{ color: 'var(--text-secondary)', marginTop: 8, display: 'flex', gap: 16 }}>
             <span><strong>Bed:</strong> {admission.WARD_NAME} / {admission.BED_NUMBER} ({admission.ROOM_NUMBER})</span>
             <span><strong>Doctor:</strong> {admission.DOCTOR_NAME}</span>
             <span><strong>Admitted:</strong> {new Date(admission.ADMISSION_DATE).toLocaleDateString()} ({admission.DAYS_ADMITTED} Days)</span>
          </div>
        </div>
        <div>
           <span className="badge" style={{ background: admission.STATUS === 'Active' ? '#48bb7820' : '#cbd5e0', color: admission.STATUS === 'Active' ? '#48bb78' : '#4a5568', marginRight: 16 }}>
             {admission.STATUS}
           </span>
           {(user.role === 'admin' || user.role === 'doctor') && admission.STATUS === 'Active' && (
             <button className="btn btn-outline" onClick={handleDischarge}>Discharge</button>
           )}
           {admission.STATUS === 'Discharged' && (
             <button className="btn btn-primary" onClick={handleViewSummary}>View Discharge Summary</button>
           )}
        </div>
      </div>

      {/* TABS MENU - Premium Pill Style */}
      <div style={{ 
        display: 'flex', gap: 12, marginBottom: 24, padding: '6px', 
        background: 'rgba(241,245,249,0.5)', borderRadius: 20, 
        border: '1.5px solid var(--border)',
        width: 'fit-content'
      }}>
        {[
          { id: 'progress', label: 'Progress', icon: '📝', color: '#6366f1' },
          { id: 'nursing', label: 'Nursing', icon: '👩‍⚕️', color: '#10b981' },
          { id: 'vitals', label: 'Vitals', icon: '❤️', color: '#ef4444' },
          { id: 'mar', label: 'Medications', icon: '💊', color: '#3b82f6' },
        ].map(tab => {
          const isActive = activeTab === tab.id;
          return (
            <button 
              key={tab.id} 
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 24px',
                borderRadius: 14, border: 'none', cursor: 'pointer',
                fontWeight: 800, fontSize: '0.88rem', transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                background: isActive ? '#fff' : 'transparent',
                color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                boxShadow: isActive ? '0 4px 12px rgba(0,0,0,0.08)' : 'none',
                transform: isActive ? 'scale(1.02)' : 'none',
              }}
              onMouseEnter={e => { if(!isActive) e.currentTarget.style.color = tab.color; }}
              onMouseLeave={e => { if(!isActive) e.currentTarget.style.color = 'var(--text-muted)'; }}
            >
              <span style={{ 
                fontSize: '1.1rem', 
                opacity: isActive ? 1 : 0.6,
                filter: isActive ? `drop-shadow(0 2px 4px ${tab.color}30)` : 'none'
              }}>{tab.icon}</span>
              {tab.label}
              {isActive && (
                <div style={{ 
                  width: 6, height: 6, borderRadius: '50%', background: tab.color, 
                  boxShadow: `0 0 8px ${tab.color}` 
                }} />
              )}
            </button>
          );
        })}
      </div>

      {/* TAB CONTENT */}
      {activeTab === 'progress' && (
        <div className="hms-anim-1" style={{ display: 'flex', gap: 24 }}>
          {/* List */}
          <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {progressNotes.length === 0 ? (
              <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>📝</div>
                <p>No clinical progress notes have been recorded yet.</p>
              </div>
            ) : (
              progressNotes.map(pn => (
                <div key={pn.ID} className="card hms-anim-1" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', background: 'rgba(99,102,241,0.03)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, color: '#6366f1', fontSize: '0.9rem' }}>{pn.DOCTOR_NAME}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{new Date(pn.NOTE_DATE).toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '20px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Subjective</label>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6 }}>{pn.SUBJECTIVE}</p>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Objective</label>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6 }}>{pn.OBJECTIVE}</p>
                    </div>
                    <div style={{ gridColumn: 'span 2', height: '1px', background: 'var(--border)', margin: '4px 0' }} />
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Assessment</label>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6, fontWeight: 600 }}>{pn.ASSESSMENT}</p>
                    </div>
                    <div>
                      <label style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.06em', display: 'block', marginBottom: 6 }}>Plan</label>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6, color: 'var(--text-primary)' }}>{pn.PLAN}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Add form */}
          {user.role === 'doctor' && admission.STATUS === 'Active' && (
            <div className="card hms-anim-2" style={{ flex: 1, padding: 0, height: 'fit-content', position: 'sticky', top: 20 }}>
              <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Add SOAP Note</h3>
              </div>
              <form onSubmit={submitPn} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="form-label">Subjective</label>
                  <textarea className="form-control" value={pnForm.subjective} onChange={e => setPnForm({...pnForm, subjective: e.target.value})} required rows="2" style={{ borderRadius: 12 }} />
                </div>
                <div>
                  <label className="form-label">Objective</label>
                  <textarea className="form-control" value={pnForm.objective} onChange={e => setPnForm({...pnForm, objective: e.target.value})} required rows="2" style={{ borderRadius: 12 }} />
                </div>
                <div>
                  <label className="form-label">Assessment</label>
                  <textarea className="form-control" value={pnForm.assessment} onChange={e => setPnForm({...pnForm, assessment: e.target.value})} required rows="2" style={{ borderRadius: 12 }} />
                </div>
                <div>
                  <label className="form-label">Plan</label>
                  <textarea className="form-control" value={pnForm.plan} onChange={e => setPnForm({...pnForm, plan: e.target.value})} required rows="2" style={{ borderRadius: 12 }} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: 48, fontSize: '0.95rem', fontWeight: 800 }}>Save Clinical Note</button>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === 'nursing' && (
        <div className="hms-anim-1" style={{ display: 'flex', gap: 24 }}>
          {/* List */}
          <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {nursingNotes.length === 0 ? (
              <div className="card" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>
                <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.3 }}>👩‍⚕️</div>
                <p>No nursing observations recorded yet.</p>
              </div>
            ) : (
              nursingNotes.map(nn => (
                <div key={nn.ID} className="card hms-anim-1" style={{ padding: 0, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 20px', background: 'rgba(16,185,129,0.03)', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ fontWeight: 800, color: '#10b981', fontSize: '0.9rem' }}>{nn.NURSE_NAME}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{new Date(nn.NOTE_DATE).toLocaleString()}</div>
                  </div>
                  <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                      <label className="form-label">Condition Notes</label>
                      <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6 }}>{nn.CONDITION_NOTES}</p>
                    </div>
                    {nn.COMPLAINTS && (
                      <div>
                        <label className="form-label" style={{ color: '#ef4444' }}>Patient Complaints</label>
                        <p style={{ margin: 0, fontSize: '0.92rem', lineHeight: 1.6, color: '#ef4444', fontWeight: 600 }}>{nn.COMPLAINTS}</p>
                      </div>
                    )}
                    <div style={{ padding: '12px 16px', background: 'var(--surface-2)', borderRadius: 12, border: '1px solid var(--border)' }}>
                      <label className="form-label">Actions Taken</label>
                      <p style={{ margin: 0, fontSize: '0.9rem', lineHeight: 1.5, color: 'var(--text-secondary)' }}>{nn.ACTIONS_TAKEN}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {/* Add form */}
          {['nurse','admin'].includes(user.role) && admission.STATUS === 'Active' && (
            <div className="card hms-anim-2" style={{ flex: 1, padding: 0, height: 'fit-content', position: 'sticky', top: 20 }}>
              <div style={{ padding: '16px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>Record Observation</h3>
              </div>
              <form onSubmit={submitNn} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label className="form-label">Condition Summary</label>
                  <textarea className="form-control" placeholder="Patient's current status..." value={nnForm.conditionNotes} onChange={e => setNnForm({...nnForm, conditionNotes: e.target.value})} required rows="3" style={{ borderRadius: 12 }} />
                </div>
                <div>
                  <label className="form-label">Complaints (if any)</label>
                  <textarea className="form-control" placeholder="Specific complaints..." value={nnForm.complaints} onChange={e => setNnForm({...nnForm, complaints: e.target.value})} rows="2" style={{ borderRadius: 12 }} />
                </div>
                <div>
                  <label className="form-label">Actions & Care Provided</label>
                  <textarea className="form-control" placeholder="Medications, dressings, etc..." value={nnForm.actionsTaken} onChange={e => setNnForm({...nnForm, actionsTaken: e.target.value})} required rows="3" style={{ borderRadius: 12 }} />
                </div>
                <button type="submit" className="btn btn-primary" style={{ height: 48, fontSize: '0.95rem', fontWeight: 800 }}>Save Nursing Note</button>
              </form>
            </div>
          )}
        </div>
      )}

      {activeTab === 'vitals' && (
        <div className="hms-anim-1">
          {/* Chart Header */}
          <div style={{ display: 'flex', gap: 24, marginBottom: 24 }}>
            {/* Enter Vitals */}
            {['nurse', 'admin'].includes(user.role) && admission.STATUS === 'Active' && (
              <div className="card" style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
                <div style={{ padding: '14px 20px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                  <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 800 }}>Record Vitals & I/O</h4>
                </div>
                <form onSubmit={submitVitals} style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                   <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                     <div>
                       <label className="form-label">BP (Sys/Dia)</label>
                       <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                         <input className="form-input" type="number" placeholder="120" value={vitalForm.bpSystolic} onChange={e=>setVitalForm({...vitalForm, bpSystolic:e.target.value})} />
                         <span style={{ color: 'var(--border)' }}>/</span>
                         <input className="form-input" type="number" placeholder="80" value={vitalForm.bpDiastolic} onChange={e=>setVitalForm({...vitalForm, bpDiastolic:e.target.value})} />
                       </div>
                     </div>
                     <div>
                       <label className="form-label">Pulse (bpm)</label>
                       <input className="form-input" type="number" placeholder="72" value={vitalForm.pulse} onChange={e=>setVitalForm({...vitalForm, pulse:e.target.value})} />
                     </div>
                     <div>
                       <label className="form-label">Temp (°F)</label>
                       <input className="form-input" type="number" step="0.1" placeholder="98.6" value={vitalForm.temperature} onChange={e=>setVitalForm({...vitalForm, temperature:e.target.value})} />
                     </div>
                     <div>
                       <label className="form-label">SpO2 (%)</label>
                       <input className="form-input" type="number" placeholder="98" value={vitalForm.spo2} onChange={e=>setVitalForm({...vitalForm, spo2:e.target.value})} />
                     </div>
                     <div>
                       <label className="form-label">Resp Rate</label>
                       <input className="form-input" type="number" placeholder="18" value={vitalForm.respiratoryRate} onChange={e=>setVitalForm({...vitalForm, respiratoryRate:e.target.value})} />
                     </div>
                     <div>
                       <label className="form-label">Shift</label>
                       <select className="form-input" value={vitalForm.shift} onChange={e=>setVitalForm({...vitalForm, shift:e.target.value})}>
                          <option>Morning</option>
                          <option>Afternoon</option>
                          <option>Night</option>
                       </select>
                     </div>
                   </div>
                   <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                     <label className="form-label" style={{ marginBottom: 12 }}>Intake & Output (mL)</label>
                     <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                       <input className="form-input" type="number" placeholder="Oral In" value={vitalForm.intakeOralMl} onChange={e=>setVitalForm({...vitalForm, intakeOralMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="IV In" value={vitalForm.intakeIvMl} onChange={e=>setVitalForm({...vitalForm, intakeIvMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="Urine Out" value={vitalForm.outputUrineMl} onChange={e=>setVitalForm({...vitalForm, outputUrineMl:e.target.value})}/>
                       <input className="form-input" type="number" placeholder="Drain Out" value={vitalForm.outputDrainMl} onChange={e=>setVitalForm({...vitalForm, outputDrainMl:e.target.value})}/>
                     </div>
                   </div>
                   <button type="submit" className="btn btn-primary" style={{ height: 44, fontWeight: 800 }}>Save Vitals</button>
                </form>
              </div>
            )}
            
            {/* Simple Graph Preview */}
            <div className="card" style={{ flex: user.role === 'doctor' ? 1 : 2, padding: 24 }}>
               <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 800 }}>{user.role === 'doctor' ? 'Clinical Trends' : 'Vital Trends'}</h4>
               <div style={{ height: user.role === 'doctor' ? 420 : 320, width: '100%', marginTop: 24 }}>
                  {vitals.length > 0 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={[...vitals].reverse()} margin={{ top: 10, right: 30, left: 0, bottom: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.05)" vertical={false} />
                        <XAxis dataKey="recordedAt" tickFormatter={(v) => new Date(v).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 11, fontWeight: 600, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <Tooltip labelFormatter={(v) => new Date(v).toLocaleString()} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', padding: 12 }} />
                        <Legend iconType="circle" wrapperStyle={{ paddingTop: 20, fontSize: '0.75rem', fontWeight: 700 }} />
                        <Line type="monotone" dataKey="pulse" stroke="#7c3aed" strokeWidth={3} dot={{ r: 4, fill: '#7c3aed', strokeWidth: 2, stroke: '#fff' }} name="Pulse" activeDot={{ r: 6 }} />
                        <Line type="monotone" dataKey="bpSystolic" stroke="#10b981" strokeWidth={3} dot={{ r: 4, fill: '#10b981', strokeWidth: 2, stroke: '#fff' }} name="Systolic BP" activeDot={{ r: 6 }} />
                        {user.role === 'doctor' && (
                          <>
                            <Line type="monotone" dataKey="bpDiastolic" stroke="#06b6d4" strokeWidth={2} strokeDasharray="5 5" dot={{ r: 3 }} name="Diastolic BP" />
                            <Line type="monotone" dataKey="temperature" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Temp (°F)" />
                            <Line type="monotone" dataKey="spo2" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} name="SpO2 (%)" />
                          </>
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div style={{ textAlign: 'center', paddingTop: 120, color: 'var(--text-muted)' }}>
                      <div style={{ fontSize: '2.5rem', marginBottom: 12, opacity: 0.2 }}>📊</div>
                      <p>No vital trends available yet.</p>
                    </div>
                  )}
               </div>
            </div>
          </div>
          
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
             <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
               <thead>
                 <tr style={{ background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Time & Shift</th>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>BP (mmHg)</th>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pulse</th>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Temp</th>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>SpO2</th>
                   <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', textAlign: 'right' }}>Fluid Balance</th>
                 </tr>
               </thead>
               <tbody>
                  {vitals.length === 0 ? (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center', padding: 64, color: 'var(--text-muted)' }}>
                         No clinical vitals recorded for this admission.
                      </td>
                    </tr>
                  ) : vitals.map(v => (
                    <tr key={v.id || v.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                       <td style={{ padding: '14px 20px' }}>
                         <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{new Date(v.RECORDED_AT || v.recordedAt).toLocaleString()}</div>
                         <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 2 }}>{v.SHIFT || v.shift}</div>
                       </td>
                       <td style={{ padding: '14px 20px' }}>
                         <span style={{ 
                           padding: '4px 10px', borderRadius: 8, fontWeight: 700,
                           background: ((v.BP_SYSTOLIC||v.bpSystolic) > 140 || (v.BP_SYSTOLIC||v.bpSystolic) < 90) ? 'rgba(239,68,68,0.08)' : 'rgba(16,185,129,0.08)',
                           color: ((v.BP_SYSTOLIC||v.bpSystolic) > 140 || (v.BP_SYSTOLIC||v.bpSystolic) < 90) ? '#ef4444' : '#10b981'
                         }}>
                           {v.BP_SYSTOLIC || v.bpSystolic}/{v.BP_DIASTOLIC || v.bpDiastolic}
                         </span>
                       </td>
                       <td style={{ padding: '14px 20px', fontWeight: 700 }}>{v.PULSE || v.pulse} <small style={{ fontWeight: 500, color: 'var(--text-muted)' }}>bpm</small></td>
                       <td style={{ padding: '14px 20px', fontWeight: 700 }}>{v.TEMPERATURE || v.temperature} <small style={{ fontWeight: 500, color: 'var(--text-muted)' }}>°F</small></td>
                       <td style={{ padding: '14px 20px' }}>
                         <span style={{ fontWeight: 700, color: ((v.SPO2||v.spo2) < 95) ? '#ef4444' : 'inherit' }}>{v.SPO2 || v.spo2}%</span>
                       </td>
                       <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                         {v.isGeneral ? <span style={{ color: 'var(--text-muted)' }}>—</span> : (
                           <div style={{ fontSize: '0.82rem' }}>
                             <span style={{ color: '#3b82f6' }}>In: {(v.INTAKE_ORAL_ML||0) + (v.INTAKE_IV_ML||0)}</span>
                             <span style={{ margin: '0 8px', color: 'var(--border)' }}>|</span>
                             <span style={{ color: '#f59e0b' }}>Out: {(v.OUTPUT_URINE_ML||0) + (v.OUTPUT_DRAIN_ML||0)}</span>
                           </div>
                         )}
                       </td>
                    </tr>
                  ))}
               </tbody>
             </table>
          </div>
        </div>
      )}

      {activeTab === 'mar' && (
        <div className="card hms-anim-1" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 24px', background: 'rgba(59,130,246,0.03)', borderBottom: '1px solid var(--border)' }}>
            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 800 }}>Scheduled Medications (MAR)</h3>
          </div>
          <div style={{ padding: '12px 24px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)' }}>
            <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: '0.82rem' }}>Real-time medication administration tracking for this admission.</p>
          </div>
          <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--surface-color)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase' }}>Time</th>
                <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase' }}>Medicine</th>
                <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase' }}>Dose & Route</th>
                <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase' }}>Status</th>
                <th style={{ padding: '14px 20px', fontSize: '0.75rem', textTransform: 'uppercase', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {marRecords.length === 0 ? (
                <tr><td colSpan="5" style={{ padding: 48, textAlign: 'center', color: 'var(--text-muted)' }}>No medications scheduled for today.</td></tr>
              ) : (
                marRecords.map(m => (
                  <tr key={m.ID} style={{ borderBottom: '1px solid var(--border)' }}>
                     <td style={{ padding: '14px 20px' }}>
                       <div style={{ fontWeight: 800, color: '#3b82f6' }}>{new Date(m.SCHEDULED_TIME).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                     </td>
                     <td style={{ padding: '14px 20px', fontWeight: 700 }}>{m.MEDICINE_NAME}</td>
                     <td style={{ padding: '14px 20px', color: 'var(--text-secondary)' }}>{m.DOSE} • {m.ROUTE}</td>
                     <td style={{ padding: '14px 20px' }}>
                        <span style={{
                           padding: '5px 12px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase',
                           background: m.STATUS === 'Given' ? 'rgba(16,185,129,0.08)' : m.STATUS === 'Pending' ? 'rgba(241,245,249,1)' : 'rgba(239,68,68,0.08)',
                           color: m.STATUS === 'Given' ? '#10b981' : '#64748b',
                           border: m.STATUS === 'Pending' ? '1px solid var(--border)' : 'none'
                        }}>{m.STATUS}</span>
                     </td>
                     <td style={{ padding: '14px 20px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                          {m.STATUS === 'Pending' && ['nurse','admin'].includes(user.role) && admission.STATUS === 'Active' && (
                             <>
                               <button className="btn btn-sm btn-primary" style={{ borderRadius: 8, background: '#10b981', borderColor: '#10b981' }}
                                 onClick={async () => {
                                   await api.patch(`/ipd/mar/${m.ID}/status`, { status: 'Given' });
                                   toast.success('Medication Administered');
                                   fetchMar();
                                 }}
                               >Give</button>
                               <button className="btn btn-sm btn-outline" style={{ borderRadius: 8, color: '#ef4444', borderColor: '#ef4444' }}
                                 onClick={async () => {
                                   const reason = window.prompt("Reason for holding medication:");
                                   if(!reason) return;
                                   await api.patch(`/ipd/mar/${m.ID}/status`, { status: 'Held', holdReason: reason });
                                   toast.success('Medication Held');
                                   fetchMar();
                                 }}
                               >Hold</button>
                             </>
                          )}
                        </div>
                     </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <style jsx>{`
        .badge { padding: 4px 12px; border-radius: 20px; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.03em; }
        .form-label { font-size: 0.78rem; font-weight: 700; color: var(--text-muted); margin-bottom: 6px; display: block; }
        .hms-anim-1 { animation: slideUp 0.4s ease-out; }
        .hms-anim-2 { animation: slideUp 0.6s ease-out; }
        @keyframes slideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
      `}</style>
    </div>

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
