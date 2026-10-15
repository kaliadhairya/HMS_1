import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { FilePen, Lock, Save } from 'lucide-react';
import api from '../../../api/axios';
import {readClinicalDocument,resolveLegacyIdentity} from '../../../api/v2.client';
import {useGovernedCommand} from '../../../hooks/useGovernedCommand';
import {useAuth} from '../../../context/AuthContext';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';

const SECTIONS = [
  ['chief_complaint', 'Chief complaint'],
  ['history', 'History'],
  ['examination', 'Examination'],
  ['assessment', 'Assessment'],
  ['plan', 'Plan'],
];
const DOCUMENT_SECTIONS={
  clinical_note:SECTIONS,
  discharge_summary:[['diagnosis','Diagnosis'],['course','Hospital course'],['condition','Condition at discharge'],['instructions','Discharge instructions'],['medication_plan','Medication continuity plan'],['warning_signs','Warning signs and escalation'],['follow_up','Follow-up'],['pending_results','Pending results']],
  nursing_assessment:[['assessment','Assessment'],['observations','Observations'],['risks','Risks'],['actions','Actions'],['escalation','Escalation']],
  care_plan:[['assessment','Assessment'],['goals','Goals'],['actions','Actions'],['review','Review'],['handover','Handover']],
  encounter_note:['chief_complaint','hopi','past_medical_history','surgical_history','family_history','social_history','current_medications','general_examination','cvs_findings','rs_findings','abdomen_findings','cns_findings'].map(k=>[k,k.replaceAll('_',' ')]),
};

// A clinical note. Every save and signature states the version it is based on;
// if someone else changed the note meanwhile, the save is refused and the latest
// version is shown. Signing freezes the note; changes are linked amendments.
export default function ClinicalNotePage() {
  const { id } = useParams();
  const {user}=useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const routeNoteId=id&&id!=='new'?id:null;
  const contextKey=JSON.stringify([user?.id,user?.facilityId,id,params.get('patient'),params.get('encounter'),params.get('admission'),params.get('docType')]);
  const [loadedContext,setLoadedContext]=useState(null);
  const [note, setNote] = useState(null);
  const [version, setVersion] = useState(null);
  const [content, setContent] = useState({});
  const [versions, setVersions] = useState([]);
  const [loading,setLoading]=useState(Boolean(id&&id!=='new'));
  const [conflict,setConflict]=useState(null);
  const noteId=note?.id||routeNoteId;
  const command=useGovernedCommand(async response=>{applyResponse(response.data);setVersions(response.data.signatures||[]);if(!routeNoteId)navigate(`/hms/notes/${response.data.id}`,{replace:true});},contextKey);
  const busy=loadedContext!==contextKey||loading||command.busy||command.uncertain||Boolean(conflict);
  const documentType=note?.doc_type||params.get('docType')||'clinical_note';

  const applyResponse = (data, etag) => {
    setNote(data);
    setContent(data.content || {});
    setVersion(etag ? Number(etag.replace(/"/g, '')) : data.version);
    setAmendReason(data.state==='draft'&&data.signed_version?data.amendment_reason:null);
  };

  const uuid = async (kind,value) => {
    if(!value)return undefined;
    if(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(String(value)))return value;
    return (await resolveLegacyIdentity(api,kind,String(value))).data.id;
  };
  useEffect(()=>{
    let active=true;
    setNote(null);setVersion(null);setContent({});setVersions([]);setConflict(null);setAmendReason(null);
    if(!routeNoteId){setLoadedContext(contextKey);setLoading(false);return()=>{active=false;};}
    setLoading(true);
    (async()=>{
      try{
        const canonical=await uuid('clinical_document',routeNoteId);
        if(!active)return;
        const res=await readClinicalDocument(api,canonical);
        if(!active)return;
        applyResponse(res.data);setVersions(res.data.signatures||[]);setLoadedContext(contextKey);
      }catch(err){if(active)toast.error(err.response?.data?.message||'Could not load the note.');}
      finally{if(active)setLoading(false);}
    })();
    // Ignore superseded loads, including repeated mounts and record changes.
    return()=>{active=false;};
  },[contextKey]);
  useEffect(()=>{if(command.failure?.status===412&&command.failure.scope===contextKey)setConflict({current:command.failure.current_version,remote:null});},[command.failure,contextKey]);
  const create=async()=>{
    if(busy)return;
    setLoading(true);
    try{
      const body={patient_id:await uuid('patient',params.get('patient')),encounter_id:await uuid('encounter',params.get('encounter')),
        admission_id:await uuid('admission',params.get('admission')),doc_type:documentType,content};
      await command.send('/v2/clinical-documents',body);
    }catch(err){toast.error(err.response?.data?.message||'The patient or care context could not be confirmed. Your draft is preserved.');}
    finally{setLoading(false);}
  };
  const save=()=>command.send(`/v2/clinical-documents/${noteId}/draft`,{content},version,false,'put');
  const sign=()=>{
    if(window.confirm('Sign the exact reviewed note? Later changes require a linked amendment.'))command.send(`/v2/clinical-documents/${noteId}/sign`,{},version);
  };
  const amend=()=>{
    const reason=window.prompt('Why are you amending this signed note? (10–500 characters)');
    if(reason&&reason.trim().length>=10&&reason.trim().length<=500)command.send(`/v2/clinical-documents/${noteId}/amend`,{reason:reason.trim()},version);
  };
  const signAmendment=()=>{if(amendReason)command.send(`/v2/clinical-documents/${noteId}/sign-amendment`,{reason:amendReason},version);};
  const compare=async()=>{
    try{const r=await readClinicalDocument(api,noteId);setConflict({current:r.data.version,remote:r.data});}
    catch{toast.error('Could not load the server version. Your draft is preserved.');}
  };

  const [amendReason, setAmendReason] = useState(null);
  const editable = loadedContext===contextKey&&(!noteId||note?.state==='draft');
  const signedOnce = note?.state === 'signed';

  return (
    <>
      <Navbar />
      <main className="app-page">
        <PageHeader title={`${noteId?'':'New '}${documentType.replaceAll('_',' ')}`} description={note ? `Version ${version} · ${note.state === 'signed' ? 'signed' : 'draft'}` : 'Notes are saved as drafts until you sign them.'} />
        <section className="panel panel-pad stack" style={{ maxWidth: 820, margin: '0 auto' }}>
          {loadedContext!==contextKey?<p role="status">Loading clinical document…</p>:(DOCUMENT_SECTIONS[documentType]||SECTIONS).map(([key, label]) => (
            <div key={key} className="form-group">
              <label className="form-label" htmlFor={`note-${key}`}>{label}</label>
              <textarea id={`note-${key}`} className="form-input" rows={key === 'chief_complaint' ? 2 : 4} maxLength={5000}
                value={content[key] || ''} disabled={!editable || busy} onChange={(e) => setContent({ ...content, [key]: e.target.value })} />
            </div>
          ))}
          {command.message&&<p role="status">{command.message}</p>}
          {command.uncertain&&<button className="btn btn-secondary" disabled={command.busy} onClick={()=>command.reconcile()}>Reconcile original note request</button>}
          {conflict&&<section aria-label="Clinical document conflict" className="stack">
            <p role="alert">The document changed. Your draft remains here. Compare the server copy before deciding which version to use.</p>
            {!conflict.remote&&<button className="btn btn-secondary" onClick={compare}>Compare server copy</button>}
            {conflict.remote&&<>
              <dl>{(DOCUMENT_SECTIONS[documentType]||SECTIONS).filter(([k])=>String(content[k]||'')!==String(conflict.remote.content[k]||'')).map(([k,label])=><div key={k}><dt>{label}</dt><dd>Server: {conflict.remote.content[k]||'Empty'}<br/>Your draft: {content[k]||'Empty'}</dd></div>)}</dl>
              <button className="btn btn-secondary" onClick={()=>{applyResponse(conflict.remote);setVersions(conflict.remote.signatures||[]);setConflict(null);}}>Use server version</button>
              {conflict.remote.state==='draft'&&<button className="btn btn-primary" onClick={()=>{setVersion(conflict.current);setNote(conflict.remote);setConflict(null);}}>Keep my reviewed draft</button>}
            </>}
          </section>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!noteId && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={create}><FilePen size={16} aria-hidden="true" /> Start note</button>}
            {noteId && editable && <button type="button" className="btn btn-secondary btn-md" disabled={busy} onClick={save}><Save size={16} aria-hidden="true" /> Save draft</button>}
            {noteId && editable && !note?.signed_version && documentType!=='encounter_note' && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={sign}><Lock size={16} aria-hidden="true" /> Sign note</button>}
            {noteId && signedOnce && <button type="button" className="btn btn-ghost btn-md" disabled={busy} onClick={amend}>Amend</button>}
            {noteId && amendReason && <button type="button" className="btn btn-primary btn-md" disabled={busy} onClick={signAmendment}>Sign amendment</button>}
          </div>
          {versions.length > 0 && (
            <div>
              <h2 className="panel-subtitle">Signed versions</h2>
              <ul className="muted">
                {versions.map((v) => (
                  <li key={v.version}>Version {v.version} · {v.meaning} · {v.signed_by_name||'Author unavailable'} · {new Date(v.signed_at).toLocaleString('en-IN')}
                    {v.amends_version ? ` · amends version ${v.amends_version}: ${v.amendment_reason}` : ''} · <span className="mono">{v.digest.slice(0, 12)}…</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
