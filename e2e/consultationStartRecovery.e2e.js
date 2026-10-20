// Real browser/HTTP commit-before-response tests; disposable database only.
const crypto=require('node:crypto');
const {apiLogin,sql,inCare,runner,assert,requireThrowawayDb,chromium,browserAs,BASE}=require('./helpers');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Consultation selection and recovery'),browser=await chromium.launch(),tag=crypto.randomUUID().slice(0,7);
 await apiLogin('doctor');await require('./clinicalFixtures').clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);
 const [doctor]=await sql("SELECT id,department_id FROM hms_users WHERE username='doctor'");
 const patient=async suffix=>{const [p]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Unknown','OPD',hms_service_today()) RETURNING id,name,uhid",['Synthetic recovery '+suffix+' '+tag,'R-'+suffix+'-'+tag]);await inCare(p.id);return p;};
 const encounter=async(p,complaint='')=>(await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status,chief_complaint) VALUES($1,$2,'Draft',$3) RETURNING id,public_id",[p.id,doctor.id,complaint]))[0];
 const pick=async(ui,p)=>{await ui.page.goto(BASE+'/doctor/quick-consult');await ui.page.getByPlaceholder('Search patient name, ID or UHID').fill(p.uhid);await ui.page.getByRole('button').filter({hasText:p.name}).click();};
 const ready=ui=>ui.page.locator('#qc-chief-complaint:enabled').waitFor();
 try{
  await step('Reopening and reloading one exact draft preserves its identity and offers unsaved text',async()=>{
   const p=await patient('one'),e=await encounter(p,'Original saved text'),ui=await browserAs(browser,'doctor');try{
    await pick(ui,p);await ready(ui);assert(await ui.page.getByLabel('Chief complaint',{exact:true}).inputValue()==='Original saved text','Existing draft was not loaded');
    await ui.page.getByLabel('Chief complaint',{exact:true}).fill('Synthetic unsaved text survives exact resumption');await ui.page.waitForTimeout(600);await ui.page.reload();
    const recovery=ui.page.getByRole('alert',{name:'Unsaved notes recovered'});await recovery.getByRole('button',{name:'Restore them'}).click();await ready(ui);
    assert(await ui.page.getByLabel('Chief complaint',{exact:true}).inputValue()==='Synthetic unsaved text survives exact resumption','Recovered text lost');
    const [count]=await sql('SELECT count(*)::int n,min(id)::int id FROM hms_encounters WHERE patient_id=$1',[p.id]);assert(count.n===1&&count.id===e.id,'Reopening created another consultation');
    assert(ui.errors.length===0,ui.errors.join('; '));
   }finally{await ui.ctx.close();}
  });
  await step('Several open drafts require explicit selection and never create a guessed consultation',async()=>{
   const p=await patient('many');await encounter(p,'First exact draft');const selected=await encounter(p,'Second exact draft'),ui=await browserAs(browser,'doctor');try{
    await pick(ui,p);const modal=ui.page.getByRole('dialog',{name:'Select open consultation'});await modal.getByLabel('Open consultation').selectOption(String(selected.id));await modal.getByRole('button',{name:'Open selected consultation'}).click();await ready(ui);
    assert(await ui.page.getByLabel('Chief complaint',{exact:true}).inputValue()==='Second exact draft','Wrong draft was opened');const [count]=await sql('SELECT count(*)::int n FROM hms_encounters WHERE patient_id=$1',[p.id]);assert(count.n===2,'Draft selection created another record');
   }finally{await ui.ctx.close();}
  });
  await step('A Quick Consult start committed before response loss reconciles after reload with the original key',async()=>{
   const p=await patient('create'),ui=await browserAs(browser,'doctor');try{
    await ui.page.route('**/api/hms/encounters',async route=>{if(route.request().method()==='POST'){const response=await route.fetch();assert(response.status()===201,'Original start did not commit');await route.abort('failed');}else await route.continue();});
    await pick(ui,p);await ui.page.getByRole('button',{name:'Reconcile original Quick Consult start'}).waitFor();await ui.page.unroute('**/api/hms/encounters');await ui.page.reload();
    await ui.page.getByRole('button',{name:'Reconcile original Quick Consult start'}).click();await ready(ui);const [count]=await sql('SELECT count(*)::int n FROM hms_encounters WHERE patient_id=$1',[p.id]);assert(count.n===1,'Start reconciliation created a second consultation');
   }finally{await ui.ctx.close();}
  });
  await step('A signed consultation with a lost response resumes its exact pending signature and never signs twice',async()=>{
   const p=await patient('sign'),e=await encounter(p,'Synthetic reviewed signature'),ui=await browserAs(browser,'doctor');try{
    await pick(ui,p);await ready(ui);await ui.page.getByLabel('Chief complaint',{exact:true}).fill('Synthetic reviewed signature');
    await ui.page.route(`**/api/v2/encounters/${e.public_id}/sign`,async route=>{const response=await route.fetch();assert(response.status()===200,'Original signature did not commit');await route.abort('failed');});
    await ui.page.getByRole('button',{name:'Finalize and close',exact:true}).click();await ui.page.getByRole('button',{name:'Reconcile original consultation',exact:true}).waitFor();
    await ui.page.unroute(`**/api/v2/encounters/${e.public_id}/sign`);await ui.page.reload();const reconcile=ui.page.getByRole('button',{name:'Reconcile original consultation',exact:true});await reconcile.waitFor();
    await ui.page.locator('button:enabled').filter({hasText:/^Reconcile original consultation$/}).click();await ui.page.getByPlaceholder('Search patient name, ID or UHID').waitFor();
    const [saved]=await sql('SELECT e.status,count(s.id)::int signatures FROM hms_encounters e JOIN hms_document_signatures s ON s.document_id=e.notes_document_id WHERE e.id=$1 GROUP BY e.id',[e.id]);assert(saved.status==='Finalized'&&saved.signatures===1,'Signature was duplicated or lost');const [count]=await sql('SELECT count(*)::int n FROM hms_encounters WHERE patient_id=$1',[p.id]);assert(count.n===1,'Signed resumption created another consultation');
   }finally{await ui.ctx.close();}
  });
  await step('Dashboard consultation start also survives a committed-but-lost response and reload',async()=>{
   const p=await patient('dash');await sql("INSERT INTO hms_tokens(patient_id,doctor_id,department_id,token_number,token_date,status) VALUES($1,$2,$3,$4,hms_service_today(),'Waiting')",[p.id,doctor.id,doctor.department_id,parseInt(crypto.randomBytes(3).toString('hex'),16)]);
   const ui=await browserAs(browser,'doctor');try{
    await ui.page.goto(BASE+'/doctor/dashboard');await ui.page.getByPlaceholder('Search patient, UHID or phone').fill(p.uhid);
    await ui.page.route('**/api/hms/encounters',async route=>{if(route.request().method()==='POST'){const response=await route.fetch();assert(response.status()===201,'Dashboard start did not commit');await route.abort('failed');}else await route.continue();});
    await ui.page.getByRole('row').filter({hasText:p.name}).getByRole('button',{name:'Start consultation'}).click();await ui.page.locator('button:enabled').filter({hasText:/^Reconcile original consultation start$/}).waitFor();
    await ui.page.unroute('**/api/hms/encounters');await ui.page.reload();await ui.page.getByRole('button',{name:'Reconcile original consultation start',exact:true}).click();await ui.page.getByRole('alert',{name:'Unconfirmed consultation start'}).waitFor({state:'detached'});
    const [count]=await sql('SELECT count(*)::int n FROM hms_encounters WHERE patient_id=$1',[p.id]);assert(count.n===1,'Dashboard reconciliation duplicated the consultation');
   }finally{await ui.ctx.close();}
  });
 }finally{await browser.close();}
 done();process.exit();
})().catch(error=>{console.error(error.message);process.exit(1)});
