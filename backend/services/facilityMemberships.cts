import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),F=require('./facilities.cts'),I=require('./identities.cts'),Notes=require('./encounterNotes.cts'),{publish}=require('../utils/outbox');
type Actor={id:number;role:string;facilityId?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function object(value:unknown,keys:string[]):Record<string,any>{if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'Send a JSON object.','INVALID_REQUEST');for(const key of Object.keys(value))if(!keys.includes(key))fail(422,`Unsupported field ${key}.`,'UNSUPPORTED_FIELD');return value as Record<string,any>;}
function text(value:unknown,label:string,min=1,max=200):string{if(typeof value!=='string'||value.trim().length<min||value.length>max)fail(422,`${label} must be ${min}–${max} characters.`,'INVALID_FIELD_VALUE');return value.trim();}
const reason=(value:unknown)=>text(value,'Reason',10,1000);
async function admin(actor:Actor,t:Transaction){if(!['admin','super_admin'].includes(actor.role)||!(await F.membership(actor.id,actor.facilityId,t)).length)fail(403,'Current hospital administrator membership is required.','FACILITY_ADMIN_REQUIRED');}
async function create(input:unknown,actor:Actor,t:Transaction){
 await admin(actor,t);const b=object(input,['code','name','timezone','reason']),why=reason(b.reason),code=text(b.code,'Facility code',1,40).toUpperCase();if(!/^[A-Z0-9][A-Z0-9_-]*$/.test(code))fail(422,'Use letters, digits, underscores or hyphens for the facility code.','INVALID_FACILITY_CODE');
 const name=text(b.name,'Facility name'),timezone=text(b.timezone,'Timezone',1,80);const [valid]=await q('SELECT hms_valid_facility_timezone(:timezone) valid',{timezone},t);if(!valid.valid)fail(422,'Use a supported IANA timezone.','INVALID_TIMEZONE');
 const [f]=await q('INSERT INTO hms_facilities(code,name,timezone) VALUES(:code,:name,:timezone) RETURNING *',{code,name,timezone},t);
 await q('INSERT INTO hms_facility_memberships(facility_id,user_id,granted_by_user_id,reason) VALUES(:facility,:user,:user,:reason)',{facility:f.id,user:actor.id,reason:why},t);
 await q("INSERT INTO hms_audit_logs(user_id,action,module,new_value) VALUES(:user,'CREATE','clinical_facility',:value)",{user:actor.id,value:JSON.stringify({facility_id:f.id,reason:why,configuration_review_required:true})},t);return f;
}
async function update(input:unknown,actor:Actor,header:unknown,t:Transaction){
 await admin(actor,t);const b=object(input,['name','timezone','configuration_review_required','reason']),why=reason(b.reason);
 const [f]=await q('SELECT * FROM hms_facilities WHERE id=:facility FOR UPDATE',{facility:actor.facilityId},t);if(Notes.expected(header)!==f.revision)fail(412,'The facility configuration changed. Review its current version.','VERSION_STALE');
 const name=b.name===undefined?f.name:text(b.name,'Facility name'),timezone=b.timezone===undefined?f.timezone:text(b.timezone,'Timezone',1,80);
 if(timezone!==f.timezone){const [used]=await q('SELECT EXISTS(SELECT 1 FROM hms_encounters WHERE facility_id=:facility UNION ALL SELECT 1 FROM hms_admissions WHERE facility_id=:facility) used',{facility:actor.facilityId},t);if(used.used)fail(409,'An operating facility timezone needs a reviewed historical/calendar transition.','FACILITY_TIMEZONE_IN_USE');const [valid]=await q('SELECT hms_valid_facility_timezone(:timezone) valid',{timezone},t);if(!valid.valid)fail(422,'Use a supported IANA timezone.','INVALID_TIMEZONE');}
 if(b.configuration_review_required!==undefined&&typeof b.configuration_review_required!=='boolean')fail(422,'Configuration review status must be explicit.','INVALID_FIELD_VALUE');
 const [updated]=await q('UPDATE hms_facilities SET name=:name,timezone=:timezone,configuration_review_required=:review WHERE id=:facility RETURNING *',{name,timezone,review:b.configuration_review_required??f.configuration_review_required,facility:actor.facilityId},t);
 await q("INSERT INTO hms_audit_logs(user_id,action,module,new_value) VALUES(:user,'UPDATE','clinical_facility',:value)",{user:actor.id,value:JSON.stringify({facility_id:f.id,reason:why,revision:updated.revision})},t);return updated;
}
async function members(actor:Actor,t?:Transaction){return q(`SELECT m.*,u.public_id principal_id,u.username,u.name,u.role FROM hms_facility_memberships m JOIN hms_users u ON u.id=m.user_id WHERE m.facility_id=:facility ORDER BY u.name,m.created_at`,{facility:actor.facilityId},t);}
async function grant(input:unknown,actor:Actor,t:Transaction){
 await admin(actor,t);const b=object(input,['principal_id','valid_from','valid_until','reason']),why=reason(b.reason),principal=await I.locate('principal',b.principal_id,actor,t),user=I.legacyNumber(principal);
 const from=require('./medicationCommon').instant(b.valid_from,'Membership start'),until=b.valid_until===undefined||b.valid_until===null?null:require('./medicationCommon').instant(b.valid_until,'Membership end');if(until&&Date.parse(until)<=Date.parse(from))fail(422,'Membership end must follow its start.','INVALID_GRANT_WINDOW');
 const [u]=await q('SELECT id,is_active FROM hms_users WHERE id=:user FOR SHARE',{user},t);if(!u||u.is_active!==1)fail(422,'Choose an active staff account.','ACTIVE_STAFF_REQUIRED');
 const [m]=await q(`INSERT INTO hms_facility_memberships(facility_id,user_id,valid_from,valid_until,granted_by_user_id,reason) VALUES(:facility,:user,:from,:until,:actor,:reason) RETURNING *`,{facility:actor.facilityId,user,from,until,actor:actor.id,reason:why},t);
 await publish('clinical.authorization.changed',`user:${user}`,{facility_id:actor.facilityId,grant_kind:'membership',grant_id:m.id,revision:m.revision},{transaction:t});return m;
}
async function revoke(id:string,input:unknown,actor:Actor,header:unknown,t:Transaction){
 await admin(actor,t);const why=reason(object(input,['reason']).reason);if(!I.isUuid(id))fail(404,'Membership not found.','RESOURCE_NOT_FOUND');
 const [m]=await q('SELECT * FROM hms_facility_memberships WHERE id=:id AND facility_id=:facility FOR UPDATE',{id,facility:actor.facilityId},t);if(!m)fail(404,'Membership not found in this facility.','RESOURCE_NOT_FOUND');if(Notes.expected(header)!==m.revision)fail(412,'Membership changed. Review its current version.','VERSION_STALE');if(m.revoked_at)fail(409,'Membership is already revoked.','MEMBERSHIP_REVOKED');
 if(m.user_id===actor.id){const [other]=await q(`SELECT EXISTS(SELECT 1 FROM hms_facility_memberships x JOIN hms_users u ON u.id=x.user_id WHERE x.facility_id=:facility AND x.user_id<>:user AND x.revoked_at IS NULL AND x.valid_from<=now() AND (x.valid_until IS NULL OR x.valid_until>now()) AND u.role IN ('admin','super_admin') AND u.is_active=1) allowed`,{facility:actor.facilityId,user:actor.id},t);if(!other.allowed)fail(409,'Keep an active hospital administrator for this facility.','LAST_FACILITY_ADMIN');}
 const [revoked]=await q('UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=:actor,revocation_reason=:reason WHERE id=:id RETURNING *',{actor:actor.id,reason:why,id},t);
 await q("UPDATE hms_sessions SET revoked_at=now(),revoked_reason='facility membership revoked' WHERE user_id=:user AND facility_id=:facility AND revoked_at IS NULL",{user:m.user_id,facility:actor.facilityId},t);
 await publish('clinical.authorization.changed',`user:${m.user_id}`,{facility_id:actor.facilityId,grant_kind:'membership',grant_id:id,revision:revoked.revision,revoked:true},{transaction:t});return revoked;
}
async function available(user:number,t?:Transaction){return q(`SELECT f.id,f.code,f.name,f.timezone,f.configuration_review_required FROM hms_facility_memberships m JOIN hms_facilities f ON f.id=m.facility_id WHERE m.user_id=:user AND m.revoked_at IS NULL AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()) AND f.status='ACTIVE' ORDER BY f.name,f.id`,{user},t);}
module.exports={create,update,members,grant,revoke,available};
