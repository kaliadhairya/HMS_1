const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),http=require('node:http');
const {Client}=require('pg');
test('departmental contracts preserve identities, fence attempts and isolate external effects',{skip:process.env.HMS_INTERFACE_TEST!=='true',timeout:120000},async t=>{
 const source=process.env.DB_NAME;assert.match(source||'',/^hms_(p4_final|verify_final)_[a-z0-9_]+$/);assert.ok(!source.includes('claude'));
 const tag=crypto.randomBytes(5).toString('hex'),database='hms_verify_final_interfaces_'+tag;
 const admin=new Client({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:'postgres'});
 await admin.connect();let sequelize,server;
 try{
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE "${source}"`);process.env.DB_NAME=database;
  ({sequelize}=require('../models/db'));
  const {storage,bindAuditActor}=require('../utils/auditContext');bindAuditActor(sequelize);
  const I=require('../services/interfaces');
  const q=(sql,replacements={},transaction)=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
  const [user]=await q("SELECT id FROM hms_users WHERE username='admin'");
  const [a]=await q("INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,'Synthetic interface A','UTC') RETURNING id",{code:'IF-A-'+tag});
  const [b]=await q("INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,'Synthetic interface B','UTC') RETURNING id",{code:'IF-B-'+tag});
  for(const f of [a,b])await q("INSERT INTO hms_facility_memberships(user_id,facility_id,granted_by_user_id,reason) VALUES(:user,:facility,:user,'Synthetic interface service membership')",{user:user.id,facility:f.id});
  const inFacility=(facility,fn)=>storage.run({requestId:crypto.randomUUID(),userId:user.id,facilityId:facility,facilityTimezone:'UTC',sessionId:null},fn);
  const input=(suffix,extra={})=>({system:'synthetic:'+tag,type:'result',version:'1',externalId:tag+'-'+suffix,payload:{opaque:'synthetic-only'},...extra});
  const actor={id:user.id,role:'admin',facilityId:a.id};
  const effects=new Map();let requests=0,unknownMessage;
  server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests++;const key=req.headers['idempotency-key'];if(!effects.has(key))effects.set(key,body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({accepted:true,duplicate:effects.get(key)===body}));});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const endpoint='http://127.0.0.1:'+server.address().port;
  const send=async m=>{const r=await fetch(endpoint,{method:'POST',headers:{'Idempotency-Key':m.delivery_key},body:JSON.stringify(m.payload)});return r.json();};
  const contract={ownerRole:'admin',versions:['1'],messageTypes:['result'],idempotency:'PROVIDER_KEY'};
  I.register('synthetic:'+tag,send,contract);
  await t.test('outgoing retries compare the complete contract rather than silently reusing another payload',async()=>inFacility(a.id,async()=>{
   const first=await I.enqueue(input('duplicate'));
   assert.equal((await I.enqueue(input('duplicate',{payload:{opaque:'synthetic-only'}}))).id,first.id);
   for(const change of [{payload:{opaque:'different'}},{version:'2'},{type:'other'},{correlationId:'different'},{maxAttempts:2}])await assert.rejects(I.enqueue(input('duplicate',change)),e=>e.code==='DUPLICATE_ID_DIFFERENT_CONTENT');
  }));
  await t.test('incoming duplicates bind version, type, raw content and facility',async()=>{
   const incoming=input('in',{raw:'SYNTHETIC ORIGINAL'});
   const first=await inFacility(a.id,()=>I.receive(incoming));
   assert.equal((await inFacility(a.id,()=>I.receive(incoming))).duplicate,true);
   for(const change of [{raw:'DIFFERENT'},{version:'2'},{type:'other'}])await assert.rejects(inFacility(a.id,()=>I.receive({...incoming,...change})),e=>e.code==='DUPLICATE_ID_DIFFERENT_CONTENT');
   assert.notEqual((await inFacility(b.id,()=>I.receive(incoming))).message.id,first.message.id);
  });
  await t.test('external delivery is disabled explicitly in restore environments',async()=>{
   process.env.HMS_EXTERNAL_EFFECTS='blocked';const before=requests;
   await assert.rejects(inFacility(a.id,()=>I.deliverDue()),e=>e.code==='EXTERNAL_EFFECTS_DISABLED');assert.equal(requests,before);
   process.env.HMS_EXTERNAL_EFFECTS='enabled';
  });
  await t.test('concurrent workers claim each message once and metadata cannot cross facility boundaries',async()=>{
   const before=requests;const counts=await Promise.all(Array.from({length:12},()=>inFacility(a.id,()=>I.deliverDue({limit:1}))));
   assert.equal(counts.reduce((sum,r)=>sum+r.delivered,0),1);assert.equal(requests-before,1);
   const [foreign]=await inFacility(b.id,()=>I.list());assert.ok(foreign);
   assert.equal(await inFacility(a.id,()=>I.settle(foreign.id,'Processed')),null);
  });
  await t.test('unsupported versions fail to a named worklist before contacting the provider',async()=>{
   const message=await inFacility(a.id,()=>I.enqueue(input('unsupported',{version:'99'}))),before=requests;
   await inFacility(a.id,()=>I.deliverDue());const [saved]=await q('SELECT status FROM hms_interface_messages WHERE id=:id',{id:message.id});
   assert.equal(saved.status,'Failed');assert.equal(requests,before);
   const [item]=await q('SELECT owner_role,facility_id FROM hms_worklist_items WHERE kind=\'interface.delivery_failed\' AND dedupe_key=:id',{id:message.id});assert.equal(item.owner_role,'admin');assert.equal(item.facility_id,a.id);
  });
  await t.test('a failed message starts a new immutable series with the same provider identity',async()=>{
   const message=await inFacility(a.id,()=>I.enqueue(input('failed')));
   I.register('synthetic:'+tag,async()=>{throw Object.assign(new Error('Synthetic known refusal'),{permanent:true,beforeSend:true});},contract);
   await inFacility(a.id,()=>I.deliverDue());
   const again=await inFacility(a.id,()=>sequelize.transaction(t=>I.retry(message.id,actor,t,{reason:'Synthetic provider confirmed no delivery',evidence_ref:'synthetic-provider-ref'})));
   assert.equal(again.external_id,message.external_id);assert.equal(again.delivery_key,message.delivery_key);assert.equal(again.attempt_series,1);
   assert.equal((await inFacility(a.id,()=>sequelize.transaction(t=>I.retry(message.id,actor,t,{reason:'Synthetic repeat of reviewed retry',evidence_ref:'synthetic-provider-ref'})))).id,again.id);
   const [old]=await q('SELECT status FROM hms_interface_messages WHERE id=:id',{id:message.id});assert.equal(old.status,'Failed');
   I.register('synthetic:'+tag,send,contract);await inFacility(a.id,()=>I.deliverDue());
  });
  await t.test('a stale worker cannot overwrite a replacement worker after lease expiry',async()=>{
   const message=await inFacility(a.id,()=>I.enqueue(input('lease')));let release,seen;
   const held=new Promise(r=>{release=r}),started=new Promise(r=>{seen=r});let calls=0;
   I.register('synthetic:'+tag,async m=>{const response=await send(m);if(++calls===1){seen();await held;}return {...response,worker:calls===1?'old':'new'};},contract);
   const first=inFacility(a.id,()=>I.deliverDue({limit:1}));await started;
   await q("UPDATE hms_interface_messages SET lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' WHERE id=:id",{id:message.id});
   const second=await inFacility(a.id,()=>I.deliverDue({limit:1}));release();const old=await first;
   assert.equal(second.delivered,1);assert.equal(old.delivered,0);
   const [saved]=await q('SELECT status,response FROM hms_interface_messages WHERE id=:id',{id:message.id});assert.equal(saved.status,'Delivered');assert.equal(saved.response.worker,'new');
   const [stale]=await q("SELECT count(*)::int n FROM hms_interface_attempt_events WHERE message_id=:id AND phase='STALE'",{id:message.id});assert.equal(stale.n,1);
  });
  await t.test('an ambiguous non-idempotent result is held and never automatically sent twice',async()=>{
   I.register('synthetic:'+tag,async m=>{await send(m);throw new Error('Synthetic lost provider response');},{...contract,idempotency:'RECONCILE'});
   const message=await inFacility(a.id,()=>I.enqueue(input('unknown'))),before=requests;unknownMessage=message;
   await inFacility(a.id,()=>I.deliverDue());await inFacility(a.id,()=>I.deliverDue());assert.equal(requests-before,1);
   const [saved]=await q('SELECT delivery_hold,status FROM hms_interface_messages WHERE id=:id',{id:message.id});assert.equal(saved.delivery_hold,true);assert.equal(saved.status,'Pending');
   const [review]=await q("SELECT owner_role FROM hms_worklist_items WHERE kind='interface.outcome_unknown' AND dedupe_key=:id",{id:message.id});assert.equal(review.owner_role,'admin');
  });
  await t.test('operator reconciliation needs current authority, a reason and provider evidence',async()=>{
   const review={decision:'CONFIRMED_DELIVERED',reason:'Synthetic receiving service confirmed the original effect',evidence_ref:'synthetic-provider-ack'};
   await assert.rejects(inFacility(a.id,()=>sequelize.transaction(t=>I.reviewDelivery(unknownMessage.id,{decision:'CONFIRMED_DELIVERED'},actor,t))),e=>e.code==='DELIVERY_EVIDENCE_REQUIRED');
   await assert.rejects(inFacility(a.id,()=>sequelize.transaction(t=>I.reviewDelivery(unknownMessage.id,review,{...actor,role:'doctor'},t))),e=>e.code==='DELIVERY_REVIEW_REQUIRED');
   const before=requests,saved=await inFacility(a.id,()=>sequelize.transaction(t=>I.reviewDelivery(unknownMessage.id,review,actor,t)));
   assert.equal(saved.status,'Delivered');await inFacility(a.id,()=>I.deliverDue());assert.equal(requests,before);
   const [proof]=await q('SELECT actor_user_id,evidence_ref FROM hms_interface_delivery_reviews WHERE message_id=:id',{id:unknownMessage.id});assert.equal(proof.actor_user_id,user.id);assert.equal(proof.evidence_ref,review.evidence_ref);
   await assert.rejects(q('UPDATE hms_interface_delivery_reviews SET reason=\'rewritten\' WHERE message_id=:id',{id:unknownMessage.id}));
  });
  await t.test('confirmed non-delivery permits one further attempt while preserving the external identity',async()=>{
   I.register('synthetic:'+tag,async()=>{throw new Error('Synthetic connection outcome unknown');},{...contract,idempotency:'RECONCILE'});
   const message=await inFacility(a.id,()=>I.enqueue(input('reviewed-retry')));await inFacility(a.id,()=>I.deliverDue());
   const released=await inFacility(a.id,()=>sequelize.transaction(t=>I.reviewDelivery(message.id,{decision:'CONFIRMED_NOT_DELIVERED',reason:'Synthetic provider confirmed nothing arrived',evidence_ref:'synthetic-provider-not-found'},actor,t)));
   assert.equal(released.external_id,message.external_id);assert.equal(released.delivery_key,message.delivery_key);
   I.register('synthetic:'+tag,send,{...contract,idempotency:'RECONCILE'});const before=requests;
   assert.equal((await inFacility(a.id,()=>I.deliverDue())).delivered,1);await inFacility(a.id,()=>I.deliverDue());assert.equal(requests-before,1);
  });
  await t.test('an approved callback account binds a restricted connection without granting clinical privileges',async()=>{
   const context=require('../services/integrationContext.cts'),tx=await sequelize.transaction(),role='hms_verify_final_if_'+tag;
   try{
    await q(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS`,{},tx);await q(`GRANT USAGE ON SCHEMA public TO ${role}`,{},tx);await q(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`,{},tx);await q(`GRANT INSERT,UPDATE ON hms_interface_messages TO ${role}`,{},tx);
    for(const table of ['hms_users','hms_facilities','hms_facility_memberships'])await q(`GRANT UPDATE(id) ON ${table} TO ${role}`,{},tx);
    await q(`SET LOCAL ROLE ${role}`,{},tx);
    const result=await context.withAccount(tx,user.id,a.id,'synthetic-callback',()=>I.receive(input('restricted',{raw:'SYNTHETIC RESTRICTED'}),tx));assert.equal(result.message.facility_id,a.id);assert.equal(result.message.accepted_by_user_id,user.id);
    assert.equal((await q('SELECT id FROM hms_interface_messages WHERE id=:id',{id:result.message.id},tx)).length,0,'Callback scope leaked after completion');
    await assert.rejects(context.withAccount(tx,user.id,crypto.randomUUID(),'synthetic-refused',async()=>null),e=>e.code==='INTEGRATION_MEMBERSHIP_REQUIRED');
    await assert.rejects(context.withAccount(tx,0,a.id,'synthetic-unbound',async()=>null),e=>e.code==='INTEGRATION_BINDING_REQUIRED');
   }finally{await tx.rollback();}
  });
  await t.test('restored messages from an old writer epoch are held before external delivery',async()=>{
   I.register('synthetic:'+tag,send,contract);const message=await inFacility(a.id,()=>I.enqueue(input('recovery'))),before=requests;
   await q("UPDATE hms_writer_fence SET epoch=epoch+1,cluster_id=gen_random_uuid(),reason='Synthetic restored writer generation'");
   await inFacility(a.id,()=>I.deliverDue());assert.equal(requests,before);
   const [saved]=await q('SELECT delivery_hold,last_error FROM hms_interface_messages WHERE id=:id',{id:message.id});assert.equal(saved.delivery_hold,true);assert.equal(saved.last_error,'RECOVERY_RECONCILIATION_REQUIRED');
  });
  await t.test('revoked service membership prevents any later external call',async()=>{
   await q("UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=:user,revocation_reason='Synthetic interface membership revocation' WHERE user_id=:user AND facility_id=:facility AND revoked_at IS NULL",{user:user.id,facility:a.id});
   await assert.rejects(inFacility(a.id,()=>I.deliverDue()),e=>e.code==='FACILITY_MEMBERSHIP_REQUIRED');
   await assert.rejects(inFacility(a.id,()=>sequelize.transaction(tx=>I.retry(unknownMessage.id,actor,tx,{reason:'Synthetic revoked reviewer tries another delivery',evidence_ref:'synthetic-denied'}))),e=>e.code==='DELIVERY_REVIEW_REQUIRED');
  });
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  if(sequelize)await sequelize.close();
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);await admin.end();
 }
});
