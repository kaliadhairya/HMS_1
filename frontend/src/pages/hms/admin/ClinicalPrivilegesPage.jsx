import {useEffect,useState} from 'react';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import {useGovernedCommand} from '../../../hooks/useGovernedCommand';
const ACTIONS={doctor:['CHART_READ','PRESCRIBE','CLINICAL_SIGN','LAB_PROCESS','LAB_RELEASE'],nurse:['CHART_READ','NURSING_DOCUMENT'],pharmacist:['CHART_READ','DISPENSE'],lab_technician:['CHART_READ','LAB_PROCESS']};
const utc=v=>new Date(v).toISOString();
const times=()=>({validFrom:new Date().toISOString().slice(0,16),validUntil:new Date(Date.now()+30*86400000).toISOString().slice(0,16)});
export default function ClinicalPrivilegesPage(){
 const [facility,setFacility]=useState(null),[people,setPeople]=useState([]),[grants,setGrants]=useState([]),[loadError,setLoadError]=useState('');
 const [role,setRole]=useState(()=>({practitionerId:'',role:'doctor',...times(),reason:''}));
 const [privilege,setPrivilege]=useState({roleId:'',action:'CHART_READ',validFrom:'',validUntil:'',reason:''});
 const [revocation,setRevocation]=useState(null);
 async function refresh(){
  try{const [f,p,g]=await Promise.all([api.get('/facilities/current'),api.get('/practitioners'),api.get('/facilities/clinical-grants')]);setFacility(f.data.data);setPeople(p.data.data);setGrants(g.data.data);setLoadError('');}
  catch(error){setLoadError(error.response?.data?.message||'Current facility/grant observations are unavailable. Existing observations may be stale.');throw error;}
 }
 useEffect(()=>{refresh().catch(()=>{});},[]);
 const command=useGovernedCommand(refresh),disabled=command.busy||command.uncertain||Boolean(loadError);
 const selected=grants.find(g=>g.id===privilege.roleId);
 const confirmed=result=>{if(!result)return;if(result.path.endsWith('/professional-roles'))setRole({...role,reason:''});if(result.path.endsWith('/privileges'))setPrivilege({...privilege,reason:''});if(result.path.endsWith('/revoke'))setRevocation(null);};
 const sendRole=e=>{e.preventDefault();command.send('/facilities/professional-roles',{...role,validFrom:utc(role.validFrom+'Z'),validUntil:utc(role.validUntil+'Z')}).then(confirmed);};
 const sendPrivilege=e=>{e.preventDefault();if(!selected)return;command.send(`/facilities/professional-roles/${selected.id}/privileges`,{...privilege,validFrom:utc(privilege.validFrom+'Z'),validUntil:utc(privilege.validUntil+'Z')},selected.revision).then(confirmed);};
 const chooseRole=id=>{const r=grants.find(g=>g.id===id);setPrivilege({...privilege,roleId:id,action:'CHART_READ',validFrom:r?new Date(Math.ceil(Date.parse(r.valid_from)/60000)*60000).toISOString().slice(0,16):'',validUntil:r?.valid_until?.slice(0,16)||''});};
 return <><Navbar/><main className="app-page stack">
  <PageHeader title="Clinical privileges" description="Approve professional roles and clinical actions separately for the current facility. Current independent credential verification is required at each clinical command."/>
  <p>{facility?`Facility: ${facility.name} · ${facility.timezone}`:'Loading verified facility…'}</p>
  {loadError&&<div role="alert">{loadError} <button className="btn btn-secondary" onClick={()=>refresh().catch(()=>{})}>Retry observations</button></div>}
  {command.message&&<p role="status">{command.message}</p>}
  {command.uncertain&&<button className="btn btn-secondary" disabled={command.busy} onClick={()=>command.reconcile().then(confirmed)}>Reconcile original request</button>}
  <div className="split-2">
   <form className="panel panel-pad stack" onSubmit={sendRole}><h2>Approve a professional role</h2><fieldset disabled={disabled} className="stack">
    <label htmlFor="grant-practitioner">Practitioner</label><select id="grant-practitioner" className="form-input" required value={role.practitionerId} onChange={e=>setRole({...role,practitionerId:e.target.value})}><option value="">Choose an explicit practitioner</option>{people.map(p=><option key={p.public_id} value={p.public_id}>{p.display_name} · {p.username}</option>)}</select>
    <label>Professional role<select className="form-input" value={role.role} onChange={e=>setRole({...role,role:e.target.value})}>{Object.keys(ACTIONS).map(r=><option key={r} value={r}>{r.replaceAll('_',' ')}</option>)}</select></label>
    <label>Valid from (UTC)<input className="form-input" type="datetime-local" required value={role.validFrom} onChange={e=>setRole({...role,validFrom:e.target.value})}/></label>
    <label>Valid until (UTC)<input className="form-input" type="datetime-local" required value={role.validUntil} onChange={e=>setRole({...role,validUntil:e.target.value})}/></label>
    <label>Approval reason<textarea className="form-input" required minLength={10} maxLength={1000} value={role.reason} onChange={e=>setRole({...role,reason:e.target.value})}/></label>
    <p>The approver must differ from the practitioner. This role alone grants no clinical action.</p><button className="btn btn-primary">Approve professional role</button>
   </fieldset></form>
   <form className="panel panel-pad stack" onSubmit={sendPrivilege}><h2>Approve a clinical action</h2><fieldset disabled={disabled} className="stack">
    <label>Reviewed professional role<select className="form-input" required value={privilege.roleId} onChange={e=>chooseRole(e.target.value)}><option value="">Choose a role</option>{grants.filter(g=>!g.revoked_at).map(g=><option key={g.id} value={g.id}>{g.display_name} · {g.role} · revision {g.revision}</option>)}</select></label>
    <label>Action<select className="form-input" value={privilege.action} onChange={e=>setPrivilege({...privilege,action:e.target.value})}>{(ACTIONS[selected?.role]||['CHART_READ']).map(action=><option key={action} value={action}>{action.replaceAll('_',' ')}</option>)}</select></label>
    <label>Valid from (UTC)<input className="form-input" type="datetime-local" required value={privilege.validFrom} onChange={e=>setPrivilege({...privilege,validFrom:e.target.value})}/></label>
    <label>Valid until (UTC)<input className="form-input" type="datetime-local" required value={privilege.validUntil} onChange={e=>setPrivilege({...privilege,validUntil:e.target.value})}/></label>
    <label>Approval reason<textarea className="form-input" required minLength={10} maxLength={1000} value={privilege.reason} onChange={e=>setPrivilege({...privilege,reason:e.target.value})}/></label>
    <button className="btn btn-primary" disabled={!selected}>Approve clinical action</button>
   </fieldset></form>
  </div>
  <section className="panel panel-pad"><h2>Recorded grants</h2>{!loadError&&grants.length===0&&<p>No professional roles are approved for this facility.</p>}
   {grants.map(g=><article key={g.id} className="stack"><h3>{g.display_name}: {g.role}</h3><p>{g.revoked_at?'Revoked':'Recorded'} · {g.valid_from} – {g.valid_until} · revision {g.revision}</p>
    {!g.revoked_at&&<button className="btn btn-secondary" disabled={disabled} onClick={()=>setRevocation({kind:'professional-roles',id:g.id,revision:g.revision,reason:''})}>Review role revocation</button>}
    <ul>{g.privileges.map(x=><li key={x.id}>{x.action} · {x.revokedAt?'revoked':'recorded'} · {x.validFrom} – {x.validUntil}{!x.revokedAt&&<button className="btn btn-secondary" disabled={disabled} onClick={()=>setRevocation({kind:'clinical-privileges',id:x.id,revision:x.revision,reason:''})}>Review privilege revocation</button>}</li>)}</ul>
   </article>)}
  </section>
  {revocation&&<form className="panel panel-pad stack" onSubmit={async e=>{e.preventDefault();const r=await command.send(`/facilities/${revocation.kind}/${revocation.id}/revoke`,{reason:revocation.reason},revocation.revision);if(r)setRevocation(null);}}>
   <h2>Revoke the selected grant</h2><label>Revocation reason<textarea className="form-input" required minLength={10} maxLength={1000} disabled={disabled} value={revocation.reason} onChange={e=>setRevocation({...revocation,reason:e.target.value})}/></label><button className="btn btn-primary" disabled={disabled}>Confirm revocation</button>
  </form>}
 </main></>;
}
