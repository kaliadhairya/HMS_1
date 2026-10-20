import {useEffect,useState} from 'react';
import api from '../../api/axios';
import {useAuth} from '../../context/AuthContext';
import Navbar from '../../components/Navbar';
import {useGovernedCommand} from '../../hooks/useGovernedCommand';

export default function FacilityPage(){
 const {user,switchFacility}=useAuth(),admin=['admin','super_admin'].includes(user?.role);
 const [facilities,setFacilities]=useState([]),[members,setMembers]=useState([]),[staff,setStaff]=useState([]),[current,setCurrent]=useState(null),[selected,setSelected]=useState(user?.facilityId||''),[error,setError]=useState(''),[switching,setSwitching]=useState(false);
 const [newFacility,setNewFacility]=useState({code:'',name:'',timezone:'Asia/Kolkata',reason:''});
 const [grant,setGrant]=useState({principal_id:'',valid_from:new Date().toISOString().slice(0,16),valid_until:'',reason:''});
 const [revoke,setRevoke]=useState(null),[reason,setReason]=useState('');
 async function refresh(){
  try{const f=await api.get('/auth/facilities');setFacilities(f.data.data);setSelected(user.facilityId);
   if(admin){const[c,m,s]=await Promise.all([api.get('/facilities/current'),api.get('/facilities/memberships'),api.get('/facilities/staff')]);setCurrent(c.data.data);setMembers(m.data.data);setStaff(s.data.data);}
   setError('');
  }catch(e){setError(e.response?.data?.message||'Current facility observations are unavailable.');throw e;}
 }
 useEffect(()=>{refresh().catch(()=>{});},[user?.facilityId]);
 const command=useGovernedCommand(refresh,`${user?.id}:${user?.facilityId}`),disabled=command.busy||command.uncertain||!!error;
 const switchContext=async e=>{e.preventDefault();setSwitching(true);try{await switchFacility(selected);window.location.assign('/');}catch(e){setError(e.response?.data?.message||'The switch was not confirmed. Sign in again before continuing.');}finally{setSwitching(false);}};
 return <><Navbar/><main className="app-page stack"><h1>Current facility</h1>
  {error&&<p role="alert">{error} <button onClick={()=>refresh().catch(()=>{})}>Retry observations</button></p>}
  <form className="panel panel-pad stack" onSubmit={switchContext}><label>Authorized facility<select className="form-input" value={selected} onChange={e=>setSelected(e.target.value)} disabled={switching} required>{facilities.map(f=><option key={f.id} value={f.id}>{f.name} · {f.timezone}</option>)}</select></label>
   <p>Finish or save current work before switching. Open a chart again in the selected facility to continue care. Switching grants no clinical privileges.</p>
   <button className="btn btn-primary" disabled={switching||!selected||selected===user.facilityId}>Switch facility</button>
  </form>
  {command.message&&<p role="status">{command.message}</p>}
  {command.uncertain&&<button disabled={command.busy} onClick={command.reconcile}>Reconcile original change</button>}
  {admin&&<>
   <form className="panel panel-pad stack" onSubmit={async e=>{e.preventDefault();await command.send('/facilities',newFacility);}}><h2>Add a hospital facility</h2><fieldset disabled={disabled} className="stack">
    <label>Facility code<input className="form-input" required value={newFacility.code} onChange={e=>setNewFacility({...newFacility,code:e.target.value})}/></label>
    <label>Facility name<input className="form-input" required value={newFacility.name} onChange={e=>setNewFacility({...newFacility,name:e.target.value})}/></label>
    <label>IANA timezone<input className="form-input" required value={newFacility.timezone} onChange={e=>setNewFacility({...newFacility,timezone:e.target.value})}/></label>
    <label>Creation reason<textarea className="form-input" required minLength={10} value={newFacility.reason} onChange={e=>setNewFacility({...newFacility,reason:e.target.value})}/></label>
    <p>The new facility requires configuration review and explicit staff and clinical approvals before care starts.</p><button className="btn btn-primary">Create facility</button>
   </fieldset></form>
   <section className="panel panel-pad stack"><h2>Facility membership</h2><p>{current?.name} · configuration {current?.configuration_review_required?'requires review':'review recorded'}</p>
    <p>Membership alone grants no clinical action.</p>
    <form className="stack" onSubmit={async e=>{e.preventDefault();await command.send('/facilities/memberships',{...grant,valid_from:new Date(grant.valid_from+'Z').toISOString(),valid_until:grant.valid_until?new Date(grant.valid_until+'Z').toISOString():null});}}><fieldset disabled={disabled} className="stack">
     <label>Staff member<select className="form-input" required value={grant.principal_id} onChange={e=>setGrant({...grant,principal_id:e.target.value})}><option value="">Choose staff</option>{staff.map(s=><option key={s.principal_id} value={s.principal_id}>{s.name} · {s.username} · {s.role}</option>)}</select></label>
     <label>Valid from (UTC)<input className="form-input" type="datetime-local" required value={grant.valid_from} onChange={e=>setGrant({...grant,valid_from:e.target.value})}/></label>
     <label>Valid until (UTC, optional)<input className="form-input" type="datetime-local" value={grant.valid_until} onChange={e=>setGrant({...grant,valid_until:e.target.value})}/></label>
     <label>Membership reason<textarea className="form-input" required minLength={10} value={grant.reason} onChange={e=>setGrant({...grant,reason:e.target.value})}/></label><button className="btn btn-primary">Grant membership</button>
    </fieldset></form>
    <table className="mini-table"><thead><tr><th>Staff</th><th>Validity</th><th>State</th><th>Action</th></tr></thead><tbody>{members.map(m=><tr key={m.id}><td>{m.name}<br/>{m.username} · {m.role}</td><td>{m.valid_from} – {m.valid_until||'No expiry'}</td><td>{m.revoked_at?'Revoked':'Recorded'}</td><td>{!m.revoked_at&&<button disabled={disabled} onClick={()=>{setRevoke(m);setReason('');}}>Review revocation</button>}</td></tr>)}</tbody></table>
    {revoke&&<form className="stack" onSubmit={async e=>{e.preventDefault();if(await command.send(`/facilities/memberships/${revoke.id}/revoke`,{reason},revoke.revision))setRevoke(null);}}><label>Revocation reason<textarea className="form-input" required minLength={10} value={reason} onChange={e=>setReason(e.target.value)}/></label><button disabled={disabled}>Confirm membership revocation</button></form>}
   </section>
  </>}
 </main></>;
}
