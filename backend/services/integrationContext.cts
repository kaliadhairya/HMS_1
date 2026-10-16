import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),{storage}=require('../utils/auditContext'),F=require('./facilities.cts');
const q=(sql:string,replacements:Record<string,unknown>,transaction:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
async function withAccount<T>(t:Transaction,userId:number,facilityId:string,label:string,execute:()=>Promise<T>):Promise<T>{
 if(!Number.isSafeInteger(userId)||userId<1||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(facilityId||''))throw Object.assign(new Error('An explicit approved integration account and facility are required.'),{status:503,code:'INTEGRATION_BINDING_REQUIRED'});
 const [facility]=await F.membership(userId,facilityId,t);
 if(!facility)throw Object.assign(new Error('The integration account has no current facility membership.'),{status:403,code:'INTEGRATION_MEMBERSHIP_REQUIRED'});
 const [old]=await q(`SELECT current_setting('hms.actor_user_id',true) actor,current_setting('hms.facility_id',true) facility,current_setting('hms.session_id',true) session,current_setting('hms.facility_tz',true) timezone`,{},t);
 const bind=(actor:string,facility:string,session:string,timezone:string)=>q(`SELECT set_config('hms.actor_user_id',:actor,true),set_config('hms.facility_id',:facility,true),set_config('hms.session_id',:session,true),set_config('hms.facility_tz',:timezone,true)`,{actor,facility,session,timezone},t);
 await bind(String(userId),facilityId,'',facility.timezone);
 const command={active:true,transaction:t};let failed=false;
 try{return await storage.run({...storage.getStore(),userId,facilityId,facilityTimezone:facility.timezone,sessionId:null,actorType:'integration',integration:label,command},execute);}
 catch(error){failed=true;throw error;}
 finally{command.active=false;try{await bind(old?.actor||'',old?.facility||'',old?.session||'',old?.timezone||'Asia/Kolkata');}catch(error){if(!failed)throw error;}}
}
module.exports={withAccount};
