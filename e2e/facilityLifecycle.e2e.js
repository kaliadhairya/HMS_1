// Explicit synthetic hospital facilities/staff; no clinical approval is seeded.
const crypto=require('crypto');
const {isDeepStrictEqual}=require('node:util');
const {api,apiLogin,sql,runner,assert,requireThrowawayDb,chromium,BASE}=require('./helpers');
requireThrowawayDb();
const checked=(r,status=200)=>{assert(r.status===status,`${r.status}: ${JSON.stringify(r.data).slice(0,350)}`);return r.data.data;};
(async()=>{
 const {step,done}=runner('Facility membership and session lifecycle'),tag=crypto.randomUUID().slice(0,8),password='SyntheticFacility@123';
 const hash=await require('../backend/node_modules/bcryptjs').hash(password,10);
 const [administrator]=await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic facility administrator','admin',1,0) RETURNING id,public_id",['fac-admin-'+tag,hash]);
 const [doctor]=await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic facility doctor','doctor',1,0) RETURNING id,public_id",['fac-doctor-'+tag,hash]);
 const login=async username=>{const r=await api('POST','/auth/login',{body:{username,password},headers:{'X-Auth-Transport':'bearer'}});assert(r.status===200&&r.data.token,'Synthetic staff login failed');return r.data;};
 let admin=await login('fac-admin-'+tag),clinician=await login('fac-doctor-'+tag),facility,membership,initial=admin.user.facilityId;
 const call=(method,path,token,body,revision,key)=>api(method,path,{token,body,headers:{...(revision===undefined?{}:{'if-match':String(revision)}),...(key?{'idempotency-key':key}:{})}});
 await step('An authorized hospital administrator creates one facility on retry; ordinary staff cannot',async()=>{
  const b={code:'F-'+tag,name:'Synthetic new facility '+tag,timezone:'UTC',reason:'Synthetic governed facility creation'},key=crypto.randomUUID();
  const first=await call('POST','/facilities',admin.token,b,undefined,key);facility=checked(first);assert(facility.configuration_review_required&&facility.revision===1,'Configuration review silently approved');
  const again=await call('POST','/facilities',admin.token,b,undefined,key);assert(again.status===200&&isDeepStrictEqual(first.data,again.data),'Creation retry duplicated or changed the facility');
  assert((await call('POST','/facilities',clinician.token,{...b,code:'NO-'+tag})).status===403,'Clinical login created hospital infrastructure');
 });
 await step('A facility switch requires actual membership and atomically replaces this session',async()=>{
  const denied=await call('POST','/auth/facility-session',clinician.token,{facility_id:facility.id});assert(denied.status===403,'Non-member switched facility');
  assert((await call('GET','/auth/me',clinician.token)).status===200,'Refused switch ended a valid session');
  const old=admin.token,r=await api('POST','/auth/facility-session',{token:old,body:{facility_id:facility.id},headers:{'X-Auth-Transport':'bearer'}});assert(r.status===200&&r.data.token,'Approved switch failed');admin=r.data;
  assert(admin.user.facilityId===facility.id&&(await call('GET','/auth/me',old)).status===401,'Old session remained active or new context was wrong');
  assert((await api('GET','/auth/me',{token:admin.token,headers:{'x-facility-id':initial}})).status===403,'Forged forwarding scope accepted');
 });
 await step('Membership is explicit, uses a canonical identity and grants no professional authority',async()=>{
  const b={principal_id:doctor.public_id,valid_from:new Date(Date.now()-60000).toISOString(),valid_until:new Date(Date.now()+86400000).toISOString(),reason:'Synthetic approved hospital staff membership'};
  assert((await call('POST','/facilities/memberships',admin.token,{...b,principal_id:doctor.id})).status===422,'Numeric staff identity silently interpreted');
  membership=checked(await call('POST','/facilities/memberships',admin.token,b));
  const r=await api('POST','/auth/facility-session',{token:clinician.token,body:{facility_id:facility.id},headers:{'X-Auth-Transport':'bearer'}});assert(r.status===200&&r.data.token,'Approved member could not switch');clinician=r.data;
  const read=await call('GET','/medication/orders',clinician.token);assert(read.status===403&&read.data.code==='CLINICAL_PRIVILEGE_REQUIRED','Membership implicitly granted clinical access');
  const [roles]=await sql('SELECT count(*)::int n FROM hms_practitioner_roles r JOIN hms_practitioners p ON p.id=r.practitioner_id WHERE p.user_id=$1 AND r.facility_id=$2',[doctor.id,facility.id]);assert(roles.n===0,'Membership invented a professional approval');
 });
 await step('Configuration changes require the exact current version and preserve facility identity',async()=>{
  assert((await call('PATCH','/facilities/current',admin.token,{name:'Synthetic reviewed facility',reason:'Synthetic metadata review'})).status===428,'Missing configuration version accepted');
  const changed=checked(await call('PATCH','/facilities/current',admin.token,{name:'Synthetic reviewed facility '+tag,reason:'Synthetic explicit metadata review'},facility.revision));assert(changed.revision===2&&changed.id===facility.id&&changed.configuration_review_required,'Review identity/configuration changed incorrectly');
  assert((await call('PATCH','/facilities/current',admin.token,{name:'Stale name',reason:'Synthetic stale metadata review'},facility.revision)).status===412,'Stale metadata review accepted');
 });
 await step('Revocation rejects stale or foreign grants, ends facility sessions and retains immutable evidence',async()=>{
  const [foreign]=await sql('SELECT id FROM hms_facility_memberships WHERE user_id=$1 AND facility_id=$2',[doctor.id,initial]);
  assert((await call('POST',`/facilities/memberships/${foreign.id}/revoke`,admin.token,{reason:'Synthetic foreign revocation attempt'},1)).status===404,'Foreign facility membership altered');
  const path=`/facilities/memberships/${membership.id}/revoke`,b={reason:'Synthetic membership revocation after review'};
  assert((await call('POST',path,admin.token,b)).status===428,'Missing membership precondition accepted');assert((await call('POST',path,admin.token,b,999)).status===412,'Stale membership precondition accepted');
  const revoked=checked(await call('POST',path,admin.token,b,membership.revision));assert(revoked.revision===2&&revoked.revocation_reason===b.reason,'Missing revocation evidence');
  assert((await call('GET','/auth/me',clinician.token)).status===401,'Revoked facility session still works');
  let refused=false;try{await sql('UPDATE hms_facility_memberships SET revoked_at=NULL,revoked_by_user_id=NULL,revocation_reason=NULL WHERE id=$1',[membership.id]);}catch{refused=true;}assert(refused,'Revoked approval resurrected');
 });
 await step('The browser switches only among approved facilities and reconnects under the new context',async()=>{
  const browser=await chromium.launch();try{const page=await browser.newPage();await page.goto(BASE+'/login');await page.fill('#login-username','fac-admin-'+tag);await page.fill('#login-password',password);await page.click('button[type=submit]');await page.waitForURL(u=>!u.pathname.startsWith('/login'));
   await page.goto(BASE+'/hms/facility');await page.getByLabel('Authorized facility').selectOption(facility.id);await page.getByRole('button',{name:'Switch facility',exact:true}).click();
   await page.waitForFunction(id=>JSON.parse(localStorage.getItem('lab_user')||'null')?.facilityId===id,facility.id);await page.waitForURL(u=>u.pathname!=='/hms/facility');
   await page.goto(BASE+'/hms/facility');await page.getByRole('heading',{name:'Facility membership',exact:true}).waitFor();assert(await page.getByLabel('Authorized facility').inputValue()===facility.id,'Browser selected another facility');
  }finally{await browser.close();}
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
