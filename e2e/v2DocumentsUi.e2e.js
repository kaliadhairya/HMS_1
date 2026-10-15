const crypto=require('node:crypto');
const {api,apiLogin,sql,runner,assert,inCare,requireThrowawayDb,chromium,browserAs,BASE}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');requireThrowawayDb();
(async()=>{
 const {step,done}=runner('V2 clinical note browser recovery'),tag=crypto.randomUUID().slice(0,8),doctor=await apiLogin('doctor');
 await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);
 const [p]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic browser note patient',$1,'other',30,'Female','OPD',CURRENT_DATE) RETURNING id,public_id",['V2UI-'+tag]);await inCare(p.id);
 const created=await api('POST','/v2/clinical-documents',{token:doctor,body:{patient_id:p.public_id,content:{history:'Synthetic initial browser note'}}});assert(created.status===201,'Prepare note '+created.status);
 const id=created.data.data.id,browser=await chromium.launch();let ui;
 try{
  ui=await browserAs(browser,'doctor');await ui.page.goto(BASE+'/hms/notes/'+id,{waitUntil:'domcontentloaded'});
  await ui.page.getByLabel('History',{exact:true}).waitFor();
  await step('A committed draft with lost responses replays its original key without another revision',async()=>{
   await ui.page.getByLabel('History',{exact:true}).fill('Synthetic uncertain clinical note');let receive=false;
   await ui.page.route(`**/api/v2/clinical-documents/${id}/draft`,async route=>{
    if(route.request().method()==='PUT'&&!receive){const res=await route.fetch();assert(res.status()===200,'Original draft did not commit');await route.abort('failed');}else await route.continue();
   });
   await ui.page.getByRole('button',{name:'Save draft',exact:true}).click();
   await ui.page.getByRole('button',{name:'Reconcile original note request',exact:true}).waitFor();
   const [before]=await sql('SELECT api_version,draft_version,draft_content FROM hms_clinical_documents WHERE public_id=$1',[id]);assert(before.api_version===2&&before.draft_version===2,'Uncertain save duplicated');assert(before.draft_content.history==='Synthetic uncertain clinical note','Original draft content was not committed');
   receive=true;await ui.page.getByRole('button',{name:'Reconcile original note request',exact:true}).click();await ui.page.getByText('Change confirmed.',{exact:true}).waitFor();
   const [after]=await sql('SELECT api_version,draft_version,draft_content FROM hms_clinical_documents WHERE public_id=$1',[id]);assert(after.api_version===2&&after.draft_version===2,'Replayed save executed again');
   await ui.page.waitForFunction(()=>document.getElementById('note-history')?.value==='Synthetic uncertain clinical note');assert(await ui.page.getByLabel('History',{exact:true}).inputValue()==='Synthetic uncertain clinical note','Browser draft lost');
  });
  await step('A stale draft requires explicit comparison; its version never rebases silently',async()=>{
   const server=await api('PUT','/v2/clinical-documents/'+id+'/draft',{token:doctor,body:{content:{history:'Synthetic concurrent server note'}},headers:{'if-match':'2'}});assert(server.status===200,'Prepare concurrent draft');
   await ui.page.getByLabel('History',{exact:true}).fill('Synthetic preserved local revision');
   await ui.page.getByRole('button',{name:'Save draft',exact:true}).click();await ui.page.getByRole('region',{name:'Clinical document conflict'}).waitFor();
   assert(await ui.page.getByRole('button',{name:'Save draft',exact:true}).isDisabled(),'Stale draft can overwrite without review');
   assert(await ui.page.getByLabel('History',{exact:true}).inputValue()==='Synthetic preserved local revision','Stale response replaced draft');
   await ui.page.getByRole('button',{name:'Compare server copy',exact:true}).click();await ui.page.getByText(/Server: Synthetic concurrent server note/).waitFor();
   await ui.page.getByRole('button',{name:'Keep my reviewed draft',exact:true}).click();await ui.page.getByRole('button',{name:'Save draft',exact:true}).click();await ui.page.getByText('Change confirmed.',{exact:true}).waitFor();
   const [row]=await sql('SELECT api_version,draft_content FROM hms_clinical_documents WHERE public_id=$1',[id]);assert(row.api_version===4&&row.draft_content.history==='Synthetic preserved local revision','Reviewed draft did not use exact new revision');
  });
  await step('Signing from the browser freezes one exact document and keeps a readable author',async()=>{
   ui.page.once('dialog',dialog=>dialog.accept());await ui.page.getByRole('button',{name:'Sign note',exact:true}).click();await ui.page.getByRole('button',{name:'Amend',exact:true}).waitFor();
   const [row]=await sql('SELECT d.state,count(s.id)::int n FROM hms_clinical_documents d JOIN hms_document_signatures s ON s.document_id=d.id WHERE d.public_id=$1 GROUP BY d.id',[id]);assert(row.state==='signed'&&row.n===1,'Browser signature not exact once');
   await ui.page.getByRole('heading',{name:'Signed versions'}).waitFor();assert(ui.errors.length===0,'Browser errors '+ui.errors.join('; '));
  });
  await step('A delayed read from the previous record cannot replace an edited destination note',async()=>{
   const other=await api('POST','/v2/clinical-documents',{token:doctor,body:{patient_id:p.public_id,content:{history:'Synthetic destination record'}}});assert(other.status===201,'Prepare second note');
   const destination=other.data.data.id;
   const navigate=target=>ui.page.evaluate(path=>{window.history.pushState(window.history.state,'',path);window.dispatchEvent(new PopStateEvent('popstate',{state:window.history.state}));},'/hms/notes/'+target);
   await navigate(destination);await ui.page.waitForFunction(()=>document.getElementById('note-history')?.value==='Synthetic destination record');
   let release,started,finished;
   const held=new Promise(resolve=>{release=resolve}),seen=new Promise(resolve=>{started=resolve}),complete=new Promise(resolve=>{finished=resolve});
   await ui.page.route(`**/api/v2/clinical-documents/${id}`,async route=>{const response=await route.fetch();started();await held;try{await route.fulfill({response});}finally{finished();}});
   await navigate(id);await seen;await navigate(destination);
   await ui.page.waitForFunction(()=>document.getElementById('note-history')?.value==='Synthetic destination record');
   await ui.page.getByLabel('History',{exact:true}).fill('Synthetic destination draft must remain');
   release();await complete;await ui.page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert(await ui.page.getByLabel('History',{exact:true}).inputValue()==='Synthetic destination draft must remain','Delayed old record overwrote the destination draft');
   assert(await ui.page.getByRole('button',{name:'Save draft',exact:true}).isEnabled(),'Destination context was replaced by signed predecessor');
  });
 }finally{if(ui)await ui.ctx.close();await browser.close();}
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
