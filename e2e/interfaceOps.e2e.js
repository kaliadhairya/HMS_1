const crypto=require('crypto');
const {api,apiLogin,sql,runner,assert,requireThrowawayDb,chromium,browserAs,BASE}=require('./helpers');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Interface operator reconciliation'),tag=crypto.randomUUID(),admin=await apiLogin('admin'),doctor=await apiLogin('doctor');
 const make=async(status,held=false)=>{
  const [m]=await sql(`INSERT INTO hms_interface_messages(direction,system,message_type,contract_version,external_id,payload,status,finished_at,facility_id,delivery_epoch,delivery_cluster_id,delivery_hold)
   SELECT 'out','synthetic:operator','synthetic-review','1',$1,'{"private":"must-not-be-returned"}'::jsonb,$2,CASE WHEN $2='Failed' THEN now() ELSE NULL END,hms_initial_facility(),f.epoch,f.cluster_id,$3 FROM hms_writer_fence f WHERE singleton RETURNING *`,[tag+'-'+crypto.randomUUID(),status,held]);return m;
 };
 let failed=await make('Failed'),held=await make('Pending',true);
 const review={reason:'Synthetic operator checked the provider outcome',evidence_ref:'synthetic-provider-ticket'};
 await step('Only authorized administrators can list or review delivery metadata',async()=>{
  assert((await api('GET','/integrations/messages',{token:doctor})).status===403,'Clinician could read integration administration');
  const list=await api('GET','/integrations/messages?system=synthetic:operator',{token:admin});assert(list.status===200&&list.data.data.some(m=>m.id===held.id),'Held item not visible');assert(list.data.data.every(m=>m.payload===undefined&&m.raw===undefined),'Message content exposed through operational listing');
  assert((await api('POST',`/integrations/messages/${held.id}/review`,{token:doctor,body:{...review,decision:'SUPPRESS'}})).status===403,'Clinician reviewed delivery');
 });
 await step('Reviewed retries retain their external identity and exact command replays create one series',async()=>{
  const path=`/integrations/messages/${failed.id}/retry`,key=crypto.randomUUID();
  assert((await api('POST',path,{token:admin,body:review})).status===428,'Retry accepted without its reviewed version');
  assert((await api('POST',path,{token:admin,body:review,headers:{'if-match':'999'}})).status===412,'Stale delivery review accepted');
  const missing=await api('POST',path,{token:admin,body:{},headers:{'if-match':String(failed.lease_generation)}});assert(missing.status===422,'Retry accepted without evidence');
  const first=await api('POST',path,{token:admin,body:review,headers:{'idempotency-key':key,'if-match':String(failed.lease_generation)}}),again=await api('POST',path,{token:admin,body:review,headers:{'idempotency-key':key,'if-match':String(failed.lease_generation)}});
  assert(first.status===200&&again.status===200&&first.data.data.id===again.data.data.id,'Retry duplicated the attempt series');assert(first.data.data.external_id===failed.external_id&&first.data.data.delivery_key===failed.delivery_key,'Provider identity changed');assert(first.data.data.payload===undefined,'Retry returned protected message content');
 });
 await step('A provider decision closes the held delivery and cannot be applied twice',async()=>{
  const path=`/integrations/messages/${held.id}/review`,body={...review,decision:'CONFIRMED_DELIVERED'};
  const saved=await api('POST',path,{token:admin,body,headers:{'if-match':String(held.lease_generation)}});assert(saved.status===200&&saved.data.data.status==='Delivered','Provider decision was not recorded');assert(saved.data.data.payload===undefined,'Review returned protected message content');
  assert((await api('POST',path,{token:admin,body,headers:{'if-match':String(held.lease_generation)}})).status===409,'A closed delivery was reviewed again');
  const [proof]=await sql('SELECT count(*)::int n FROM hms_interface_delivery_reviews WHERE message_id=$1',[held.id]);assert(proof.n===1,'Review history missing or duplicated');
 });
 await step('Foreign-facility message IDs cannot be retried or reconciled',async()=>{
  const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic foreign interface','UTC') RETURNING id",['IFOPS-'+tag]);
  const [other]=await sql(`INSERT INTO hms_interface_messages(direction,system,message_type,contract_version,external_id,payload,status,facility_id,delivery_epoch,delivery_cluster_id,delivery_hold)
   SELECT 'out','synthetic:foreign','review','1',$1,'{}','Pending',$2,epoch,cluster_id,true FROM hms_writer_fence WHERE singleton RETURNING id`,[tag,f.id]);
  assert((await api('POST',`/integrations/messages/${other.id}/review`,{token:admin,body:{...review,decision:'SUPPRESS'},headers:{'if-match':'0'}})).status===404,'Foreign delivery was reconciled');
 });
 await step('The browser records a provider reference and preserves the delivery history',async()=>{
  const row=await make('Pending',true),browser=await chromium.launch();try{
   const ui=await browserAs(browser,'admin');await ui.page.goto(BASE+'/admin/interface-messages');const tr=ui.page.getByRole('row').filter({hasText:row.external_id});await tr.getByRole('button',{name:'Review delivery'}).click();
   await ui.page.getByLabel('Provider outcome').selectOption('SUPPRESS');await ui.page.getByLabel('Review reason').fill('Synthetic reviewed suppression for browser acceptance');await ui.page.getByLabel('Provider evidence reference').fill('synthetic-browser-provider-ref');await ui.page.getByRole('button',{name:'Record delivery review',exact:true}).click();
   await ui.page.getByRole('form',{name:'Delivery review'}).waitFor({state:'detached'});
   const [saved]=await sql('SELECT status,last_error FROM hms_interface_messages WHERE id=$1',[row.id]);assert(saved.status==='Failed'&&saved.last_error==='RECONCILIATION_SUPPRESSED','Browser did not commit the reviewed suppression');
  }finally{await browser.close();}
 });
 done();process.exit();
})().catch(error=>{console.error(error.message);process.exit(1)});
