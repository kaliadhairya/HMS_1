const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {sequelize}=require('../models/db'),{storage,bindAuditActor}=require('../utils/auditContext');
const D=require('../services/devices'),Context=require('../services/deviceContext.cts'),F=require('../services/facilities.cts');
test('device intake uses its approved facility/service account through a restricted runtime role',{skip:process.env.HMS_FACILITY_TEST!=='true',timeout:30000},async t=>{
 assert.match(process.env.DB_NAME||'',/^hms_(p4_final|verify_final)_/);bindAuditActor(sequelize);
 const tx=await sequelize.transaction(),tag=crypto.randomBytes(5).toString('hex'),role='hms_verify_final_device_'+tag,key='SYNTHETIC-'+crypto.randomBytes(24).toString('hex');
 const q=(sql,replacements={})=>sequelize.query(sql,{replacements,transaction:tx,type:'SELECT'});
 let contract,service,facility;
 try{
  const [admin]=await q("SELECT id FROM hms_users WHERE username='admin'");
  [facility]=await q("INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,'Synthetic machine scope facility','UTC') RETURNING id",{code:'DEV-'+tag});
  [service]=await q("INSERT INTO hms_users(username,password,name,role) VALUES(:name,:password,'Synthetic unlicensed machine account','lab_technician') RETURNING id",{name:'devscope_'+tag,password:crypto.randomBytes(32).toString('hex')});
  await q('INSERT INTO hms_facility_memberships(facility_id,user_id,reason) VALUES(:facility,:user,:reason)',{facility:facility.id,user:service.id,reason:'Synthetic machine facility membership fixture'});
  await q(`INSERT INTO hms_lab_privileges(user_id,facility_id,privilege,granted_by_user_id,reason,valid_from,valid_until)
   VALUES(:user,:facility,'ANALYZER',:admin,'Synthetic machine capability approval',now()-interval '1 minute',now()+interval '1 hour')`,{user:service.id,facility:facility.id,admin:admin.id});
  [contract]=await q(`INSERT INTO hms_device_contracts(system,version,kind,protocol,description,provenance,service_user_id,owner_role,status,api_key_hash,created_by,approved_by,approved_at,allowed_hosts,mllp_port,facility_id)
   VALUES(:system,1,'analyzer','hl7v2','Synthetic facility test','Synthetic private acceptance manual',:user,'lab_technician','Active',:hash,:user,:admin,now(),ARRAY['127.0.0.1'],27000,:facility) RETURNING *`,{system:'analyzer:scope-'+tag,user:service.id,admin:admin.id,hash:D.keyHash(key),facility:facility.id});
  await q(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
  await q(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await q(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
  await q(`GRANT INSERT,UPDATE ON hms_interface_messages,hms_worklist_items TO ${role}`);
  // PostgreSQL row locks require UPDATE on at least one column. Permit the
  // key column for locking authority rows, without granting clinical action
  // fields or schema/owner privileges to this acceptance identity.
  for(const table of ['hms_users','hms_facilities','hms_facility_memberships','hms_lab_privileges','hms_clinical_privileges','hms_practitioner_roles','hms_practitioners','hms_practitioner_credentials'])await q(`GRANT UPDATE(id) ON ${table} TO ${role}`);
  await q(`GRANT EXECUTE ON FUNCTION hms_device_ingress_binding(text,text,inet),hms_device_listener_registry() TO ${role}`);
  await q(`SET LOCAL ROLE ${role}`);
  const auth={key,host:'127.0.0.1'};
  await t.test('an unbound runtime connection cannot read contracts or message payloads',async()=>{
   assert.equal((await q('SELECT id FROM hms_device_contracts WHERE id=:id',{id:contract.id})).length,0);
   await assert.rejects(D.contractFor(contract.system,{},tx),e=>e.code==='DEVICE_AUTH_REQUIRED');
   await assert.rejects(D.contractFor(contract.system,{key:'wrong',host:'127.0.0.1'},tx),e=>e.code==='BAD_KEY');
   await assert.rejects(D.contractFor(contract.system,{key,host:'192.0.2.9'},tx),e=>e.code==='HOST_REFUSED');
  });
  await t.test('the registered machine receives only its explicit capability and no clinical release privilege',async()=>{
   const c=await D.contractFor(contract.system,auth,tx);assert.equal(c.facility_id,facility.id);
   await Context.withBinding(tx,c,async actor=>{
    assert.equal(actor.id,service.id);assert.equal(actor.facilityId,facility.id);assert.equal(actor.facilityTimezone,'UTC');
    await assert.rejects(F.requirePrivilege(actor,'LAB_RELEASE',tx),e=>e.code==='CLINICAL_PRIVILEGE_REQUIRED');
    const [{n}]=await q('SELECT count(*)::int n FROM hms_practitioner_credentials c JOIN hms_practitioners p ON p.id=c.practitioner_id WHERE p.user_id=:user',{user:service.id});assert.equal(n,0);
   });
  });
  await t.test('malformed intake is durably rejected with exact contract/account/facility provenance',async()=>{
   const r=await storage.run({requestId:crypto.randomUUID()},()=>D.receive(contract.system,'SYNTHETIC INVALID HL7',auth,tx));
   assert.equal(r.status,'Rejected');assert.match(r.ack,/MSA\|AR/);
   assert.equal((await q('SELECT id FROM hms_interface_messages WHERE system=:system',{system:contract.system})).length,0,'Binding leaked into subsequent queries');
   await q('RESET ROLE');
   const [m]=await q('SELECT status,facility_id,device_contract_id,accepted_by_user_id FROM hms_interface_messages WHERE system=:system',{system:contract.system});
   assert.equal(m.status,'Rejected');assert.equal(m.facility_id,facility.id);assert.equal(m.device_contract_id,contract.id);assert.equal(m.accepted_by_user_id,service.id);
   await q(`SET LOCAL ROLE ${role}`);
   const duplicate=await D.receive(contract.system,'SYNTHETIC INVALID HL7',auth,tx);assert.equal(duplicate.status,'Rejected');assert.equal(duplicate.duplicate,true);assert.match(duplicate.ack,/MSA\|AR/);
  });
  await t.test('an oversized result batch is rejected atomically and a retry preserves its original rejection',async()=>{
   const old=process.env.DEVICE_MAX_RESULTS;process.env.DEVICE_MAX_RESULTS='1';
   try{
    const raw=`MSH|^~\\&|SYNTHETIC|LAB|HMS|HOSP|20261015100000||ORU^R01|LIMIT-${tag}|P|2.5.1\rOBR|1||UNKNOWN|UNKNOWN\rOBX|1|NM|UNKNOWN||1|TEST\rOBX|2|NM|UNKNOWN||2|TEST`;
    const first=await D.receive(contract.system,raw,auth,tx);assert.equal(first.status,'Rejected');assert.match(first.ack,/MSA\|AR\|LIMIT-/);
    const repeat=await D.receive(contract.system,raw,auth,tx);assert.equal(repeat.status,'Rejected');assert.equal(repeat.duplicate,true);
   }finally{if(old===undefined)delete process.env.DEVICE_MAX_RESULTS;else process.env.DEVICE_MAX_RESULTS=old;}
  });
  await t.test('an analyzer cannot reinterpret another HL7 message type as a clinical result',async()=>{
   const raw=`MSH|^~\\&|SYNTHETIC|LAB|HMS|HOSP|20261015100000||ADT^A01|WRONG-TYPE-${tag}|P|2.5.1\rOBR|1||UNKNOWN|UNKNOWN\rOBX|1|NM|UNKNOWN||1|TEST`;
   const r=await D.receive(contract.system,raw,auth,tx);assert.equal(r.status,'Rejected');assert.match(r.ack,/MSA\|AR\|WRONG-TYPE-/);
  });
  await t.test('unknown results retain an attributed facility worklist and original duplicate outcome',async()=>{
   const raw=`MSH|^~\\&|SYNTHETIC|LAB|HMS|HOSP|20261015100000||ORU^R01|SCOPE-${tag}|P|2.5.1\rPID|1||UNMATCHED\rOBR|1||UNKNOWN|UNKNOWN\rOBX|1|NM|UNKNOWN||1|TEST`;
   const first=await D.receive(contract.system,raw,auth,tx);assert.equal(first.status,'Unmatched');assert.match(first.ack,/MSA\|AE/);
   const repeat=await D.receive(contract.system,raw,auth,tx);assert.equal(repeat.duplicate,true);assert.equal(repeat.status,'Unmatched');
   await q('RESET ROLE');
   const [w]=await q('SELECT id,facility_id FROM hms_worklist_items WHERE dedupe_key=:key',{key:contract.system+':SCOPE-'+tag});assert.equal(w.facility_id,facility.id);
   const [a]=await q("SELECT actor_user_id FROM audit.row_changes WHERE table_name='hms_worklist_items' AND row_id=:id ORDER BY id DESC LIMIT 1",{id:w.id});assert.equal(a.actor_user_id,service.id);
   await q(`SET LOCAL ROLE ${role}`);
  });
  await t.test('failed context restoration prevents confirmed success and rolls back message custody',async()=>{
   const original=sequelize.query;
   sequelize.query=function(sql,options){
    if(typeof sql==='string'&&sql.includes("set_config('hms.actor_user_id'")&&options?.replacements?.actor==='')throw new Error('Injected context restoration failure');
    return original.call(this,sql,options);
   };
   try{
    await assert.rejects(sequelize.transaction({transaction:tx},sp=>Context.withBinding(sp,contract,()=>require('../services/interfaces').receive({system:contract.system,type:'synthetic',version:'hl7v2/v1',externalId:'RESTORE-FAIL-'+tag,raw:'Synthetic custody rollback fixture'},sp))),/Injected context restoration failure/);
   }finally{sequelize.query=original;}
   await q('RESET ROLE');
   assert.equal((await q('SELECT id FROM hms_interface_messages WHERE external_id=:id',{id:'RESTORE-FAIL-'+tag})).length,0,'Unconfirmed message escaped rollback');
   await q(`SET LOCAL ROLE ${role}`);
  });
  await t.test('current membership revocation prevents all further intake despite a valid device key',async()=>{
   await q('RESET ROLE');await q('UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=:admin WHERE user_id=:user AND facility_id=:facility AND revoked_at IS NULL',{admin:admin.id,user:service.id,facility:facility.id});
   await q(`SET LOCAL ROLE ${role}`);
   await assert.rejects(D.receive(contract.system,'SYNTHETIC SHOULD NOT BE STORED',auth,tx),e=>e.code==='FACILITY_MEMBERSHIP_REQUIRED');
  });
 }finally{await tx.rollback().catch(()=>{});await sequelize.close();}
});
