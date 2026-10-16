import type {Transaction} from 'sequelize';
const crypto=require('node:crypto');
const {sequelize}=require('../models/db'),F=require('./facilities.cts'),W=require('./worklist');
const schema=require('../domain/interfaceContract.cts');
type Input={system:string;type:string;version:string|number;externalId?:string;correlationId?:string|null;endpoint?:string|null;payload?:unknown;patientId?:number|null;maxAttempts?:number;sentByCaller?:boolean;raw?:string};
type Actor={id:number;role:string;facilityId:string};
type Contract={ownerRole:string;versions:readonly string[];messageTypes:readonly string[];idempotency:'PROVIDER_KEY'|'RECONCILE'};
type Sender=(message:any)=>Promise<unknown>;
const handlers=new Map<string,{send:Sender;contract:Contract}>();
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
const one=async(sql:string,values:Record<string,unknown>,t?:Transaction)=>(await q(sql,values,t))[0]||null;
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function register(prefix:string,send:Sender,options:Contract):void {
 if(!options||!['PROVIDER_KEY','RECONCILE'].includes(options.idempotency)||!options.versions?.length||!options.messageTypes?.length)throw new Error('An explicit versioned interface delivery contract is required');
 handlers.set(prefix,{send,contract:options});
}
const handlerFor=(system:string)=>[...handlers.entries()].filter(([prefix])=>system===prefix||system.startsWith(prefix+':')).sort(([a],[b])=>b.length-a.length)[0]?.[1];
async function writer(t?:Transaction){const row=await one('SELECT epoch,cluster_id,role FROM hms_writer_fence WHERE singleton',{},t);if(!row||row.role!=='primary')fail(503,'External effects require the current primary.','EXTERNAL_EFFECTS_FENCED');return row;}
async function assertExternalAllowed(t?:Transaction):Promise<void>{
 if(process.env.HMS_EXTERNAL_EFFECTS!=='enabled')fail(503,'External delivery is disabled until explicitly enabled for this environment.','EXTERNAL_EFFECTS_DISABLED');
 const actor=require('../utils/auditContext').storage.getStore()?.userId;
 if(!Number.isSafeInteger(actor)||!(await F.membership(actor,F.currentFacilityId(),t)).length)fail(403,'External delivery requires a current approved service or staff membership.','FACILITY_MEMBERSHIP_REQUIRED');
 await writer(t);
}
function values(input:Input,direction:string){
 schema.validate(input);
 return {facility:F.currentFacilityId(),system:input.system,type:input.type,version:String(input.version),externalId:input.externalId??crypto.randomUUID(),correlationId:input.correlationId??null,endpoint:input.endpoint??null,payload:JSON.stringify(input.payload??null),patientId:input.patientId??null,raw:direction==='in'?input.raw??'':null,direction};
}
async function accept(input:Input,direction:'in'|'out',t?:Transaction):Promise<{message:any;duplicate:boolean}>{
 if(!t)return sequelize.transaction((tx:Transaction)=>accept(input,direction,tx));
 if(direction==='in'&&(typeof input.raw!=='string'||!input.externalId))fail(422,'Incoming raw content and stable message identity are required.','INVALID_INTERFACE_CONTRACT');
 const v=values(input,direction),fence=await writer(t),caller=direction==='out'&&!!input.sentByCaller;
 const context=require('../utils/auditContext').storage.getStore()||{};
 const inserted=await one(`INSERT INTO hms_interface_messages(direction,system,message_type,contract_version,external_id,correlation_id,endpoint,payload,raw,status,patient_id,facility_id,max_attempts,next_attempt_at,accepted_by_user_id,device_contract_id,delivery_epoch,delivery_cluster_id,caller_owned,lease_token,lease_until,attempts)
  VALUES(:direction,:system,:type,:version,:externalId,:correlationId,:endpoint,CAST(:payload AS jsonb),:raw,:status,:patientId,:facility,:maxAttempts,CASE WHEN :caller THEN 'infinity'::timestamptz ELSE now() END,:actor,:device,:epoch,:cluster,:caller,CAST(:token AS uuid),CASE WHEN :caller THEN now()+interval '2 minutes' ELSE NULL END,CASE WHEN :caller THEN 1 ELSE 0 END)
  ON CONFLICT(facility_id,system,direction,external_id,attempt_series) DO NOTHING RETURNING *`,
  {...v,status:direction==='out'?'Pending':'Received',maxAttempts:input.maxAttempts??8,caller,actor:context.userId??null,device:context.deviceContractId??null,epoch:fence.epoch,cluster:fence.cluster_id,token:caller?crypto.randomUUID():null},t);
 if(inserted)return {message:inserted,duplicate:false};
 const previous=await one(`SELECT *,hms_interface_fingerprint(:direction,:system,:type,:version,:correlationId,:endpoint,CAST(:payload AS jsonb),:raw,CASE WHEN CAST(:direction AS text) = 'in' THEN NULL ELSE CAST(:patientId AS integer) END,CAST(:facility AS uuid)) candidate_hash
  FROM hms_interface_messages WHERE facility_id=:facility AND system=:system AND direction=:direction AND external_id=:externalId AND attempt_series=0`,v,t);
 if(!previous||previous.request_fingerprint!==previous.candidate_hash||previous.max_attempts!==(input.maxAttempts??8)||previous.caller_owned!==caller||(direction==='in'&&input.patientId!=null&&previous.patient_id!==input.patientId))fail(409,'This external identity already belongs to a different message contract.','DUPLICATE_ID_DIFFERENT_CONTENT');
 return {message:previous,duplicate:true};
}
const enqueue=async(input:Input,t?:Transaction)=>(await accept(input,'out',t)).message;
const receive=(input:Input,t?:Transaction)=>accept(input,'in',t);
async function settle(id:string,status:string,extra:{error?:string;response?:unknown;patientId?:number;leaseToken?:string}={},t?:Transaction){
 const facility=F.currentFacilityId();
 if(!['Delivered','Failed','Processed','Rejected','Unmatched','Received'].includes(status))fail(422,'Invalid interface transition.','INVALID_MESSAGE_STATE');
 return one(`UPDATE hms_interface_messages SET status=:status,finished_at=CASE WHEN :status IN ('Unmatched','Received') THEN NULL ELSE now() END,
  last_error=coalesce(:error,last_error),response=coalesce(CAST(:response AS jsonb),response),patient_id=coalesce(:patientId,patient_id),lease_token=NULL,lease_until=NULL
  WHERE id=:id AND facility_id=:facility AND finished_at IS NULL AND
   ((direction='in' AND :status IN ('Received','Processed','Rejected','Unmatched')) OR
    (direction='out' AND :status IN ('Delivered','Failed') AND lease_token=CAST(:lease AS uuid) AND lease_until>now()
     AND EXISTS(SELECT 1 FROM hms_writer_fence f WHERE f.singleton AND f.role='primary' AND f.epoch=delivery_epoch AND f.cluster_id=delivery_cluster_id))) RETURNING *`,
  {id,facility,status,error:extra.error??null,response:extra.response===undefined?null:JSON.stringify(extra.response),patientId:extra.patientId??null,lease:extra.leaseToken??null},t);
}
const backoffSeconds=(attempt:number)=>Math.min(3600,5*2**Math.max(0,attempt-1));
async function event(m:any,phase:string,code:string,t:Transaction){return q(`INSERT INTO hms_interface_attempt_events(message_id,facility_id,attempt_number,lease_token,phase,code) VALUES(:id,:facility,:attempt,:token,:phase,:code)`,{id:m.id,facility:m.facility_id,attempt:m.attempts,token:m.lease_token,phase,code},t);}
async function hold(m:any,code:string,ownerRole:string,t:Transaction){
 const updated=await one(`UPDATE hms_interface_messages SET delivery_hold=true,next_attempt_at='infinity',last_error=:code,lease_token=NULL,lease_until=NULL
  WHERE id=:id AND facility_id=:facility AND status='Pending' AND lease_token=:token RETURNING id`,{id:m.id,facility:m.facility_id,token:m.lease_token,code},t);
 if(updated){await event(m,'HELD',code,t);await W.report({kind:'interface.outcome_unknown',key:m.id,title:'External delivery requires reconciliation before any further attempt.',detail:{message_id:m.id,code},ownerRole,patientId:m.patient_id},t);}
}
async function deliverDue({limit=10}:{limit?:number}={}){
 await assertExternalAllowed();
 if(!Number.isSafeInteger(limit)||limit<1||limit>100)fail(422,'Select a bounded delivery batch.','INVALID_BATCH');
 const facility=F.currentFacilityId();
 const due=await sequelize.transaction(async(t:Transaction)=>{
  const fence=await writer(t);
  const found=await q(`WITH candidates AS(SELECT id FROM hms_interface_messages WHERE facility_id=:facility AND direction='out' AND status='Pending'
   AND NOT caller_owned AND NOT delivery_hold AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<=now())
   ORDER BY next_attempt_at,id LIMIT :limit FOR UPDATE SKIP LOCKED)
   UPDATE hms_interface_messages m SET attempts=attempts+1,lease_generation=lease_generation+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',next_attempt_at=now()+interval '2 minutes'
   FROM candidates c WHERE m.id=c.id RETURNING m.*`,{facility,limit},t);
  for(const m of found){
   await event(m,'CLAIMED','CLAIMED',t);
   const h=handlerFor(m.system);
   if(m.delivery_epoch!==fence.epoch||m.delivery_cluster_id!==fence.cluster_id)await hold(m,'RECOVERY_RECONCILIATION_REQUIRED',h?.contract.ownerRole??'super_admin',t);
   else if(Number(m.lease_generation)>Number(m.authorized_retry_generation)&&h?.contract.idempotency!=='PROVIDER_KEY')await hold(m,'PREVIOUS_ATTEMPT_OUTCOME_UNKNOWN',h?.contract.ownerRole??'super_admin',t);
   else if(m.attempts>m.max_attempts){await settle(m.id,'Failed',{error:'Retry budget exhausted before delivery',leaseToken:m.lease_token},t);await event(m,'FAILED','RETRY_BUDGET_EXHAUSTED',t);await W.report({kind:'interface.delivery_failed',key:m.id,title:'An external message exhausted its retry budget.',detail:{message_id:m.id},ownerRole:h?.contract.ownerRole??'super_admin',patientId:m.patient_id},t);}
  }
  return found;
 });
 let delivered=0;
 for(const m of due){
  const h=handlerFor(m.system);
  const active=await one("SELECT id FROM hms_interface_messages WHERE id=:id AND facility_id=:facility AND lease_token=:token AND NOT delivery_hold AND lease_until>now()",{id:m.id,facility,token:m.lease_token});
  if(!active)continue;
  try{
   if(!h||!schema.supports(h.contract,m.message_type,m.contract_version))throw Object.assign(new Error('Unsupported interface contract version or message type.'),{permanent:true,beforeSend:true});
   await assertExternalAllowed();
   const currentWriter=await writer();
   if(currentWriter.epoch!==m.delivery_epoch||currentWriter.cluster_id!==m.delivery_cluster_id){await sequelize.transaction((t:Transaction)=>hold(m,'RECOVERY_RECONCILIATION_REQUIRED',h.contract.ownerRole,t));continue;}
   const response=await h.send(m);
   await sequelize.transaction(async(t:Transaction)=>{
    const saved=await settle(m.id,'Delivered',{response:response??{ok:true},leaseToken:m.lease_token},t);
    await event(m,saved?'DELIVERED':'STALE',saved?'ACKNOWLEDGED':'STALE_COMPLETION_REFUSED',t);
    if(saved)delivered++;
   });
  }catch(error){
   const err=error as {message?:string;permanent?:boolean;beforeSend?:boolean};
   await sequelize.transaction(async(t:Transaction)=>{
    const current=await one('SELECT id FROM hms_interface_messages WHERE id=:id AND facility_id=:facility AND lease_token=:token AND lease_until>now() FOR UPDATE',{id:m.id,facility,token:m.lease_token},t);
    if(!current){await event(m,'STALE','STALE_FAILURE_REFUSED',t);return;}
    const detail=String(err.message||'External delivery failed').slice(0,1000);
    if(!err.beforeSend&&h?.contract.idempotency!=='PROVIDER_KEY')return hold(m,'EXTERNAL_OUTCOME_UNKNOWN',h?.contract.ownerRole??'super_admin',t);
    if(err.permanent||m.attempts>=m.max_attempts){
     const saved=await settle(m.id,'Failed',{error:detail,leaseToken:m.lease_token},t);
     if(saved){await event(m,'FAILED','DELIVERY_FAILED',t);await W.report({kind:'interface.delivery_failed',key:m.id,title:'An external message exhausted its delivery contract.',detail:{message_id:m.id},ownerRole:h?.contract.ownerRole??'super_admin',patientId:m.patient_id},t);}
    }else{
     await q(`UPDATE hms_interface_messages SET last_error=:error,next_attempt_at=now()+make_interval(secs=>:delay),lease_token=NULL,lease_until=NULL,authorized_retry_generation=lease_generation+1 WHERE id=:id AND facility_id=:facility AND lease_token=:token`,{id:m.id,facility,token:m.lease_token,error:detail,delay:backoffSeconds(m.attempts)},t);
     await event(m,'RETRY_WAIT','SAFE_RETRY_SCHEDULED',t);
    }
   });
  }
 }
 return {claimed:due.length,delivered};
}
function startInterfaceWorker(){
 if(process.env.INTERFACE_WORKER==='off'||process.env.HMS_EXTERNAL_EFFECTS!=='enabled')return ()=>{};
 let inFlight:Promise<unknown>|null=null;
 const timer=setInterval(()=>{if(!inFlight)inFlight=require('./workerContext.cts').forEachFacility('interfaces',()=>deliverDue()).catch((e:Error)=>console.error('Interface delivery failed:',e.message)).finally(()=>{inFlight=null;});},Number(process.env.INTERFACE_POLL_MS||2000));timer.unref();
 return async()=>{clearInterval(timer);await inFlight;};
}
const list=({system=null,status=null,direction=null,limit=200}:{system?:string|null;status?:string|null;direction?:string|null;limit?:number}={},t?:Transaction)=>q(`SELECT id,direction,system,message_type,contract_version,external_id,correlation_id,status,attempts,max_attempts,next_attempt_at,last_error,patient_id,created_at,finished_at,delivery_hold,attempt_series,lease_generation
 FROM hms_interface_messages WHERE facility_id=:facility AND (:system::text IS NULL OR system=:system) AND (:status::text IS NULL OR status=:status) AND (:direction::text IS NULL OR direction=:direction) ORDER BY created_at DESC,id LIMIT :limit`,{facility:F.currentFacilityId(),system,status,direction,limit:Math.min(500,Math.max(1,Number(limit)||200))},t);
async function retry(id:string,actor:Actor,t:Transaction,review:{reason?:string;evidence_ref?:string}={}){
 if(!['admin','super_admin'].includes(actor.role)||actor.facilityId!==F.currentFacilityId()||!(await F.membership(actor.id,actor.facilityId,t)).length)fail(403,'A current facility administrator must review delivery.','DELIVERY_REVIEW_REQUIRED');
 if(typeof review.reason!=='string'||review.reason.trim().length<10||review.reason.length>1000||typeof review.evidence_ref!=='string'||review.evidence_ref.trim().length<5||review.evidence_ref.length>500)fail(422,'Record the reviewed reason and provider evidence reference.','DELIVERY_EVIDENCE_REQUIRED');
 const m=await one("SELECT * FROM hms_interface_messages WHERE id=:id AND facility_id=:facility AND direction='out' FOR UPDATE",{id,facility:actor.facilityId},t);
 if(!m)fail(404,'Message not found.','MESSAGE_NOT_FOUND');
 const existing=await one('SELECT * FROM hms_interface_messages WHERE retry_of=:id AND facility_id=:facility',{id,facility:actor.facilityId},t);if(existing)return existing;
 if(m.status!=='Failed'||m.caller_owned||m.last_error==='RECONCILIATION_SUPPRESSED')fail(409,'Only a failed, replayable delivery can start another series.','NOT_RETRYABLE');
 const fence=await writer(t);
 await q(`INSERT INTO hms_interface_delivery_reviews(message_id,facility_id,decision,actor_user_id,reason,evidence_ref) VALUES(:id,:facility,'RETRY_FAILED',:actor,:reason,:evidence)`,{id,facility:actor.facilityId,actor:actor.id,reason:review.reason,evidence:review.evidence_ref},t);
 return one(`INSERT INTO hms_interface_messages(direction,system,message_type,contract_version,external_id,correlation_id,endpoint,payload,status,patient_id,facility_id,max_attempts,attempt_series,retry_of,delivery_key,delivery_epoch,delivery_cluster_id)
  VALUES('out',:system,:type,:version,:external,:correlation,:endpoint,CAST(:payload AS jsonb),'Pending',:patient,:facility,:max,:series,:parent,:key,:epoch,:cluster) RETURNING *`,{system:m.system,type:m.message_type,version:m.contract_version,external:m.external_id,correlation:m.correlation_id,endpoint:m.endpoint,payload:JSON.stringify(m.payload),patient:m.patient_id,facility:actor.facilityId,max:m.max_attempts,series:m.attempt_series+1,parent:m.id,key:m.delivery_key,epoch:fence.epoch,cluster:fence.cluster_id},t);
}
async function reviewDelivery(id:string,input:{decision?:string;reason?:string;evidence_ref?:string},actor:Actor,t:Transaction){
 if(!['admin','super_admin'].includes(actor.role)||actor.facilityId!==F.currentFacilityId()||!(await F.membership(actor.id,actor.facilityId,t)).length)fail(403,'A current facility administrator must review delivery.','DELIVERY_REVIEW_REQUIRED');
 if(!['CONFIRMED_DELIVERED','CONFIRMED_NOT_DELIVERED','SUPPRESS'].includes(input.decision||'')||typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.length>1000||typeof input.evidence_ref!=='string'||input.evidence_ref.trim().length<5||input.evidence_ref.length>500)fail(422,'Record the provider decision, reason and evidence reference.','DELIVERY_EVIDENCE_REQUIRED');
 const m=await one("SELECT * FROM hms_interface_messages WHERE id=:id AND facility_id=:facility AND direction='out' FOR UPDATE",{id,facility:actor.facilityId},t);
 if(!m)fail(404,'Message not found.','MESSAGE_NOT_FOUND');
 if(!m.delivery_hold||m.status!=='Pending'||m.caller_owned)fail(409,'This message does not await delivery review.','NOT_HELD');
 const fence=await writer(t);
 await q(`INSERT INTO hms_interface_delivery_reviews(message_id,facility_id,decision,actor_user_id,reason,evidence_ref) VALUES(:id,:facility,:decision,:actor,:reason,:evidence)`,{id,facility:actor.facilityId,decision:input.decision,actor:actor.id,reason:input.reason,evidence:input.evidence_ref},t);
 if(input.decision==='CONFIRMED_NOT_DELIVERED')return one(`UPDATE hms_interface_messages SET delivery_hold=false,next_attempt_at=now(),last_error=NULL,lease_token=NULL,lease_until=NULL,delivery_epoch=:epoch,delivery_cluster_id=:cluster,authorized_retry_generation=lease_generation+1 WHERE id=:id AND facility_id=:facility RETURNING *`,{id,facility:actor.facilityId,epoch:fence.epoch,cluster:fence.cluster_id},t);
 return one(`UPDATE hms_interface_messages SET status=:status,finished_at=now(),delivery_hold=false,lease_token=NULL,lease_until=NULL,last_error=:code,response=CAST(:response AS jsonb) WHERE id=:id AND facility_id=:facility RETURNING *`,{id,facility:actor.facilityId,status:input.decision==='CONFIRMED_DELIVERED'?'Delivered':'Failed',code:input.decision==='SUPPRESS'?'RECONCILIATION_SUPPRESSED':'RECONCILIATION_CONFIRMED',response:JSON.stringify({reconciled:true,evidence_ref:input.evidence_ref})},t);
}
module.exports={register,enqueue,receive,settle,deliverDue,startInterfaceWorker,list,retry,reviewDelivery,backoffSeconds,assertExternalAllowed};
