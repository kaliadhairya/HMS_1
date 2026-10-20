// Scheduling through the v2 API (completion A3). Booking calls the same transactional
// core as the legacy route, so one doctor and day are serialized however the request
// arrives. Patients, doctors and departments are named by their public identifiers.
const I=require('./identities.cts');
const {reserveAppointment,doctorIdsFor}=require('./appointmentBooking');
const {logAction}=require('../utils/auditLogger');
const {sequelize}=require('../models/db');
const {QueryTypes}=require('sequelize');
const rows=(sql:string,replacements:any,t:any):Promise<any[]>=>sequelize.query(sql,{replacements,type:QueryTypes.SELECT,transaction:t});
type Actor={id:number;role:string;facilityId?:string;ip?:string};
const BOOKERS=['super_admin','admin','doctor','receptionist'];
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function canBook(actor:Actor){if(!BOOKERS.includes(actor.role))fail(403,'Your role cannot book appointments.','ROLE_NOT_PERMITTED');}
const STATUSES=['Scheduled','Checked-in','Completed','Cancelled','No Show'];

async function book(body:any,actor:Actor,t:any){
 canBook(actor);
 if(!body||!body.patient_id||!body.doctor_id||!body.appointment_date)fail(422,'patient_id, doctor_id and appointment_date are required.','VALIDATION_FAILED');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(body.appointment_date)))fail(422,'appointment_date must be YYYY-MM-DD.','VALIDATION_FAILED');
 if(body.status!==undefined&&!STATUSES.includes(String(body.status)))fail(422,'Unknown appointment status.','VALIDATION_FAILED');
 const patient=await I.locate('patient',body.patient_id,actor,t);
 const doctor=await I.locate('principal',body.doctor_id,actor,t);
 const doctorRef=I.legacyNumber(doctor);
 const {ids,userId,departmentId}=await doctorIdsFor(doctorRef);
 if(!userId)fail(422,'The named practitioner is not a doctor.','VALIDATION_FAILED');
 let department=departmentId;
 if(body.department_id){const d=await I.locate('department',body.department_id,actor,t);department=I.legacyNumber(d);}
 if(!department)fail(422,'department_id is required for this doctor.','VALIDATION_FAILED');
 const booked=await reserveAppointment({
  patientId:I.legacyNumber(patient),doctorIds:ids,doctorRef,doctorUserId:userId,departmentId:department,
  appointmentDate:body.appointment_date,slotStart:body.slot_start||body.appointment_time,slotEnd:body.slot_end,
  apptType:body.appt_type||'walk-in',status:String(body.status||'Scheduled'),bookedBy:Number(actor.id),transaction:t,
 });
 if(booked.error)fail(409,booked.error,'SLOT_UNAVAILABLE');
 const [row]=await rows(`SELECT a.public_id,a.api_version,a.appointment_date,a.slot_start,a.slot_end,a.appt_type,a.status,p.public_id AS patient_public,u.public_id AS doctor_public,dep.public_id AS department_public
   FROM hms_appointments a JOIN hms_patients p ON p.id=a.patient_id JOIN hms_users u ON u.id=a.doctor_id LEFT JOIN hms_departments dep ON dep.id=a.department_id WHERE a.id=:id`,{id:booked.id},t);
 await logAction(actor.id,'CREATE','appointment',booked.id,null,{date:body.appointment_date,slot:booked.slot.slotStart},actor.ip);
 return project(row);
}

function project(row:any){
 return {id:row.public_id,version:Number(row.api_version),patient_id:row.patient_public,doctor_id:row.doctor_public,department_id:row.department_public,
  appointment_date:String(row.appointment_date).slice(0,10),slot_start:row.slot_start,slot_end:row.slot_end,appt_type:row.appt_type,status:row.status};
}

async function read(id:string,actor:Actor,t:any){
 canBook(actor);
 const found=await I.locate('appointment',id,actor,t);
 const [row]=await rows(`SELECT a.public_id,a.api_version,a.appointment_date,a.slot_start,a.slot_end,a.appt_type,a.status,p.public_id AS patient_public,u.public_id AS doctor_public,dep.public_id AS department_public
   FROM hms_appointments a JOIN hms_patients p ON p.id=a.patient_id JOIN hms_users u ON u.id=a.doctor_id LEFT JOIN hms_departments dep ON dep.id=a.department_id WHERE a.id=:id`,{id:I.legacyNumber(found)},t);
 return project(row);
}

module.exports={book,read};
