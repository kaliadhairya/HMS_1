import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db');
const F=require('./facilities.cts');
const {expected}=require('./encounterNotes.cts');
const {instant}=require('./medicationCommon');
type Actor={id:number;role:string;facilityId?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT'});
const uuid=(v:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v));
const epoch=(v:Date|string)=>v instanceof Date?v.getTime():Date.parse(v);
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function reason(v:unknown):string{if(typeof v!=='string'||v.trim().length<10||v.length>1000)fail(422,'Record a reason of 10–1000 characters.','GRANT_REASON_REQUIRED');return v.trim();}
function window(input:any){const from=instant(input.validFrom,'Valid-from'),until=instant(input.validUntil,'Valid-until');if(until<=from)fail(422,'Valid-until must follow valid-from.','INVALID_GRANT_WINDOW');return {from,until};}
async function admin(actor:Actor,t:Transaction){
 if(!['admin','super_admin'].includes(actor.role)||!actor.facilityId)fail(403,'Hospital administration permission is required.','FACILITY_ADMIN_REQUIRED');
 if(!(await F.membership(actor.id,actor.facilityId,t)).length)fail(403,'Current administrator facility membership is required.','FACILITY_MEMBERSHIP_REQUIRED');
}
async function grantRole(actor:Actor,input:any,t:Transaction){
 await admin(actor,t);const explanation=reason(input.reason),{from,until}=window(input);
 if(!uuid(input.practitionerId)||!['doctor','nurse','pharmacist','lab_technician'].includes(input.role))fail(422,'Select an explicit practitioner UUID and professional role.','INVALID_PROFESSIONAL_ROLE');
 const [p]=await q('SELECT id,user_id FROM hms_practitioners WHERE public_id=:id FOR SHARE',{id:input.practitionerId},t);
 if(!p)fail(404,'Practitioner not found.','NOT_FOUND');if(p.user_id===actor.id)fail(403,'An administrator cannot grant their own clinical role.','INDEPENDENT_APPROVAL_REQUIRED');
 if(!(await F.membership(p.user_id,actor.facilityId,t)).length)fail(403,'The practitioner needs current membership in this facility.','FACILITY_MEMBERSHIP_REQUIRED');
 // Lock credential rows so an independently requested revocation drains
 // this bounded approval transaction before its new state becomes visible.
 await q('SELECT id FROM hms_practitioner_credentials WHERE practitioner_id=:id FOR SHARE',{id:p.id},t);
 const [c]=await q('SELECT hms_current_professional_credential(:user,:role) approved',{user:p.user_id,role:input.role},t);
 if(!c?.approved)fail(403,'Current independently verified professional credentials are required.','PROFESSIONAL_CREDENTIAL_REQUIRED');
 const [r]=await q(`INSERT INTO hms_practitioner_roles(practitioner_id,facility_id,role,valid_from,valid_until,granted_by_user_id,reason)
 VALUES(:practitioner,:facility,:role,:from,:until,:actor,:reason) RETURNING *`,{practitioner:p.id,facility:actor.facilityId,role:input.role,from,until,actor:actor.id,reason:explanation},t);
 await require('../utils/outbox').publish('clinical.authorization.changed',`user:${p.user_id}`,{facility_id:actor.facilityId,role_id:r.id,revision:r.revision},{transaction:t});return r;
}
async function grantPrivilege(actor:Actor,roleId:string,input:any,header:unknown,t:Transaction){
 await admin(actor,t);if(!uuid(roleId))fail(404,'Professional role not found.','NOT_FOUND');
 const explanation=reason(input.reason),{from,until}=window(input);
 const [r]=await q(`SELECT r.*,p.user_id FROM hms_practitioner_roles r JOIN hms_practitioners p ON p.id=r.practitioner_id
 WHERE r.id=:id AND r.facility_id=:facility FOR UPDATE OF r`,{id:roleId,facility:actor.facilityId},t);
 if(!r)fail(404,'Professional role not found in this facility.','NOT_FOUND');
 if(r.user_id===actor.id)fail(403,'An administrator cannot grant their own clinical privileges.','INDEPENDENT_APPROVAL_REQUIRED');
 if(expected(header)!==r.revision)fail(412,'The professional role changed. Review its current state.','VERSION_STALE');
 if(r.revoked_at||epoch(r.valid_until)<=Date.now())fail(409,'An inactive professional role cannot receive privileges.','ROLE_INACTIVE');
 const [valid]=await q('SELECT hms_role_permits_action(:role,:action) allowed',{role:r.role,action:String(input.action)},t);
 if(!valid.allowed||epoch(from)<epoch(r.valid_from)||epoch(until)>epoch(r.valid_until))fail(422,'The action and validity window must belong to this professional role.','INVALID_CLINICAL_PRIVILEGE');
 if(!(await F.membership(r.user_id,actor.facilityId,t)).length)fail(403,'Current practitioner facility membership is required.','FACILITY_MEMBERSHIP_REQUIRED');
 await q('SELECT id FROM hms_practitioner_credentials WHERE practitioner_id=:id FOR SHARE',{id:r.practitioner_id},t);
 const [c]=await q('SELECT hms_current_professional_credential(:user,:role) approved',{user:r.user_id,role:r.role},t);
 if(!c.approved)fail(403,'Current independently verified professional credentials are required.','PROFESSIONAL_CREDENTIAL_REQUIRED');
 const [grant]=await q(`INSERT INTO hms_clinical_privileges(practitioner_role_id,action,valid_from,valid_until,granted_by_user_id,reason)
 VALUES(:id,:action,:from,:until,:actor,:reason) RETURNING *`,{id:roleId,action:input.action,from,until,actor:actor.id,reason:explanation},t);
 await q('UPDATE hms_practitioner_roles SET revision=revision+1 WHERE id=:id',{id:roleId},t);
 await require('../utils/outbox').publish('clinical.authorization.changed',`user:${r.user_id}`,{facility_id:actor.facilityId,role_id:roleId,privilege_id:grant.id,revision:r.revision+1},{transaction:t});
 return {grant,roleRevision:r.revision+1};
}
async function revoke(actor:Actor,kind:'role'|'privilege',id:string,input:any,header:unknown,t:Transaction){
 await admin(actor,t);if(!uuid(id))fail(404,'Grant not found.','NOT_FOUND');const explanation=reason(input.reason);
 const table=kind==='role'?'hms_practitioner_roles':'hms_clinical_privileges';
 const join=kind==='role'?'':' JOIN hms_practitioner_roles r ON r.id=g.practitioner_role_id';
 const [g]=await q(`SELECT g.* FROM ${table} g${join} WHERE g.id=:id AND ${kind==='role'?'g':'r'}.facility_id=:facility FOR UPDATE OF g`,{id,facility:actor.facilityId},t);
 if(!g)fail(404,'Grant not found in this facility.','NOT_FOUND');if(expected(header)!==g.revision)fail(412,'This grant changed. Review the current revision.','VERSION_STALE');
 if(g.revoked_at)fail(409,'The grant is already revoked.','GRANT_REVOKED');
 // Existing grant values remain unchanged; revocation evidence also enters
 // the transactional row audit and human-readable activity audit.
 const [r]=await q(`UPDATE ${table} SET revoked_at=now(),revoked_by_user_id=:actor,revocation_reason=:reason,revision=revision+1 WHERE id=:id RETURNING *`,{id,actor:actor.id,reason:explanation},t);
 await q(`INSERT INTO hms_audit_logs(user_id,action,module,new_value) VALUES(:actor,'REVOKE',:module,:change)`,{actor:actor.id,module:kind==='role'?'practitioner_role':'clinical_privilege',change:JSON.stringify({id,reason:explanation,facilityId:actor.facilityId,revision:r.revision})},t);
 const [target]=await q(`SELECT p.user_id FROM hms_practitioner_roles x JOIN hms_practitioners p ON p.id=x.practitioner_id WHERE x.id=:role`,{role:kind==='role'?id:g.practitioner_role_id},t);
 await require('../utils/outbox').publish('clinical.authorization.changed',`user:${target.user_id}`,{facility_id:actor.facilityId,grant_kind:kind,grant_id:id,revision:r.revision,revoked:true},{transaction:t});
 return r;
}
module.exports={grantRole,grantPrivilege,revoke};
