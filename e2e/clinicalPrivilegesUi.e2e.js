const crypto=require('crypto');
const {api,apiLogin,sql,chromium,browserAs,runner,assert,BASE,requireThrowawayDb}=require('./helpers');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Clinical privilege administration UI');
 const tag=crypto.randomUUID().slice(0,8),admin=await apiLogin('admin'),superadmin=await apiLogin('super_admin');
 const [doctor]=await sql("SELECT u.id,p.display_name FROM hms_users u JOIN hms_practitioners p ON p.user_id=u.id WHERE u.username='doctor'");
 const browser=await chromium.launch({headless:true}),{ctx,page,errors}=await browserAs(browser,'admin');
 let credential;
 try{
  await step('Administrator view names the verified facility and separates professional roles from clinical actions',async()=>{
   await page.goto(BASE+'/hms/admin/clinical-privileges');
   await page.getByRole('heading',{name:'Clinical privileges',exact:true}).waitFor();
   await page.getByText(/Facility: Initial hospital facility/).waitFor();
   assert(await page.getByRole('heading',{name:'Approve a professional role'}).count(),'Missing professional-role form');
   assert(await page.getByRole('heading',{name:'Approve a clinical action'}).count(),'Missing explicit action form');
   assert(await page.getByLabel('Practitioner',{exact:true}).count(),'Missing explicit practitioner selector');
  });
  await step('Recording a synthetic qualification creates an unverified record',async()=>{
   const r=await api('POST',`/practitioners/${doctor.id}/credentials`,{token:admin,body:{kind:'medical_registration',identifier:'UI-SYNTHETIC-'+tag,issuingBody:'SYNTHETIC ACCEPTANCE COUNCIL',validFrom:'2026-01-01',validTo:'2027-01-01'}});
   assert(r.status===201,'Credential '+r.status);credential=r.data.data.id;assert(!r.data.data.verified_at,'Created a verified credential');
  });
  await step('Verification screen requires an evidence reference and reason and rejects the original recorder',async()=>{
   await page.goto(BASE+'/hms/practitioners');
   await page.getByRole('button').filter({hasText:doctor.display_name}).first().click();
   const row=page.getByRole('row').filter({hasText:'UI-SYNTHETIC-'+tag});
   await row.getByRole('button',{name:'Review verification'}).click();
   await page.getByLabel('Verification evidence reference').fill('SYNTHETIC-UI-'+tag);
   await page.getByLabel('Verification reason').fill('Synthetic independent verification acceptance only');
   await page.getByRole('button',{name:'Confirm independent verification'}).click();
   await page.getByText('The verifier must differ from the practitioner and the person who recorded this qualification.',{exact:true}).last().waitFor();
   assert((await sql('SELECT verified_at FROM hms_practitioner_credentials WHERE id=$1',[credential]))[0].verified_at===null,'Recorder approved their own evidence');
   assert(await page.getByLabel('Verification evidence reference').inputValue()==='SYNTHETIC-UI-'+tag,'Rejected verification discarded evidence draft');
  });
  await step('A different administrator can verify recorded synthetic evidence through the real API',async()=>{
   const r=await api('POST',`/practitioners/${doctor.id}/credentials/${credential}/verify`,{token:superadmin,body:{reference:'SYNTHETIC-UI-'+tag,reason:'Synthetic independent verification acceptance only'}});
   assert(r.status===200,'Independent verification '+r.status);
   assert((await sql('SELECT verification_evidence FROM hms_practitioner_credentials WHERE id=$1',[credential]))[0].verification_evidence.reference==='SYNTHETIC-UI-'+tag,'Verification evidence missing');
  });
  assert(errors.length===0,errors.join('; '));
 }finally{
  if(credential)await api('POST',`/practitioners/${doctor.id}/credentials/${credential}/end`,{token:admin,body:{reason:'Synthetic UI fixture finished; not a hospital qualification',endOn:'2026-10-15'}});
  await ctx.close();await browser.close();
 }
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
