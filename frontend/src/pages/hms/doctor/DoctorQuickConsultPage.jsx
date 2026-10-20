import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../../api/axios';
import { toast } from 'react-hot-toast';
import { ArrowLeft, ArrowRight, CircleCheck, FlaskConical, HeartPulse, Search, TriangleAlert, UserRound, X } from 'lucide-react';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import MedicationOrderPanel from '../consultation/MedicationOrderPanel';
import MedicationAllergyPanel from '../consultation/MedicationAllergyPanel';
import { useAuth } from '../../../context/AuthContext';
import useRecoverableDraft from '../../../hooks/useRecoverableDraft';
import Modal from '../../../components/ui/Modal';

const EMPTY_NOTE={chief_complaint:'',hopi:'',past_medical_history:'',general_examination:'',cvs_findings:'',rs_findings:''};

// NUMERIC columns arrive as strings ("38.20"); show them as numbers (38.2).
const shown = (v, unit = '') => {
  if (v === null || v === undefined || v === '') return '—';
  const n = Number(v);
  return `${Number.isFinite(n) ? n : v}${unit}`;
};

export default function DoctorQuickConsultPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  
  const [activePatient, setActivePatient] = useState(null);
  const [activeEncounterId, setActiveEncounterId] = useState(null);
  const [initializing,setInitializing]=useState(false),[initializationError,setInitializationError]=useState(''),[startRecovery,setStartRecovery]=useState(null),[openChoices,setOpenChoices]=useState(null),[chosenEncounter,setChosenEncounter]=useState(''),[loadedState,setLoadedState]=useState(null),[contextError,setContextError]=useState('');
  const initializeGeneration=useRef(0),searchGeneration=useRef(0),initializeLock=useRef(false);
  const actorScope=String(user?.id)+':'+String(user?.facilityId),currentActorScope=useRef(actorScope);currentActorScope.current=actorScope;
  const selectionDraft=useRecoverableDraft({userId:user?.id,facilityId:user?.facilityId,scope:'quick-consult-selection',id:'current'});
  useEffect(()=>()=>{initializeGeneration.current++;searchGeneration.current++;},[]);
  useEffect(()=>{initializeGeneration.current++;initializeLock.current=false;setActivePatient(null);setActiveEncounterId(null);setOpenChoices(null);setStartRecovery(null);setInitializing(false);},[actorScope]);
  useEffect(()=>{
    const saved=selectionDraft.recovered?.pending;if(!saved)return;
    selectionDraft.dismiss();
    if(saved.kind==='ACTIVE')initializePatient(saved.patient,saved.encounterId);
    else if(saved.kind==='CREATE')setStartRecovery(saved);
  },[selectionDraft.recovered]); // The persisted selection is bound to this actor and facility.

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

  const [hasPendingMedication, setHasPendingMedication] = useState(true);

  // Patient safety: allergy record and the confirmation before prescribing against it

  // Patient Search Logic
  useEffect(() => {
    searchGeneration.current++;
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
    const generation=++searchGeneration.current,scope=actorScope;
    try {
      setIsSearching(true);
      const res = await api.get(`/patients/search?q=${encodeURIComponent(q)}`);
      if(generation===searchGeneration.current&&currentActorScope.current===scope)setSearchResults(res.data.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      if(generation===searchGeneration.current&&currentActorScope.current===scope)setIsSearching(false);
    }
  };

  const initializePatient=async(patient,encounterId=null,pending=null)=>{
    if(initializeLock.current)return;
    initializeLock.current=true;const generation=++initializeGeneration.current,scope=actorScope;
    const current=()=>generation===initializeGeneration.current&&currentActorScope.current===scope;
    setInitializing(true);setInitializationError('');setOpenChoices(null);setStartRecovery(null);setContextError('');
    searchGeneration.current++;setVitals(null);setLabReports([]);setDiagnoses([]);setIcdSearch('');setIcdResults([]);setQcRecovery(null);setFormData({...EMPTY_NOTE});setActiveTab('history');
    try{
      let id=encounterId;
      if(!id){
        const request=pending||{kind:'CREATE',patient:{id:patient.id||patient.ID,name:patient.name,uhid:patient.uhid},key:crypto.randomUUID(),body:{patient_id:patient.id||patient.ID,encounter_type:'OPD'}};
        selectionDraft.setPending(request);
        try{const created=await api.post('/hms/encounters',request.body,{headers:{'Idempotency-Key':request.key}});id=created.data.id;}
        catch(error){if(current()){
          const unknown=!error.response||error.response.status>=500||['IDEMPOTENCY_IN_PROGRESS','IDEMPOTENCY_OUTCOME_UNKNOWN'].includes(error.response.data?.code);
          if(unknown)setStartRecovery(request);else selectionDraft.clear();
        }throw error;}
      }
      if(!current())return;
      selectionDraft.setPending({kind:'ACTIVE',patient:{...patient,id:patient.id||patient.ID},encounterId:id});
      const response=await api.get('/hms/encounters/'+id),encounter=response.data;
      if(!current())return;
      if(Number(encounter.patient_id)!==Number(patient.id||patient.ID)||Number(encounter.doctor_id)!==Number(user.id))throw new Error('The selected consultation belongs to another patient or practitioner.');
      encounterRevision.current=Number(encounter.api_version);encounterPublicId.current=encounter.public_id;
      finalizeRequest.current=null;setUncertainFinalize(false);setHasPendingMedication(true);setLoadedState(encounter.status);
      setFormData(Object.fromEntries(Object.keys(EMPTY_NOTE).map(key=>[key,encounter[key]||''])));setDiagnoses(encounter.diagnoses||[]);
      setActivePatient({...patient,...encounter.patient});setActiveEncounterId(id);setSearchQuery('');setSearchResults([]);
      const results=await Promise.allSettled([api.get(`/hms/vitals/latest/${patient.id||patient.ID}`),api.get(`/patients/hms/${patient.id||patient.ID}/visits`)]);
      if(!current())return;
      if(results[0].status==='fulfilled')setVitals(results[0].value.data.data||null);
      if(results[1].status==='fulfilled')setLabReports((results[1].value.data.data||[]).filter(v=>v.type==='Lab Test'));
      if(results.some(r=>r.status==='rejected'))setContextError('Some chart context could not be loaded. Refresh the chart before making decisions that require it.');
    }catch(error){if(current()){const message=error.response?.data?.message||error.message||'Could not initialize this consultation.';setInitializationError(message);toast.error(message);}}
    finally{if(current()){initializeLock.current=false;setInitializing(false);}}
  };
  const selectPatient=async patient=>{
    if(initializeLock.current||startRecovery)return;
    initializeLock.current=true;const generation=++initializeGeneration.current,scope=actorScope;setInitializing(true);setInitializationError('');
    try{
      const response=await api.get(`/hms/encounters/patient/${patient.id||patient.ID}`);
      if(generation!==initializeGeneration.current||currentActorScope.current!==scope)return;
      const drafts=(response.data||[]).filter(e=>e.status==='Draft'&&Number(e.doctor_id)===Number(user.id));
      initializeLock.current=false;setInitializing(false);
      if(drafts.length>1){setChosenEncounter('');setOpenChoices({patient,drafts});return;}
      await initializePatient(patient,drafts[0]?.id||null);
    }catch(error){if(generation===initializeGeneration.current&&currentActorScope.current===scope){initializeLock.current=false;setInitializing(false);setInitializationError(error.response?.data?.message||'Could not check existing consultations.');}}
  };

  const resetPatient = () => {
    initializeGeneration.current++;searchGeneration.current++;selectionDraft.clear();setQcRecovery(null);setInitializationError('');setLoadedState(null);setActivePatient(null);
    setActiveEncounterId(null);
    setVitals(null);
    setLabReports([]);
    setDiagnoses([]);
    setFormData({ chief_complaint: '', hopi: '', past_medical_history: '', general_examination: '', cvs_findings: '', rs_findings: '' });
  };
  const clearPatient = () => {
    if(initializing||finalizing||uncertainFinalize||finalizeRequest.current){toast.error('Reconcile the current request before switching patient.');return;}
    if(activeEncounterId&&hasPendingMedication&&loadedState!=='Finalized'){toast.error('Save/sign medication orders or reconcile the pending outcome before switching patient.');return;}
    resetPatient();
  };

  const handleInputChange = (e) => {
    if(initializing||finalizing||uncertainFinalize||loadedState==='Finalized')return;
    const next={ ...formData, [e.target.name]: e.target.value };
    setFormData(next);
    qcDraft.keep(next,encounterRevision.current);
  };

  // ─── Diagnosis Handlers ───
  const searchIcd = async (q) => {
    const generation=initializeGeneration.current,scope=actorScope;
    setIcdSearch(q);
    if (q.length < 2) return setIcdResults([]);
    try {
      const res = await api.get(`/hms/icd10/search?q=${q}`);
      if(generation===initializeGeneration.current&&currentActorScope.current===scope)setIcdResults(res.data);
    } catch (err) { console.error(err); }
  };

  const addDiagnosis = async (icd) => {
    if(initializing||finalizing||uncertainFinalize||loadedState==='Finalized')return;
    const generation=initializeGeneration.current,scope=actorScope;
    try {
      const payload = {
        encounter_id: activeEncounterId,
        icd10_code: icd.code,
        icd10_description: icd.description,
        diagnosis_type: 'Primary',
        status: 'Provisional'
      };
      const res = await api.post('/hms/diagnoses', payload);
      if(generation!==initializeGeneration.current||currentActorScope.current!==scope)return;
      setDiagnoses(current=>[...current,res.data]);
      setIcdSearch('');
      setIcdResults([]);
      toast.success('Diagnosis added');
    } catch (err) {
      toast.error('Failed to add diagnosis');
    }
  };

  const removeDiagnosis = async (dxId) => {
    if(initializing||finalizing||uncertainFinalize||loadedState==='Finalized')return;
    const generation=initializeGeneration.current,scope=actorScope;
    try {
      await api.delete(`/hms/diagnoses/${dxId}`);
      if(generation===initializeGeneration.current&&currentActorScope.current===scope)setDiagnoses(current=>current.filter(d=>d.id!==dxId));
    } catch (err) { toast.error('Failed to remove diagnosis'); }
  };

  // ─── Prescription Handlers ───
  // ─── Finalize ───
  const [finalizing,setFinalizing]=useState(false),[uncertainFinalize,setUncertainFinalize]=useState(false);
  const finalizeRequest=useRef(null),finalizeRunning=useRef(false),encounterRevision=useRef(1),encounterPublicId=useRef(null);
  // Unsaved notes and an unanswered save/sign survive a reload (C2); they come
  // back when the same consultation is opened again in this tab.
  const qcDraft=useRecoverableDraft({userId:user?.id,facilityId:user?.facility_id||user?.facilityId,scope:'quick-consult',id:activeEncounterId});
  const [qcRecovery,setQcRecovery]=useState(null);
  useEffect(()=>{
    const kept=qcDraft.recovered;
    if(!kept||!activeEncounterId)return;
    if(kept.pending){
      if(kept.pending.id!==encounterPublicId.current){setInitializationError('The recovered request belongs to another consultation and cannot be applied here.');return;}
      finalizeRequest.current=kept.pending;setUncertainFinalize(true);setFormData(f=>({...f,...(kept.pending.content||{})}));qcDraft.dismiss();return;
    }
    if(kept.value)setQcRecovery(kept);
  },[qcDraft.recovered,activeEncounterId]); // eslint-disable-line react-hooks/exhaustive-deps
  const finalizeEncounter = async (reconcile=false) => {
    if(initializing||finalizeRunning.current||(!reconcile&&(finalizeRequest.current||loadedState==='Finalized')))return;
    if (!activeEncounterId || hasPendingMedication) return toast.error('Confirm and sign medication orders before finalizing.');
    const r=reconcile?finalizeRequest.current:{id:encounterPublicId.current,content:JSON.parse(JSON.stringify(formData)),revision:encounterRevision.current,stage:'SAVE',saveKey:crypto.randomUUID(),signKey:crypto.randomUUID()};
    if(!r||r.id!==encounterPublicId.current)return;
    const generation=initializeGeneration.current,scope=actorScope,current=()=>generation===initializeGeneration.current&&currentActorScope.current===scope;
    finalizeRequest.current=r;qcDraft.setPending(r);finalizeRunning.current=true;setFinalizing(true);
    try {
      if(r.stage==='SAVE'){
        const saved=await api.put(`/v2/encounters/${r.id}/draft`,r.content,{headers:{'If-Match':String(r.revision),'Idempotency-Key':r.saveKey}});
        if(!current())return;
        r.revision=saved.data.version;encounterRevision.current=r.revision;r.stage='SIGN';qcDraft.setPending(r);
      }
      await api.post(`/v2/encounters/${r.id}/sign`, {},{headers:{'If-Match':String(r.revision),'Idempotency-Key':r.signKey}});
      if(!current())return;
      finalizeRequest.current=null;setUncertainFinalize(false);qcDraft.clear();
      toast.success('Consultation finalized');
      resetPatient();
    } catch (err) { 
      if(!current())return;
      const unknown=!err.response||err.response.status>=500||['IDEMPOTENCY_IN_PROGRESS','IDEMPOTENCY_OUTCOME_UNKNOWN'].includes(err.response.data?.code);setUncertainFinalize(unknown);
      if(!unknown){finalizeRequest.current=null;qcDraft.setPending(null);}
      toast.error(unknown?'Outcome uncertain. Keep this patient open and reconcile the original request.':err.response?.data?.message||err.response?.data?.error||'Failed to finalize encounter. Your draft is preserved.');
    }finally{if(currentActorScope.current===scope){finalizeRunning.current=false;setFinalizing(false);}}
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
          <button type="button" className="btn btn-ghost btn-md" disabled={initializing||finalizing||uncertainFinalize} onClick={clearPatient}>
            <ArrowLeft size={16} aria-hidden="true" /> Back to search
          </button>
        )}
      />
      {initializing&&<p role="status">Loading the exact consultation and patient context…</p>}
      {initializationError&&<section role="alert" className="alert-strip alert-warning">{initializationError} <button type="button" className="btn btn-secondary" onClick={()=>navigate('/doctor/dashboard')}>Select a visit on dashboard</button></section>}
      {contextError&&<p role="alert" className="alert-strip alert-warning">{contextError}</p>}
      {loadedState==='Finalized'&&!uncertainFinalize&&<p role="status">This consultation is finalized. Its signed record is preserved.</p>}
      {startRecovery&&<section role="alert" aria-label="Unconfirmed Quick Consult start" className="alert-strip alert-warning">The original start for {startRecovery.patient.name} is unconfirmed. <button type="button" className="btn btn-secondary" disabled={initializing} onClick={()=>initializePatient(startRecovery.patient,null,startRecovery)}>Reconcile original Quick Consult start</button></section>}
      <Modal open={!!openChoices} onOpenChange={open=>{if(!open)setOpenChoices(null);}} title="Select open consultation" description="Several drafts exist for this patient. Select the exact consultation to resume, or explicitly start another.">
       {openChoices&&<><label className="form-label">Open consultation<select aria-label="Open consultation" className="form-select" value={chosenEncounter} onChange={e=>setChosenEncounter(e.target.value)}><option value="">Select a consultation</option>{openChoices.drafts.map(e=><option key={e.id} value={e.id}>Consultation {e.id} · {e.chief_complaint||'Draft without complaint'}</option>)}</select></label><div className="inline-actions"><button type="button" className="btn btn-primary" disabled={!chosenEncounter} onClick={()=>initializePatient(openChoices.patient,Number(chosenEncounter))}>Open selected consultation</button><button type="button" className="btn btn-secondary" onClick={()=>initializePatient(openChoices.patient)}>Start new consultation</button></div></>}
      </Modal>
      {qcRecovery&&<section className="alert-strip alert-warning" role="alert" aria-label="Unsaved notes recovered" style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <span>Unsaved notes for this consultation from {new Date(qcRecovery.savedAt).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit'})} were kept when this page last closed.</span>
        <button type="button" className="btn btn-primary btn-sm" onClick={()=>{setFormData(f=>({...f,...qcRecovery.value}));
          // Written against an older revision: signing compares against that revision (412) instead of overwriting.
          if(Number(qcRecovery.revision)<encounterRevision.current)encounterRevision.current=Number(qcRecovery.revision);
          setQcRecovery(null);}}>Restore them</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={()=>{qcDraft.clear();setQcRecovery(null);}}>Discard</button>
      </section>}
      {uncertainFinalize&&<div className="alert-strip alert-info" role="alert">The save/sign outcome is uncertain. Keep this chart open. <button className="btn btn-secondary btn-sm" disabled={initializing||finalizing||hasPendingMedication} onClick={()=>finalizeEncounter(true)}>Reconcile original consultation</button></div>}

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
                  <button type="button" className="list-row" disabled={initializing||!!startRecovery} onClick={() => selectPatient(p)}>
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
        <>
        <div className="panel panel-pad" style={{ marginBottom: 16 }}>
          {activeEncounterId && <MedicationAllergyPanel key={`${activePatient.id || activePatient.ID}:${activeEncounterId}`} patientId={activePatient.id || activePatient.ID} />}
        </div>
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

            <section className="panel panel-pad" aria-labelledby="qc-vitals-title">
              <h2 className="panel-title" id="qc-vitals-title"><HeartPulse size={16} aria-hidden="true" /> Latest vitals</h2>
              {vitals ? (
                <>
                  <p className="muted" style={{ marginTop: 0 }}>
                    Recorded {new Date(vitals.recorded_at || vitals.RECORDED_AT).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true })}
                  </p>
                  <div className="facts">
                    <div><div className="fact-label">BP</div><div className="fact-value tabular">{vitals.bp_systolic ? `${vitals.bp_systolic}/${shown(vitals.bp_diastolic)}` : '—'}</div></div>
                    <div><div className="fact-label">Pulse</div><div className="fact-value tabular">{shown(vitals.pulse, ' bpm')}</div></div>
                    <div><div className="fact-label">Temperature</div><div className="fact-value tabular">{shown(vitals.temperature, ` °${vitals.temp_unit || vitals.TEMP_UNIT || 'F'}`)}</div></div>
                    <div><div className="fact-label">SpO2</div><div className="fact-value tabular">{shown(vitals.spo2, '%')}</div></div>
                  </div>
                </>
              ) : (
                <div className="alert-strip alert-warning" style={{ marginBottom: 0 }}>No vitals recorded for this patient.</div>
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
                    <textarea disabled={initializing||finalizing||uncertainFinalize||loadedState==='Finalized'} id="qc-chief-complaint" name="chief_complaint" className="form-textarea" value={formData.chief_complaint} onChange={handleInputChange} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-hopi">History of present illness</label>
                    <textarea disabled={initializing||finalizing||uncertainFinalize||loadedState==='Finalized'} id="qc-hopi" name="hopi" className="form-textarea" value={formData.hopi} onChange={handleInputChange} style={{ minHeight: 120 }} />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="qc-general-exam">General examination findings</label>
                    <textarea disabled={initializing||finalizing||uncertainFinalize||loadedState==='Finalized'} id="qc-general-exam" name="general_examination" className="form-textarea" value={formData.general_examination} onChange={handleInputChange} style={{ minHeight: 80 }} />
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

              <div hidden={activeTab !== 'prescription'} className="stack" style={{ display: activeTab === 'prescription' ? undefined : 'none' }}>
                {activeEncounterId ? <>
                  <MedicationOrderPanel key={`${activePatient.id || activePatient.ID}:${activeEncounterId}`} patientId={activePatient.id || activePatient.ID} encounterId={activeEncounterId} onPendingChange={setHasPendingMedication} />
                </> : <p role="status">A confirmed encounter is required before ordering medicines.</p>}
              </div>
            </div>

            <div className="panel-pad" style={{ borderTop: '1px solid var(--border)', background: 'var(--surface-2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="muted">Consulting <strong>{activePatient?.name}</strong></span>
              <button type="button" className="btn btn-primary btn-md" disabled={initializing||finalizing||uncertainFinalize||loadedState==='Finalized'} onClick={()=>finalizeEncounter()}>
                <CircleCheck size={16} aria-hidden="true" /> Finalize and close
              </button>
            </div>
          </section>
        </div>
        </>
      )}
    </main>
    </>
  );
}
