import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),F=require('./facilities.cts'),{storage}=require('../utils/auditContext');
const {patientInCare}=require('../utils/careTeam');
type Actor={id:number;role:string;facilityId?:string};
function fail(message:string,code:string,status=403):never{throw Object.assign(new Error(message),{status,code});}
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
async function patient(actor:Actor,patientId:number,t?:Transaction,roles:readonly string[]=['doctor','nurse','pharmacist','lab_technician']){
 const context=storage.getStore();
 if(!roles.includes(actor.role))fail('A current clinical role is required to read this record.','CLINICAL_ROLE_REQUIRED');
 if(!Number.isSafeInteger(patientId)||patientId<1)fail('Patient not found.','RESOURCE_NOT_FOUND',404);
 if(!actor.facilityId||context?.userId!==actor.id||context?.facilityId!==actor.facilityId)fail('The clinical actor does not match the current request.','CLINICAL_ACTOR_MISMATCH');
 await F.requirePrivilege(actor,'CHART_READ',t);
 if(actor.role==='doctor'&&!(await patientInCare(actor.id,patientId,t)))fail('The patient is not in your current care.','PATIENT_NOT_IN_CARE');
 if(actor.role==='nurse'&&!(await patientInCare(actor.id,patientId,t)))await require('./clinicalDocuments.cts').care(actor,patientId,t);
 if(actor.role==='pharmacist'||actor.role==='lab_technician'){
  const sql=actor.role==='pharmacist'?`SELECT 1 FROM hms_med_orders WHERE patient_id=:patient AND facility_id=:facility UNION ALL SELECT 1 FROM hms_prescriptions WHERE patient_id=:patient AND facility_id=:facility LIMIT 1`:`SELECT 1 FROM hms_investigation_orders WHERE patient_id=:patient AND facility_id=:facility LIMIT 1`;
  const allowed=await q(sql,{patient:patientId,facility:actor.facilityId},t);
  if(!allowed.length)fail('There is no departmental work for this patient in the selected facility.','PATIENT_NOT_IN_DEPARTMENT');
 }
}
async function historicalPrescription(actor:Actor,kind:'patient'|'encounter'|'prescription',value:number,t?:Transaction){
 let patientId=value;
 if(kind!=='patient'){
  const table=kind==='encounter'?'hms_encounters':'hms_prescriptions';
  const [row]=await q(`SELECT patient_id FROM ${table} WHERE id=:id AND facility_id=:facility`,{id:value,facility:actor.facilityId},t);
  if(!row)fail('Historical record not found.','RESOURCE_NOT_FOUND',404);patientId=Number(row.patient_id);
 }
 await patient(actor,patientId,t,['doctor','nurse','pharmacist']);return patientId;
}
module.exports={patient,historicalPrescription};
