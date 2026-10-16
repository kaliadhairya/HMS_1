import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db');
type Actor={id:number;role:string;sessionId?:string;facilityId?:string;facilityTimezone?:string};
const rows=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT'});
const uuid=(value:unknown)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value));
function currentFacilityId():string{const id=require('../utils/auditContext').storage.getStore()?.facilityId;if(!uuid(id))fail(403,'An authenticated facility context is required.','FACILITY_CONTEXT_REQUIRED');return id;}
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
const membership=(userId:number,facilityId:string,t?:Transaction)=>rows(`SELECT f.id,f.name,f.timezone FROM hms_facility_memberships m JOIN hms_facilities f ON f.id=m.facility_id
 JOIN hms_users u ON u.id=m.user_id WHERE m.user_id=:user AND m.facility_id=:facility AND u.is_active=1 AND f.status='ACTIVE'
 AND m.revoked_at IS NULL AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now())${t?' FOR SHARE OF m,f,u':''}`,{user:userId,facility:facilityId},t);
async function initialForUser(userId:number,t?:Transaction){
 const allowed=await rows(`SELECT f.id,f.name,f.timezone FROM hms_facility_memberships m JOIN hms_facilities f ON f.id=m.facility_id
 WHERE m.user_id=:user AND f.status='ACTIVE' AND m.revoked_at IS NULL AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now())
 ORDER BY (f.id=hms_initial_facility()) DESC,m.created_at,f.id`,{user:userId},t);
 if(!allowed.length)fail(403,'No active facility membership. Ask your hospital administrator.','FACILITY_MEMBERSHIP_REQUIRED');return allowed[0];
}
async function sessionFacility(actor:Actor,asserted?:unknown,t?:Transaction){
 if(!uuid(actor.sessionId))fail(401,'A verified session identity is required.','FACILITY_SESSION_REQUIRED');
 const [s]=await rows(`SELECT facility_id FROM hms_sessions WHERE id=:sid AND user_id=:user AND revoked_at IS NULL AND expires_at>now()`,{sid:actor.sessionId,user:actor.id},t);
 if(!s)fail(401,'The facility-bound session is not valid.','FACILITY_SESSION_INVALID');
 if(asserted!==undefined&&asserted!==null&&String(asserted)!==s.facility_id)fail(403,'Session facility context does not match.','FACILITY_BINDING_MISMATCH');
 const [f]=await membership(actor.id,s.facility_id,t);if(!f)fail(403,'Your facility membership is inactive or expired.','FACILITY_MEMBERSHIP_REQUIRED');
 return {facilityId:f.id,facilityTimezone:f.timezone};
}
async function requirePrivilege(actor:Actor,action:string,t?:Transaction){
 if(!actor.facilityId||!uuid(actor.facilityId))fail(403,'Clinical work requires an authorized facility.','FACILITY_CONTEXT_REQUIRED');
 if(!(await membership(actor.id,actor.facilityId,t)).length)fail(403,'Current facility membership is required.','FACILITY_MEMBERSHIP_REQUIRED');
 const approved=await rows(`SELECT x.id FROM hms_clinical_privileges x JOIN hms_practitioner_roles r ON r.id=x.practitioner_role_id
 JOIN hms_practitioners p ON p.id=r.practitioner_id JOIN hms_users u ON u.id=p.user_id
 JOIN hms_practitioner_credentials c ON c.practitioner_id=p.id
 WHERE p.user_id=:user AND r.facility_id=:facility AND u.is_active=1 AND x.action=:action
 AND hms_current_professional_credential(u.id,r.role) AND hms_role_permits_action(r.role,x.action)
 AND r.revoked_at IS NULL AND r.valid_from<=now() AND r.valid_until>now()
 AND x.revoked_at IS NULL AND x.valid_from<=now() AND x.valid_until>now()${t?' FOR SHARE OF x,r,p,u,c':''}`,{user:actor.id,facility:actor.facilityId,action},t);
 if(!approved.length)fail(403,'A current facility-specific clinical privilege is required.','CLINICAL_PRIVILEGE_REQUIRED');
}
module.exports={membership,initialForUser,sessionFacility,requirePrivilege,currentFacilityId};
