import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),{patientInCare}=require('../utils/careTeam'),{publish}=require('../utils/outbox');
const F=require('./facilities.cts');
type Actor={id:number;role:string;facilityId?:string};
type CreateInput={patient_id:number;token_id?:number|null;appointment_id?:number|null;department_id?:number|null;chief_complaint?:string|null;encounter_type?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function positive(value:unknown,field:string,optional=false):number|null{
 if(optional&&(value===null||value===undefined||value===''))return null;
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail(422,`${field} must identify a valid resource.`,'INVALID_ID');return n;
}
async function available(patientId:number,actor:Actor,t:Transaction){
 if(actor.role!=='doctor')fail(403,'A responsible doctor must select the visit.','RESPONSIBLE_DOCTOR_REQUIRED');
 await F.requirePrivilege(actor,'CHART_READ',t);await F.requirePrivilege(actor,'CLINICAL_SIGN',t);
 const patient=positive(patientId,'Patient');
 if(!(await patientInCare(actor.id,patient,t)))fail(403,'The patient is not in your care.','PATIENT_NOT_IN_CARE');
 const context={patient,doctor:actor.id,facility:actor.facilityId};
 const tokens=await q(`SELECT id,public_id,token_number,status,token_date,department_id FROM hms_tokens WHERE patient_id=:patient AND doctor_id=:doctor AND facility_id=:facility
  AND trunc(token_date)=hms_service_today() AND status='Waiting' ORDER BY id LIMIT 100`,context,t);
 const appointments=await q(`SELECT id,public_id,status,appointment_date,slot_start,department_id FROM hms_appointments WHERE patient_id=:patient AND doctor_id=:doctor AND facility_id=:facility
  AND trunc(appointment_date)=hms_service_today() AND status IN ('Scheduled','Checked-in') ORDER BY slot_start,id LIMIT 100`,context,t);
 return {tokens,appointments};
}
async function create(input:CreateInput,actor:Actor,t:Transaction){
 if(actor.role!=='doctor')fail(403,'A responsible doctor must start the consultation.','RESPONSIBLE_DOCTOR_REQUIRED');
 await F.requirePrivilege(actor,'CHART_READ',t);await F.requirePrivilege(actor,'CLINICAL_SIGN',t);
 const patient=positive(input.patient_id,'Patient');
 const [p]=await q('SELECT id,identity_status,merged_into_patient_id,is_active FROM hms_patients WHERE id=:id FOR SHARE',{id:patient},t);
 if(!p)fail(404,'Patient not found.','RESOURCE_NOT_FOUND');
 if(p.identity_status==='merged')fail(409,'This identity was merged; review the canonical patient before starting care.','PATIENT_MERGED');
 if(Number(p.is_active)!==1)fail(409,'New care cannot start against an inactive patient identity.','PATIENT_INACTIVE');
 if(!(await patientInCare(actor.id,patient,t)))fail(403,'The patient must be in your care before starting a consultation.','PATIENT_NOT_IN_CARE');
 const tokenId=positive(input.token_id,'Token',true),appointmentId=positive(input.appointment_id,'Appointment',true);
 let token:any,appointment:any;
 if(tokenId)[token]=await q('SELECT * FROM hms_tokens WHERE id=:id AND facility_id=:facility FOR UPDATE',{id:tokenId,facility:actor.facilityId},t);
 if(appointmentId)[appointment]=await q('SELECT * FROM hms_appointments WHERE id=:id AND facility_id=:facility FOR UPDATE',{id:appointmentId,facility:actor.facilityId},t);
 if(!tokenId&&!appointmentId){
  // Compatibility callers may omit a visit only when its exact patient and
  // responsible practitioner identify one available visit. Never guess
  // between two visits or attach an unrelated token and appointment together.
  const tokens=await q(`SELECT * FROM hms_tokens WHERE patient_id=:patient AND doctor_id=:doctor AND facility_id=:facility
   AND trunc(token_date)=hms_service_today() AND status='Waiting' ORDER BY id LIMIT 2 FOR UPDATE`,{patient,doctor:actor.id,facility:actor.facilityId},t);
  const appointments=await q(`SELECT * FROM hms_appointments WHERE patient_id=:patient AND doctor_id=:doctor AND facility_id=:facility
   AND trunc(appointment_date)=hms_service_today() AND status IN ('Scheduled','Checked-in') ORDER BY id LIMIT 2 FOR UPDATE`,{patient,doctor:actor.id,facility:actor.facilityId},t);
  if(tokens.length+appointments.length>1)fail(409,'More than one available visit exists. Select the exact token or appointment.','VISIT_SELECTION_REQUIRED');
  token=tokens[0];appointment=appointments[0];
 }
 for(const [visit,id] of [[token,tokenId],[appointment,appointmentId]]){
  if(id&&!visit)fail(404,'The selected visit is not available in this facility.','RESOURCE_NOT_FOUND');
  if(visit&&(Number(visit.patient_id)!==patient||Number(visit.doctor_id)!==actor.id))fail(409,'The selected visit does not belong to this patient and responsible doctor.','VISIT_CONTEXT_MISMATCH');
 }
 if(token&&token.status!=='Waiting')fail(409,'The token is no longer waiting. Review the existing consultation.','VISIT_NOT_AVAILABLE');
 if(appointment&&!['Scheduled','Checked-in'].includes(appointment.status))fail(409,'The appointment is no longer available for consultation.','VISIT_NOT_AVAILABLE');
 if(token||appointment){const existing=await q(`SELECT id FROM hms_encounters WHERE facility_id=:facility AND
  ((CAST(:token AS integer) IS NOT NULL AND token_id=:token) OR (CAST(:appointment AS integer) IS NOT NULL AND appointment_id=:appointment)) LIMIT 1`,{facility:actor.facilityId,token:token?.id||null,appointment:appointment?.id||null},t);
  if(existing.length)fail(409,'This visit already has a consultation. Open the existing encounter.','VISIT_ALREADY_STARTED');
 }
 let department=positive(input.department_id,'Department',true)||token?.department_id||appointment?.department_id||null;
 if(!department){const departments=await q('SELECT DISTINCT department_id FROM hms_doctors WHERE user_id=:id AND department_id IS NOT NULL ORDER BY department_id LIMIT 2',{id:actor.id},t);if(departments.length>1)fail(409,'Select the department for this encounter.','DEPARTMENT_SELECTION_REQUIRED');department=departments[0]?.department_id||null;}
 if(department&&!(await q('SELECT id FROM hms_departments WHERE id=:id',{id:department},t)).length)fail(422,'The department is not valid.','INVALID_DEPARTMENT');
 const complaint=input.chief_complaint??null;
 if(complaint!==null&&(typeof complaint!=='string'||complaint.length>5000))fail(422,'Chief complaint must be text of at most 5,000 characters.','INVALID_CLINICAL_NOTE');
 const type=input.encounter_type||'OPD';if(!['OPD','IPD','Emergency'].includes(type))fail(422,'Choose OPD, IPD or Emergency encounter type.','INVALID_ENCOUNTER_TYPE');
 const [e]=await q(`INSERT INTO hms_encounters(id,patient_id,doctor_id,department_id,token_id,appointment_id,chief_complaint,encounter_date,encounter_type,status)
  VALUES(nextval('hms_encounters_seq'),:patient,:doctor,:department,:token,:appointment,:complaint,now(),:type,'Draft') RETURNING *`,{patient,doctor:actor.id,department,token:token?.id||null,appointment:appointment?.id||null,complaint,type},t);
 if(token)await q("UPDATE hms_tokens SET status='In Consultation' WHERE id=:id",{id:token.id},t);
 await publish('clinical.encounter.started',`user:${actor.id}`,{patient_id:patient,encounter_id:e.id},{transaction:t});
 return e;
}
module.exports={create,available};
