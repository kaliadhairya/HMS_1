import type {Transaction} from 'sequelize';
const crypto=require('node:crypto'),net=require('node:net');
const {sequelize}=require('../models/db');
const {storage}=require('../utils/auditContext');
const F=require('./facilities.cts');
type Actor={id:number;role:string;facilityId:string;facilityTimezone:string};
type Authentication={key?:string;host?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
async function contractFor(system:string,auth:Authentication={},t:Transaction){
 const host=auth.host?.replace(/^::ffff:/,'');if(host&&!net.isIP(host))fail(401,'The transport peer is not an IP address.','HOST_REFUSED');
 const digest=auth.key===undefined?null:crypto.createHash('sha256').update(String(auth.key)).digest('hex');
 const [r]=await q('SELECT hms_device_ingress_binding(:system,:digest,CAST(:host AS inet)) binding',{system,digest,host:host||null},t);
 const c=r?.binding;
 if(!c||c.failure_code){const code=c?.failure_code||'DEVICE_BINDING_UNAVAILABLE';
  fail(code==='NO_CONTRACT'?404:code==='DEVICE_SERVICE_IDENTITY_REQUIRED'?403:401,
   ({NO_CONTRACT:'No active contract for this device.',BAD_KEY:'Device key refused.',HOST_REFUSED:'The device transport peer is not allowed.',DEVICE_AUTH_REQUIRED:'An approved device key or allowlisted MLLP peer is required.',DEVICE_SERVICE_IDENTITY_REQUIRED:'The contract requires an explicitly approved service account.'} as Record<string,string>)[code]||'Device binding could not be verified.',code);
 }
 return c;
}
async function withBinding<T>(t:Transaction,c:any,execute:(actor:Actor)=>Promise<T>):Promise<T>{
 await q("SET LOCAL statement_timeout='3s'",{},t);
 await q("SET LOCAL lock_timeout='500ms'",{},t);
 await q("SET LOCAL idle_in_transaction_session_timeout='5s'",{},t);
 await q("DO $$ BEGIN IF current_setting('server_version_num')::integer>=170000 THEN EXECUTE 'SET LOCAL transaction_timeout=''10s'''; END IF; END $$",{},t);
 const [u]=await q('SELECT id,role FROM hms_users WHERE id=:id AND is_active=1 FOR SHARE',{id:c.service_user_id},t);
 if(!u)fail(403,'The device service account is inactive.','DEVICE_ACCOUNT_INACTIVE');
 const [f]=await F.membership(u.id,c.facility_id,t);if(!f)fail(403,'The device service account requires current facility membership.','FACILITY_MEMBERSHIP_REQUIRED');
 const actor:Actor={id:u.id,role:u.role,facilityId:f.id,facilityTimezone:f.timezone};
 const store=storage.getStore()||{},command={active:true,transaction:t},requestId=store.requestId||crypto.randomUUID();
 const [previous]=await q(`SELECT current_setting('hms.actor_user_id',true) actor,current_setting('hms.session_id',true) session,
  current_setting('hms.request_id',true) request,current_setting('hms.facility_id',true) facility,current_setting('hms.facility_tz',true) timezone`,{},t);
 const bind=(values:Record<string,unknown>)=>q(`SELECT set_config('hms.actor_user_id',:actor,true),set_config('hms.session_id',:session,true),
  set_config('hms.request_id',:request,true),set_config('hms.facility_id',:facility,true),set_config('hms.facility_tz',:timezone,true)`,values,t);
 await bind({actor:String(actor.id),session:'',request:requestId,facility:f.id,timezone:f.timezone});
 let failed=false;
 try{return await storage.run({...store,requestId,userId:actor.id,sessionId:null,facilityId:f.id,facilityTimezone:f.timezone,actorType:'device',deviceContractId:c.id,command},async()=>{
  if(c.kind==='analyzer')await require('./laboratoryCommon').privilege(actor,'ANALYZER',t);
  return execute(actor);
 });}catch(error){failed=true;throw error;}
 finally{
  command.active=false;
  try{await bind({actor:previous?.actor||'',session:previous?.session||'',request:previous?.request||'',facility:previous?.facility||'',timezone:previous?.timezone||process.env.FACILITY_TZ||'Asia/Kolkata'});}
  catch(error){if(!failed)throw error;}
 }
}
module.exports={contractFor,withBinding};
