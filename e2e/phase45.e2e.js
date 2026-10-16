// Cross-phase integration contracts, not approval of existing prices/content.
// Every clinical value is a synthetic fixture confined to a private database.
const {api,apiLogin,sql,inCare,runner,assert,requireThrowawayDb}=require('./helpers');
const crypto=require('crypto');requireThrowawayDb();assert(/^hms_p4_p5_/.test(process.env.DB_NAME||''),'Use the dedicated combined database');
const {step,done}=runner('Phase 4/5 integration');const tag=crypto.randomUUID().slice(0,8),tokens={};let pid,eid,tests=[],rules=[],order,spec,results=[],report,invoice;
const req=async(method,path,role,body,revision,key)=>api(method,path,{token:tokens[role],body,headers:{...(revision!==undefined?{'if-match':String(revision)}:{}),...(key?{'idempotency-key':key}:{})}});
const ok=(r,n=200)=>{assert(r.status===n,`${r.status}: ${JSON.stringify(r.data).slice(0,350)}`);return r.data.data;};
const item=async id=>(await sql('SELECT * FROM hms_investigation_order_items WHERE id=$1',[id]))[0];
const charges=async ids=>sql("SELECT * FROM hms_charge_events WHERE source_type='lab_order_item' AND source_key=ANY($1)",[ids.map(String)]);
const createOrder=async(ids,key)=>ok(await req('POST','/laboratory/orders','doctor',{patient_id:pid,encounter_id:eid,test_version_ids:ids},undefined,key),201);
async function plan(o){const links=[];for(const i of o.items){const [r]=await sql('SELECT id FROM hms_lab_requirements WHERE test_version_id=$1',[i.lab_test_version_id]);links.push({item_id:i.id,requirement_id:r.id});}return ok(await req('POST','/laboratory/specimens','lab_technician',{patient_id:pid,specimen_type:'TEST-BLOOD',container:'TEST-TUBE',location:'TEST',links}),201);}
async function move(s,state){return ok(await req('POST','/laboratory/specimens/'+s.id+'/transition','lab_technician',{patient_id:pid,accession:s.accession,state,location:'TEST',reason:'Synthetic combined custody'},s.revision));}
async function received(s){return move(await move(s,'COLLECTED'),'RECEIVED');}
async function save(i,s,extra={}){return ok(await req('POST','/laboratory/items/'+i.id+'/results','lab_technician',{specimen_id:s.id,raw_value:'5',unit:'TEST-U',method:'TEST-METHOD',...extra},(await item(i.id)).lab_revision),201).result;}
async function verify(r,i,rule){const qc=ok(await req('POST','/laboratory/qc','lab_technician',{rule_id:rule.id,status:'PASS',evidence:{synthetic_control:'pass'}}),201);ok(await req('POST','/laboratory/results/'+r.id+'/technical-review','lab_technician',{qc_record_id:qc.id,decision:'VERIFIED',reason:'Synthetic combined technical review'},(await item(i.id)).lab_revision));}
(async()=>{
 await step('Prepare a scoped episode with coded laboratory tests and explicit privileges',async()=>{
  for(const role of ['doctor','lab_technician','super_admin','receptionist','admin'])tokens[role]=await apiLogin(role);
  const [{id:uid}]=await sql("SELECT id FROM hms_users WHERE username='doctor'");const [{id:labid}]=await sql("SELECT id FROM hms_users WHERE username='labtech'");
  [{id:pid}]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",['Synthetic combined '+tag,'P45-'+tag]);await inCare(pid);
  [{id:eid}]=await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'Draft') RETURNING id",[pid,uid]);
  for(const [user,p] of [[labid,'CONTENT'],[labid,'TECHNICAL_REVIEW'],[uid,'RELEASE']])ok(await req('POST','/laboratory/privileges','super_admin',{user_id:user,privilege:p,reason:'Synthetic integration fixture',valid_from:new Date(Date.now()-1000).toISOString(),valid_until:new Date(Date.now()+86400000).toISOString()}),201);
  for(let n=0;n<2;n++){
   const base={provenance:'Synthetic combined fixture only',effective_at:new Date(Date.now()-1000).toISOString()};
   const t=ok(await req('POST','/laboratory/catalogue','lab_technician',{...base,code_system:'TEST-P45',code:tag+'-'+n,kind:'TEST',name:'Synthetic combined test '+n+' '+tag,section:'TEST',unit:'TEST-U',method:'TEST-METHOD',requirements:[{specimen_type:'TEST-BLOOD',container:'TEST-TUBE'}]}),201);tests.push(t);
   rules.push(ok(await req('POST','/laboratory/configuration/qc','lab_technician',{...base,test_version_id:t.id,version:1,method:'TEST-METHOD',criteria:{synthetic_control:'fixture'}}),201));
  }
 });
 await step('A replayed coded order creates one order, one episode account and one charge per item',async()=>{
  const key=crypto.randomUUID();order=await createOrder(tests.map(t=>t.id),key);const replay=await createOrder(tests.map(t=>t.id),key);assert(replay.id===order.id,'Order replay duplicated header');
  const captured=await charges(order.items.map(i=>i.id));assert(captured.length===2,'Missing/duplicate lab source charges');const accounts=await sql('SELECT * FROM hms_billing_accounts WHERE encounter_id=$1',[eid]);assert(accounts.length===1&&captured.every(c=>c.account_id===accounts[0].id),'Charges escaped their explicit encounter account');
 });
 await step('Rejection and multi-test recollection retain the original two charge sources',async()=>{
  spec=await received(await plan(order));await move(spec,'REJECTED');spec=await received(await plan(order));
  assert((await charges(order.items.map(i=>i.id))).length===2,'Recollection generated another charge');const tasks=await sql('SELECT * FROM hms_lab_recollections WHERE item_id=ANY($1)',[order.items.map(i=>i.id)]);assert(tasks.length===2&&tasks.every(t=>t.replacement_specimen_id===spec.id),'Recollection lost requirement or identity');
 });
 await step('Concurrent analyte entry and final report release do not bill the specimen or results again',async()=>{
  results=await Promise.all(order.items.map(i=>save(i,spec)));await Promise.all(results.map((r,n)=>verify(r,order.items[n],rules[n])));
  report=ok(await req('POST','/laboratory/orders/'+order.id+'/release','doctor',{status:'FINAL',reason:'Synthetic combined release',result_version_ids:results.map(r=>r.id)},0),201);
  assert((await charges(order.items.map(i=>i.id))).length===2,'Technical review/report release duplicated charges');
 });
 await step('Cancelling an unprocessed order reverses each source once despite both cancellation triggers and replay',async()=>{
  const cancelled=await createOrder(tests.map(t=>t.id)),key=crypto.randomUUID(),body={};
  ok(await req('POST','/laboratory/orders/'+cancelled.id+'/cancel','doctor',body,0,key));ok(await req('POST','/laboratory/orders/'+cancelled.id+'/cancel','doctor',body,0,key));
  const originals=await charges(cancelled.items.map(i=>i.id));const reversals=await sql('SELECT * FROM hms_charge_events WHERE reverses_id=ANY($1)',[originals.map(c=>c.id)]);assert(originals.length===2&&reversals.length===2,'Item/header/retry cancellation double-reversed or lost charges');
  for(const c of originals)assert(reversals.filter(r=>r.reverses_id===c.id&&Number(r.amount)===-Number(c.amount)).length===1,'Reversal changed source amount');
 });
 await step('One issued episode invoice includes consultation and active lab charges, omits cancelled tests and posts a balanced journal',async()=>{
  // Signing needs saved note content and the reviewed revision (A5/A6 rules).
const [{record_revision:r0}]=await sql('SELECT record_revision FROM hms_encounters WHERE id=$1',[eid]);
const noted=await req('PUT','/hms/encounters/'+eid,'doctor',{chief_complaint:'Synthetic integration visit'},Number(r0));assert(noted.status===200,'Note before signing: '+noted.status);
const f=await req('PATCH','/hms/encounters/'+eid+'/finalize','doctor',{},Number(noted.data.revision??noted.data.data?.revision??Number(r0)+1));assert(f.status===200,'Finalization failed '+f.status+' '+JSON.stringify(f.data).slice(0,200));
  const r=await req('POST','/billing/opd','receptionist',{encounterId:eid});assert(r.status===200,'Invoice projection failed');
  [invoice]=await sql('SELECT i.* FROM hms_invoices i JOIN hms_billing_accounts a ON a.id=i.account_id WHERE a.encounter_id=$1 AND i.status<>\'Draft\'',[eid]);
  const lines=await sql('SELECT * FROM hms_invoice_lines WHERE invoice_id=$1',[invoice.id]);assert(lines.filter(l=>l.category==='Lab').length===2&&lines.filter(l=>l.category==='Consultation').length===1,'Invoice lost clinical sources or billed cancelled tests');
  const mismatch=await sql('SELECT entry_id FROM hms_journal_lines GROUP BY entry_id HAVING sum(debit)<>sum(credit)');assert(!mismatch.length,'Journal unbalanced');
 });
 await step('Amending a released result keeps the issued invoice and charge sources unchanged',async()=>{
  const before=JSON.stringify(invoice);const corrected=await save(order.items[0],spec,{raw_value:'6',correction_of_id:results[0].id,correction_reason:'Synthetic correction after invoicing'});await verify(corrected,order.items[0],rules[0]);
  const next=ok(await req('POST','/laboratory/orders/'+order.id+'/release','doctor',{status:'AMENDED',reason:'Synthetic amendment after invoice',result_version_ids:[corrected.id,results[1].id]},1),201);
  const [stored]=await sql('SELECT * FROM hms_invoices WHERE id=$1',[invoice.id]);assert(JSON.stringify(stored)===before,'Clinical amendment rewrote invoice');assert((await charges(order.items.map(i=>i.id))).length===2,'Correction billed test again');assert(next.version.previous_version_id===report.version.id,'Original report lineage lost');
 });
 await step('Financial credit and payment replay do not alter clinical versions or duplicate journal receipts',async()=>{
  const [line]=await sql('SELECT * FROM hms_invoice_lines WHERE invoice_id=$1 AND category=\'Lab\' LIMIT 1',[invoice.id]);
  ok(await req('POST','/finance/invoices/'+invoice.id+'/notes','admin',{kind:'credit',reason:'Synthetic financial adjustment',lines:[{invoiceLineId:line.id,amount:Number(line.amount)/2}]}),201);
  const key=crypto.randomUUID(),body={invoiceId:invoice.id,amount:1,method:'Cash'};const first=ok(await req('POST','/finance/payments','receptionist',body,undefined,key),201),again=ok(await req('POST','/finance/payments','receptionist',body,undefined,key),201);assert(first.receipt.id===again.receipt.id,'Payment replay duplicated receipt');
  const original=ok(await req('GET','/laboratory/reports/'+report.version.id,'doctor'));assert(original.results.length===2&&original.results.some(r=>r.id===results[0].id&&r.raw_value==='5'),'Financial change rewrote clinical evidence');
  assert(!(await sql('SELECT entry_id FROM hms_journal_lines GROUP BY entry_id HAVING sum(debit)<>sum(credit)')).length,'Financial/clinical integration broke journal balance');
 });
 done();
})();
