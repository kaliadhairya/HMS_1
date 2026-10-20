// Consultation save/sign races and actual lost-response recovery on private data.
const crypto=require('crypto');
const {API,BASE,api,apiLogin,sql,inCare,runner,assert,requireThrowawayDb,chromium,browserAs}=require('./helpers');
requireThrowawayDb();
const {clinicalFixture}=require('./clinicalFixtures');
const tag=crypto.randomUUID().slice(0,8);
(async()=>{
 const {step,done}=runner('Versioned consultation notes');
 const doctor=await apiLogin('doctor'),admin=await apiLogin('admin');await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);let pid,eid,document,original;
 const call=(method,url,body,revision,key,token=doctor)=>api(method,url,{token,body,headers:{...(revision===undefined?{}:{'if-match':String(revision)}),...(key?{'idempotency-key':key}:{})}});
 const view=()=>call('GET','/hms/encounters/'+eid);
 await step('Prepare a synthetic encounter and prove missing revisions and wrong authors cannot mutate it',async()=>{
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [p]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',40,'Female','OPD',hms_service_today()) RETURNING id",['Synthetic note '+tag,'NOTE-'+tag]);pid=p.id;await inCare(pid);
  const [e]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",[pid,u.id]);eid=e.id;
  assert((await call('PUT','/hms/encounters/'+eid,{chief_complaint:'Synthetic draft'})).status===428,'Missing revision accepted');
  assert((await call('PUT','/hms/encounters/'+eid,{chief_complaint:'Admin change'},1,undefined,admin)).status===403,'Admin authored clinical note');
  assert((await view()).data.record_revision===1,'Refusal changed record');
 });
 await step('Two simultaneous note saves from one revision accept exactly one and create one linked document',async()=>{
  const r=await Promise.all(['A','B'].map(v=>call('PUT','/hms/encounters/'+eid,{chief_complaint:'Synthetic '+v,hopi:'Synthetic reviewed history'},1)));
  assert(r.map(x=>x.status).sort().join(',')==='200,412','Save race '+r.map(x=>x.status));
  const e=(await view()).data;document=e.notes_document_id;assert(e.record_revision===2&&document,'Missing revision/document');
  const [n]=await sql("SELECT count(*)::int AS n FROM hms_clinical_documents WHERE encounter_id=$1 AND doc_type='encounter_note'",[eid]);assert(n.n===1,'Duplicate consultation note');
  assert((await call('POST',`/clinical-documents/${document}/sign`,undefined,2)).status===409,'Direct signing bypassed encounter finalization');
 });
 await step('Autosave/sign race retains one exact reviewed version; a stale writer cannot overwrite a signature',async()=>{
  const r=await Promise.all([call('PUT','/hms/encounters/'+eid,{hopi:'Synthetic concurrent history'},2),call('PATCH',`/hms/encounters/${eid}/finalize`,{},2)]);
  assert(r.filter(x=>x.status===200).length===1,'Both autosave and sign committed');
  const e=(await view()).data;
  if(e.status!=='Finalized')assert((await call('PATCH',`/hms/encounters/${eid}/finalize`,{},e.record_revision)).status===200,'Finalize current revision failed');
  [original]=await sql('SELECT content,digest FROM hms_document_signatures WHERE document_id=$1',[document]);assert(original,'Missing signature');
  let refused=false;try{await sql("UPDATE hms_encounters SET hopi='Unauthorized overwrite' WHERE id=$1",[eid]);}catch(e){refused=/immutable/.test(e.message);}assert(refused,'Database accepted finalized clinical overwrite');
  assert((await call('PUT','/hms/encounters/'+eid,{hopi:'Stale copy'},2)).status===409,'Finalized record modified');
 });
 await step('Finalizing response replay commits one signature and one outbox event',async()=>{
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [e]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status,chief_complaint) VALUES($1,$2,'Draft','Synthetic signed review') RETURNING id",[pid,u.id]);
  const key=crypto.randomUUID();const url=`/hms/encounters/${e.id}/finalize`;
  const first=await call('PATCH',url,{},1,key),again=await call('PATCH',url,{},1,key);
  assert(first.status===200&&again.status===200&&first.data.digest===again.data.digest,'Signature replay failed');
  const [s]=await sql('SELECT count(*)::int AS n FROM hms_document_signatures WHERE document_id=$1',[first.data.notes_document_id]);assert(s.n===1,'Duplicate signature');
  const [out]=await sql("SELECT count(*)::int AS n FROM hms_outbox WHERE event_type='clinical.note.signed' AND payload->>'encounter_id'=$1",[String(e.id)]);assert(out.n===1,'Duplicate/missing signing event');
 });
 await step('A linked consultation amendment preserves the original and chart reads display the signed amendment',async()=>{
  const reason='Synthetic linked correction after clinical review';const get=await call('GET',`/clinical-documents/${document}`);const revision=get.data.data.version;
  const a=await call('POST',`/clinical-documents/${document}/amend`,{reason},revision);assert(a.status===200,'Begin linked amendment '+a.status);
  const save=await call('PUT',`/clinical-documents/${document}/draft`,{content:{chief_complaint:'Synthetic amended complaint',hopi:'Synthetic amended history'}},a.data.data.version);assert(save.status===200,'Save amendment '+save.status);
  assert((await call('POST',`/clinical-documents/${document}/sign-amendment`,{reason},save.data.data.version)).status===200,'Sign amendment');
  const history=await sql('SELECT version,content,digest,amends_version FROM hms_document_signatures WHERE document_id=$1 ORDER BY version',[document]);
  assert(history.length===2&&history[0].digest===original.digest&&history[1].amends_version===1,'Original signature replaced');
  const e=(await view()).data;assert(e.hopi==='Synthetic amended history'&&e.signed_note_version===2,'Chart did not resolve signed amendment');
 });
 await step('A committed note save whose response is lost reconciles once and preserves the browser draft',async()=>{
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [e]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id,public_id",[pid,u.id]);
  const browser=await chromium.launch();let ui;
  try{
   ui=await browserAs(browser,'doctor');await ui.page.goto(`${BASE}/hms/consultation/${e.id}`,{waitUntil:'domcontentloaded'});
   await ui.page.getByLabel('Chief complaint',{exact:true}).fill('Synthetic uncertain note retained');
   let receive=false;
   await ui.page.route(`**/api/v2/encounters/${e.public_id}/draft`,async route=>{
    if(route.request().method()==='PUT'&&!receive){const r=await route.fetch();assert(r.status()===200,'Save did not commit');await route.abort('failed');}else await route.continue();
   });
   await ui.page.getByRole('button',{name:'Save draft',exact:true}).click();
   await ui.page.getByRole('button',{name:'Reconcile original note request',exact:true}).waitFor();
   const [before]=await sql('SELECT record_revision FROM hms_encounters WHERE id=$1',[e.id]);assert(before.record_revision===2,'Lost response caused extra saves');
   receive=true;await ui.page.getByRole('button',{name:'Reconcile original note request',exact:true}).click();
   await ui.page.getByText('Notes saved and confirmed.',{exact:true}).waitFor();
   const [after]=await sql('SELECT record_revision FROM hms_encounters WHERE id=$1',[e.id]);assert(after.record_revision===2,'Reconciliation executed another save');
   assert(await ui.page.getByLabel('Chief complaint',{exact:true}).inputValue()==='Synthetic uncertain note retained','Draft lost');
  }finally{if(ui)await ui.ctx.close();await browser.close();}
 });
 await step('Quick Consult saves against its loaded revision and signs before closing the patient',async()=>{
  const browser=await chromium.launch();let ui;
  try{
   ui=await browserAs(browser,'doctor');await ui.page.goto(BASE+'/doctor/quick-consult',{waitUntil:'domcontentloaded'});
   const [existing]=await sql("SELECT id,record_revision FROM hms_encounters WHERE patient_id=$1 AND status='Draft' ORDER BY id DESC LIMIT 1",[pid]);assert(existing,'Expected the previously saved open draft');
   await ui.page.getByPlaceholder('Search patient name, ID or UHID').fill('NOTE-'+tag);
   const loaded=ui.page.waitForResponse(r=>r.url().includes('/api/medication/orders?encounter_id=')&&r.status()===200);
   await ui.page.locator('button.list-row').filter({hasText:'Synthetic note '+tag}).click();await loaded;
   await ui.page.getByLabel('Chief complaint',{exact:true}).fill('Synthetic quick consultation reviewed');
   await ui.page.getByRole('button',{name:'Finalize and close',exact:true}).click();
   await ui.page.getByPlaceholder('Search patient name, ID or UHID').waitFor();
   const [r]=await sql("SELECT e.id,e.status,e.record_revision,count(s.id)::int AS signatures FROM hms_encounters e LEFT JOIN hms_document_signatures s ON s.document_id=e.notes_document_id WHERE e.patient_id=$1 AND e.chief_complaint='Synthetic quick consultation reviewed' GROUP BY e.id",[pid]);
   assert(r&&r.id===existing.id&&r.status==='Finalized'&&r.record_revision===existing.record_revision+2&&r.signatures===1,'Quick Consult did not resume/save/sign the exact existing draft once');
   assert(ui.errors.length===0,'Quick Consult errors '+ui.errors.join('; '));
  }finally{if(ui)await ui.ctx.close();await browser.close();}
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
