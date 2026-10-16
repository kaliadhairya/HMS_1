const crypto=require('crypto');
const {apiLogin,sql,runner,assert,requireThrowawayDb,API}=require('./helpers');
const {requestHash}=require('../backend/utils/idempotency');
const {signSessionToken}=require('../backend/utils/authTokens');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Scoped clinical command receipts'),token=await apiLogin('admin');
 const [actor]=await sql("SELECT id,role FROM hms_users WHERE username='admin'"),[{id:initial}]=await sql('SELECT hms_initial_facility() id');
 const key=crypto.randomUUID(),path='/facilities/professional-roles/'+crypto.randomUUID()+'/revoke',body={reason:'Synthetic scope and revision acceptance request'};
 const send=async(t,k,revision)=>{const r=await fetch(API+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+t,'idempotency-key':k,...(revision===undefined?{}:{'if-match':revision})},body:JSON.stringify(body)});return {status:r.status,replay:r.headers.get('idempotent-replay'),data:await r.json()};};
 let facility,session;
 try{
  await step('An exact retry returns the one committed response receipt',async()=>{
   assert((await send(token,key,'1')).status===404,'Unexpected fixture outcome');
   const replay=await send(token,key,'1');assert(replay.status===404&&replay.replay==='true','Exact retry was not replayed');
   const [{n}]=await sql('SELECT count(*)::int n FROM hms_idempotency_keys WHERE user_id=$1 AND idempotency_key=$2',[actor.id,key]);assert(n===1,'More than one receipt');
  });
  await step('Reusing a key with a different reviewed revision is a conflict',async()=>{
   const r=await send(token,key,'2');assert(r.status===409&&r.data.code==='IDEMPOTENCY_KEY_CONFLICT','Changed revision replayed an older response');
  });
  await step('A valid session in another facility cannot replay the first facility receipt',async()=>{
   const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic receipt scope facility','UTC') RETURNING id",['RECEIPT-'+crypto.randomUUID()]);facility=f.id;
   await sql('INSERT INTO hms_facility_memberships(facility_id,user_id,reason) VALUES($1,$2,$3)',[facility,actor.id,body.reason]);
   const [s]=await sql("INSERT INTO hms_sessions(user_id,facility_id,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING id",[actor.id,facility]);session=s.id;
   const other=signSessionToken(actor,session,facility),r=await send(other,key,'1');assert(r.status===409&&r.data.code==='IDEMPOTENCY_KEY_CONFLICT','Wrong-facility replay accepted');
   assert(!r.data.legacy&&!r.replay,'Another facility received the first receipt');
  });
  await step('Historical receipts remain readable while unrecorded revision evidence requires reconciliation',async()=>{
   const legacyKey=crypto.randomUUID(),legacyHash=requestHash({method:'POST',originalUrl:'/api'+path,body},1);
   await sql(`INSERT INTO hms_idempotency_keys(user_id,facility_id,hash_version,idempotency_key,method,path,request_hash,request_id,state,response_status,response_body)
    VALUES($1,$2,1,$3,'POST',$4,$5,$6,'completed',200,'{"legacy":true}')`,[actor.id,initial,legacyKey,'/api'+path,legacyHash,crypto.randomUUID()]);
   const plain=await send(token,legacyKey);assert(plain.status===200&&plain.data.legacy&&plain.replay==='true','Legacy receipt lost');
   const versioned=await send(token,legacyKey,'1');assert(versioned.status===409&&versioned.data.code==='IDEMPOTENCY_LEGACY_RECONCILIATION_REQUIRED','Invented legacy revision evidence');
  });
 }finally{
  if(session)await sql("UPDATE hms_sessions SET revoked_at=now(),revoked_reason='Synthetic scope fixture finished' WHERE id=$1",[session]);
  if(facility)await sql("UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=$1,revocation_reason='Synthetic receipt scope fixture completed' WHERE facility_id=$2 AND revoked_at IS NULL",[actor.id,facility]);
 }
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
