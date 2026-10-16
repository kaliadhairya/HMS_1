import {useState} from 'react';
import toast from 'react-hot-toast';
import api from '../../../api/axios';
import Navbar from '../../../components/Navbar';
import PageHeader from '../../../components/ui/PageHeader';
import Freshness from '../../../components/ui/Freshness';
import {useLiveQuery} from '../../../data/liveQuery';

export default function InterfaceMessagesPage(){
 const [status,setStatus]=useState('Pending'),[selected,setSelected]=useState(null),[decision,setDecision]=useState('SUPPRESS'),[reason,setReason]=useState(''),[evidence,setEvidence]=useState(''),[busy,setBusy]=useState(false);
 const query=useLiveQuery('/integrations/messages',{params:{status:status||undefined,direction:'out'},select:b=>b?.data||[],refreshMs:15000});
 const choose=m=>{setSelected(m);setDecision('SUPPRESS');setReason('');setEvidence('');};
 const submit=async e=>{e.preventDefault();if(busy||!selected)return;setBusy(true);try{
  const endpoint=`/integrations/messages/${selected.id}/${selected.delivery_hold?'review':'retry'}`;
  await api.post(endpoint,{...(selected.delivery_hold?{decision}:{}),reason,evidence_ref:evidence},{headers:{'If-Match':String(selected.lease_generation)}});
  toast.success('Delivery review recorded');setSelected(null);await query.refresh();
 }catch(error){toast.error(error.response?.data?.message||'The review was not confirmed. Keep the provider evidence and refresh before another attempt.');}finally{setBusy(false);}};
 return <><Navbar/><main className="app-page"><PageHeader title="Interface deliveries" description="Review failed or uncertain external delivery with the receiving service before authorizing another attempt."/>
  <section className="panel panel-pad stack-sm"><label>Delivery state <select aria-label="Delivery state" value={status} onChange={e=>setStatus(e.target.value)}><option value="Pending">Pending and held</option><option value="Failed">Failed</option><option value="Delivered">Delivered</option></select></label><Freshness query={query} label="interface deliveries"/>
   <div className="dt-scroll"><table className="dt-table"><thead><tr><th>System / contract</th><th>External reference</th><th>State</th><th>Attempts</th><th>Action</th></tr></thead><tbody>
    {(query.data||[]).map(m=><tr key={m.id}><td>{m.system}<div>{m.message_type} · {m.contract_version}</div></td><td>{m.external_id}</td><td>{m.delivery_hold?'Held for provider reconciliation':m.status}<div>{m.last_error}</div></td><td>{m.attempts}/{m.max_attempts} · series {m.attempt_series}</td><td>{(m.delivery_hold||m.status==='Failed')&&<button type="button" className="btn btn-secondary" onClick={()=>choose(m)}>Review delivery</button>}</td></tr>)}
    {!query.loading&&!query.data?.length&&<tr><td colSpan={5}>{query.error?'The list is unavailable.':'No deliveries in this state.'}</td></tr>}
   </tbody></table></div>
   <p className="cell-secondary">Latest 200 matching messages. Keep the external reference unchanged when confirming the receiving service’s outcome.</p>
  </section>
  {selected&&<form onSubmit={submit} className="panel panel-pad stack-sm" aria-label="Delivery review"><h2>Review {selected.external_id}</h2>
   {selected.delivery_hold&&<label>Provider outcome <select aria-label="Provider outcome" value={decision} onChange={e=>setDecision(e.target.value)}><option value="SUPPRESS">Suppress further delivery</option><option value="CONFIRMED_DELIVERED">Provider confirms it was delivered</option><option value="CONFIRMED_NOT_DELIVERED">Provider confirms no delivery; permit one new attempt</option></select></label>}
   <label>Review reason <textarea aria-label="Review reason" required minLength={10} maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)}/></label>
   <label>Provider evidence reference <input aria-label="Provider evidence reference" required minLength={5} maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
   <div className="inline-actions"><button className="btn btn-primary" disabled={busy} type="submit">Record delivery review</button><button className="btn btn-secondary" disabled={busy} type="button" onClick={()=>setSelected(null)}>Cancel</button></div>
  </form>}
 </main></>;
}
