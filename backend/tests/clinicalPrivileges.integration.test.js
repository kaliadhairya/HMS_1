const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {sequelize}=require('../models/db');
const F=require('../services/facilities.cts'),A=require('../services/facilityAdministration.cts');
test('facility clinical grants require independent credentials, exact revisions and current authority',{skip:process.env.HMS_FACILITY_TEST!=='true',timeout:30000},async t=>{
 assert.match(process.env.DB_NAME||'',/^hms_(p4_final|verify_final)_/);
 const tx=await sequelize.transaction(),tag=crypto.randomUUID();
 const q=(sql,replacements={})=>sequelize.query(sql,{replacements,transaction:tx,type:'SELECT'});
 try{
  const [{id:facilityId}]=await q('SELECT hms_initial_facility() id');
  const users=await q("SELECT id,role FROM hms_users WHERE username IN ('doctor','admin','superadmin')");
  const doctor={...users.find(u=>u.role==='doctor'),facilityId},admin={...users.find(u=>u.role==='admin'),facilityId},verifier=users.find(u=>u.role==='super_admin');
  const [p]=await q('SELECT id,public_id FROM hms_practitioners WHERE user_id=:id',{id:doctor.id});
  await q("UPDATE hms_practitioner_credentials SET ended_by=:actor,ended_reason='Synthetic privilege acceptance isolation' WHERE practitioner_id=:p AND ended_by IS NULL",{actor:admin.id,p:p.id});
  const now=Date.now(),validFrom=new Date(now-3600000).toISOString(),validUntil=new Date(now+3600000).toISOString();
  const input={practitionerId:p.public_id,role:'doctor',validFrom,validUntil,reason:'Synthetic privilege acceptance fixture'};
  await t.test('a login role does not automatically confer any clinical privilege',async()=>{
   await assert.rejects(F.requirePrivilege(doctor,'PRESCRIBE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
   await assert.rejects(F.requirePrivilege(admin,'PRESCRIBE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
   await assert.rejects(A.grantRole(admin,input,tx),e=>e.code==='PROFESSIONAL_CREDENTIAL_REQUIRED');
  });
  await q(`INSERT INTO hms_practitioner_credentials(practitioner_id,kind,identifier,issuing_body,valid_from,valid_to,created_by,verified_by,verified_at,verification_evidence)
   VALUES(:p,'medical_registration',:tag,'SYNTHETIC TEST COUNCIL',hms_service_today()-1,hms_service_today()+1,:creator,:verifier,now(),CAST(:evidence AS jsonb))`,{p:p.id,tag,creator:admin.id,verifier:verifier.id,evidence:JSON.stringify({reference:'SYNTHETIC-ONLY',reason:'Synthetic independent verification acceptance fixture'})});
  let role,privilege;
  await t.test('a reviewed professional role grants no action until explicitly approved',async()=>{
   role=await A.grantRole(admin,input,tx);
   await assert.rejects(F.requirePrivilege(doctor,'PRESCRIBE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
  });
  await t.test('clinical privilege creation requires the reviewed role revision and allowed window',async()=>{
   const b={action:'PRESCRIBE',validFrom,validUntil,reason:input.reason};
   await assert.rejects(A.grantPrivilege(admin,role.id,b,undefined,tx),e=>e.code==='PRECONDITION_REQUIRED');
   await assert.rejects(A.grantPrivilege(admin,role.id,b,99,tx),e=>e.code==='VERSION_STALE');
   await assert.rejects(A.grantPrivilege(admin,role.id,{...b,action:'NURSING_DOCUMENT'},1,tx),e=>e.code==='INVALID_CLINICAL_PRIVILEGE');
   await assert.rejects(A.grantPrivilege(admin,role.id,{...b,validUntil:new Date(now+7200000).toISOString()},1,tx),e=>e.code==='INVALID_CLINICAL_PRIVILEGE');
   const r=await A.grantPrivilege(admin,role.id,b,1,tx);privilege=r.grant;assert.equal(r.roleRevision,2);
   await F.requirePrivilege(doctor,'PRESCRIBE',tx);
  });
  await t.test('an administrator cannot approve their own clinical role',async()=>{
   const [own]=await q(`INSERT INTO hms_practitioners(user_id,display_name) VALUES(:id,'Synthetic administrator practitioner') ON CONFLICT(user_id) DO UPDATE SET display_name=hms_practitioners.display_name RETURNING public_id`,{id:admin.id});
   await assert.rejects(A.grantRole(admin,{...input,practitionerId:own.public_id},tx),e=>e.code==='INDEPENDENT_APPROVAL_REQUIRED');
  });
  await t.test('a grant cannot be used or revoked through another facility',async()=>{
   const [other]=await q("INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,'Synthetic other grant facility','UTC') RETURNING id",{code:'GRANTS-'+tag});
   await q('INSERT INTO hms_facility_memberships(facility_id,user_id,reason) VALUES(:facility,:doctor,:reason),(:facility,:admin,:reason)',{facility:other.id,doctor:doctor.id,admin:admin.id,reason:input.reason});
   await assert.rejects(F.requirePrivilege({...doctor,facilityId:other.id},'PRESCRIBE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
   await assert.rejects(A.revoke({...admin,facilityId:other.id},'privilege',privilege.id,{reason:input.reason},1,tx),e=>e.code==='NOT_FOUND');
  });
  await t.test('revocation preserves grant evidence, records its authority and blocks the next command',async()=>{
   await assert.rejects(A.revoke(admin,'privilege',privilege.id,{reason:input.reason},99,tx),e=>e.code==='VERSION_STALE');
   const r=await A.revoke(admin,'privilege',privilege.id,{reason:'Synthetic negative permission test revocation'},1,tx);
   assert.equal(r.reason,privilege.reason);assert.equal(r.revoked_by_user_id,admin.id);assert.equal(r.revision,2);assert(r.revocation_reason);
   await assert.rejects(F.requirePrivilege(doctor,'PRESCRIBE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
  });
  await t.test('future-dated professional roles can be revoked before their start',async()=>{
   const future=await A.grantRole(admin,{...input,validFrom:new Date(now+3600000).toISOString(),validUntil:new Date(now+7200000).toISOString()},tx);
   const r=await A.revoke(admin,'role',future.id,{reason:'Synthetic cancellation before role activation'},1,tx);assert(r.revoked_at);
  });
 }finally{await tx.rollback().catch(()=>{});await sequelize.close();}
});
