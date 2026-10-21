// Admissions through the v2 API (completion A3). A transfer names the admission and the
// target bed by public identifier, and must state the admission version it was based on
// (If-Match). The same locks, bed rules and occupancy records as the legacy transfer apply.
const I=require('./identities.cts');
const {sequelize}=require('../models/db');
const {QueryTypes}=require('sequelize');
const {openOccupancy,closeOccupancy}=require('../utils/adt');
const {logAction}=require('../utils/auditLogger');
type Actor={id:number;role:string;facilityId?:string;ip?:string};
const WARD_STAFF=['super_admin','admin','nurse','doctor'];
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function canWardAct(actor:Actor){if(!WARD_STAFF.includes(actor.role))fail(403,'Your role cannot move patients between beds.','ROLE_NOT_PERMITTED');}
const rows=(sql:string,replacements:any,t:any):Promise<any[]>=>sequelize.query(sql,{replacements,type:QueryTypes.SELECT,transaction:t});
const execute=(sql:string,replacements:any,t:any)=>sequelize.query(sql,{replacements,type:QueryTypes.UPDATE,transaction:t});

function expectedVersion(ifMatch:any):number{
 if(ifMatch===undefined||ifMatch===null||ifMatch==='')fail(428,'If-Match with the admission version is required.','PRECONDITION_REQUIRED');
 const v=Number(String(ifMatch).replace(/"/g,''));
 if(!Number.isSafeInteger(v)||v<1)fail(400,'If-Match must be the admission version.','INVALID_PRECONDITION');
 return v;
}

async function projection(admissionLegacyId:number,t:any){
 const [row]=await rows(`SELECT a.public_id,a.api_version,a.status,a.admission_date,b.public_id AS bed_public,p.public_id AS patient_public
   FROM hms_admissions a JOIN hms_patients p ON p.id=a.patient_id LEFT JOIN hms_beds b ON b.id=a.bed_id WHERE a.id=:id`,{id:admissionLegacyId},t);
 return {id:row.public_id,version:Number(row.api_version),patient_id:row.patient_public,bed_id:row.bed_public??null,status:row.status,admission_date:row.admission_date};
}

async function transfer(id:string,body:any,actor:Actor,ifMatch:any,t:any){
 canWardAct(actor);
 const expected=expectedVersion(ifMatch);
 const reason=String(body?.reason??'').trim();
 if(reason.length<5)fail(422,'Say why the patient is being moved.','VALIDATION_FAILED');
 if(!body?.to_bed_id)fail(422,'to_bed_id is required.','VALIDATION_FAILED');
 const admissionId=I.legacyNumber(await I.locate('admission',id,actor,t));
 const toBedId=I.legacyNumber(await I.locate('bed',body.to_bed_id,actor,t));
 const [adm]=await rows('SELECT id,patient_id,bed_id,status,api_version FROM hms_admissions WHERE id=:id FOR UPDATE',{id:admissionId},t);
 if(!adm)fail(404,'Admission not found.','RESOURCE_NOT_FOUND');
 if(Number(adm.api_version)!==expected)fail(412,'This admission changed after you read it. Reload it and try again.','VERSION_CONFLICT');
 if(adm.status!=='Active')fail(409,'Only an active admission can be moved.','ADMISSION_NOT_ACTIVE');
 if(!adm.bed_id)fail(409,'This admission is not in a bed.','ADMISSION_NOT_IN_BED');
 if(Number(adm.bed_id)===toBedId)fail(409,'The patient is already in that bed.','ALREADY_IN_BED');
 // Both beds are locked in id order, so concurrent moves cannot deadlock.
 const beds=await rows('SELECT id,status,is_active,bed_number FROM hms_beds WHERE id IN (:a,:b) ORDER BY id FOR UPDATE',{a:Number(adm.bed_id),b:toBedId},t);
 const from=beds.find((b:any)=>Number(b.id)===Number(adm.bed_id));
 const to=beds.find((b:any)=>Number(b.id)===toBedId);
 if(!to||!from)fail(404,'Bed not found.','RESOURCE_NOT_FOUND');
 if(Number(to.is_active)!==1||to.status!=='Available')fail(409,`Bed ${to.bed_number} is not ready (${Number(to.is_active)!==1?'inactive':to.status}).`,'BED_NOT_READY');
 await closeOccupancy(sequelize,{admissionId,reason:`transferred: ${reason}`,transaction:t});
 await execute("UPDATE hms_beds SET status = 'Dirty' WHERE id = :id",{id:from.id},t);
 await execute("UPDATE hms_beds SET status = 'Occupied' WHERE id = :id",{id:toBedId},t);
 const updated=await rows('UPDATE hms_admissions SET bed_id = :toBedId, api_version = api_version + 1 WHERE id = :admissionId AND api_version = :expected RETURNING id',{toBedId,admissionId,expected},t);
 if(!updated.length)fail(412,'This admission changed after you read it. Reload it and try again.','VERSION_CONFLICT');
 await openOccupancy(sequelize,{bedId:toBedId,admissionId,userId:actor.id,reason:`transfer: ${reason}`,transaction:t});
 await logAction(actor.id,'UPDATE','admission',admissionId,{bed:Number(from.id)},{bed:toBedId,reason},actor.ip);
 return projection(admissionId,t);
}

async function read(id:string,actor:Actor,t:any){
 canWardAct(actor);
 const admissionId=I.legacyNumber(await I.locate('admission',id,actor,t));
 return projection(admissionId,t);
}

// The v2 discharge body is snake_case like the rest of v2; the shared command takes the legacy
// names. An unknown field is refused rather than silently dropped.
const DISCHARGE_FIELDS:Record<string,string>={final_diagnosis:'finalDiagnosis',course_in_hospital:'courseInHospital',condition_at_discharge:'conditionAtDischarge',
 advice_on_discharge:'adviceOnDischarge',chief_complaint:'chiefComplaint',comorbidities:'comorbidities',allergies:'allergies',history_of_illness:'historyOfIllness',
 investigations:'investigations',discharge_medications:'dischargeMedications',diet_lifestyle:'dietLifestyle',warning_signs:'warningSigns',follow_up_appointments:'followUpAppointments'};
function dischargeFields(body:any){
 const out:Record<string,unknown>={};
 for(const [k,v] of Object.entries(body||{})){
  if(!DISCHARGE_FIELDS[k])fail(422,`Unsupported field ${k}; use the documented snake_case contract.`,'UNSUPPORTED_FIELD');
  out[DISCHARGE_FIELDS[k]]=v;
 }
 return out;
}

// Discharge (A3). The same command as the legacy route; this adds the version check
// (If-Match), the doctor's clinical privilege and the patient-in-care check, and bumps the version.
async function discharge(id:string,body:any,actor:Actor,ifMatch:any,t:any){
 if(actor.role!=='doctor')fail(403,'A responsible doctor must author and sign the discharge continuity record.','RESPONSIBLE_DOCTOR_REQUIRED');
 const expected=expectedVersion(ifMatch);
 const admissionId=I.legacyNumber(await I.locate('admission',id,actor,t));
 const [adm]=await rows('SELECT id,patient_id,api_version FROM hms_admissions WHERE id=:id FOR UPDATE',{id:admissionId},t);
 if(!adm)fail(404,'Admission record not found.','RESOURCE_NOT_FOUND');
 if(Number(adm.api_version)!==expected)fail(412,'This admission changed after you read it. Reload it and try again.','VERSION_CONFLICT');
 await require('./facilities.cts').requirePrivilege(actor,'CLINICAL_SIGN',t);
 if(!(await require('../utils/careTeam').patientInCare(actor.id,Number(adm.patient_id),t)))fail(403,'The patient must be in your care.','PATIENT_NOT_IN_CARE');
 const result=await require('./dischargeCore').discharge({admissionId,body:dischargeFields(body),user:actor,transaction:t});
 // The database trigger hms_bump_api_version advances the version on every change to the row,
 // and the row has been locked since the version check, so no second bump is made here.
 await logAction(actor.id,'UPDATE','ipd',admissionId,null,{action:'discharge_patient',summaryId:result.summaryId,signedDocumentId:result.clinicalDocumentId},actor.ip);
 const view=await projection(admissionId,t);
 return {...view,summary_id:result.summaryId,clinical_document_id:result.clinicalDocumentId,signature_digest:result.signatureDigest,discharge_date:result.dischargeDate};
}

// Admission into a bed (A3). The patient, bed and admitting doctor are named by public identifier.
// The admission command is the one the legacy route calls. Admission requests are still named
// by their legacy number; the request is picked up automatically when the patient has one.
const ADMITTERS=['super_admin','admin','doctor','nurse'];
async function admit(body:any,actor:Actor,t:any){
 if(!ADMITTERS.includes(actor.role))fail(403,'Your role cannot admit patients.','ROLE_NOT_PERMITTED');
 if(!body?.patient_id||!body?.bed_id)fail(422,'patient_id and bed_id are required.','VALIDATION_FAILED');
 const patientId=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));
 const bedId=I.legacyNumber(await I.locate('bed',body.bed_id,actor,t));
 const doctorId=body.admitting_doctor_id?I.legacyNumber(await I.locate('principal',body.admitting_doctor_id,actor,t)):undefined;
 const r=await require('./admissionCore').admitPatient({
  body:{patientId,bedId,admittingDoctorId:doctorId,department:body.department,admissionType:body.admission_type,expectedDischargeDate:body.expected_discharge_date},
  user:actor,t,
 });
 await logAction(actor.id,'CREATE','ipd',r.admissionId,null,{action:'admit_patient',bedId:r.bedId,requestId:r.request?.ID||null},actor.ip);
 return projection(r.admissionId,t);
}

module.exports={transfer,read,discharge,admit};
