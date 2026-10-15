import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),I=require('./identities.cts'),F=require('./facilities.cts');
const Encounters=require('./clinicalEncounters.cts'),Notes=require('./encounterNotes.cts'),{patientInCare}=require('../utils/careTeam');
type Actor={id:number;role:string;facilityId?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT'});
function fail(status:number,message:string,code:string,current?:number):never{throw Object.assign(new Error(message),{status,code,current});}
function object(input:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input))fail(422,'Send a JSON object.','INVALID_REQUEST');
 const result=input as Record<string,unknown>;const invalid=Object.keys(result).find(k=>!keys.includes(k));
 if(invalid)fail(422,`Unsupported field ${invalid}; v2 uses the documented snake_case contract.`,'UNSUPPORTED_FIELD');return result;
}
async function actorUuid(id:number,actor:Actor,t?:Transaction):Promise<string>{return (await I.locate('principal',id,actor,t,true)).public_id;}
async function patientScope(patient:number,actor:Actor,t?:Transaction){
 if(actor.role==='nurse')await require('./clinicalDocuments.cts').care(actor,patient,t);
 if(actor.role==='doctor'&&!(await patientInCare(actor.id,patient,t)))fail(403,'This patient is not in your current care.','PATIENT_NOT_IN_CARE');
 if(['doctor','nurse','pharmacist','lab_technician'].includes(actor.role))await F.requirePrivilege(actor,'CHART_READ',t);
}
async function patient(id:string,actor:Actor,t?:Transaction){
 const identity=await I.locate('patient',id,actor,t);await patientScope(Number(identity.id),actor,t);
 const p=await I.find('patient',id,actor,t);
 const [calendar]=await q('SELECT dob::text AS dob FROM hms_patients WHERE id=:id',{id:p.id},t);
 return {id:p.public_id,uhid:p.uhid,name:p.name,gender:p.gender,dob:calendar.dob,age:p.age,identity_status:p.identity_status,
  merged_into_patient_id:p.merged_into_patient_id?(await I.locate('patient',p.merged_into_patient_id,actor,t,true)).public_id:null,version:p.api_version};
}
async function encounterView(e:any,actor:Actor,t?:Transaction){
 await patientScope(Number(e.patient_id),actor,t);
 const patient=await I.locate('patient',e.patient_id,actor,t,true);
 const data:any={id:e.public_id,patient_id:patient.public_id,doctor_id:await actorUuid(e.doctor_id,actor,t),facility_id:e.facility_id,
  status:e.status,encounter_type:e.encounter_type,occurred_at:e.encounter_date,version:e.api_version,note_version:e.record_revision};
 for(const [field,kind] of [['token_id','token'],['appointment_id','appointment'],['department_id','department'],['notes_document_id','clinical_document']] as const)
  data[field]=e[field]?(await I.locate(kind,e[field],actor,t,true)).public_id:null;
 for(const key of Notes.fields)data[key]=e[key]??null;
 if(e.notes_document_id){const [s]=await q('SELECT content,version,digest FROM hms_document_signatures WHERE document_id=:id ORDER BY version DESC LIMIT 1',{id:e.notes_document_id},t);
  if(s){const canonical=Object.fromEntries(Object.keys(s.content).sort().map(k=>[k,s.content[k]]));
   if(require('node:crypto').createHash('sha256').update(JSON.stringify(canonical)).digest('hex')!==s.digest)fail(503,'The signed record failed its integrity check.','SIGNED_RECORD_INTEGRITY_FAILED');
   for(const key of Notes.fields)if(key in s.content)data[key]=s.content[key];data.signed_note_version=s.version;data.signature_digest=s.digest;}}
 return data;
}
async function readEncounter(id:string,actor:Actor,t?:Transaction){
 const identity=await I.locate('encounter',id,actor,t);await F.requirePrivilege(actor,'CHART_READ',t);await patientScope(Number(identity.patient_id),actor,t);
 return encounterView(await I.find('encounter',id,actor,t),actor,t);
}
async function create(input:unknown,actor:Actor,t:Transaction){
 const body=object(input,['patient_id','token_id','appointment_id','department_id','chief_complaint','encounter_type']);
 const p=await I.locate('patient',body.patient_id,actor,t),translated:any={...body,patient_id:I.legacyNumber(p)};
 for(const [field,kind] of [['token_id','token'],['appointment_id','appointment'],['department_id','department']] as const)
  if(body[field]!==undefined&&body[field]!==null)translated[field]=I.legacyNumber(await I.locate(kind,body[field],actor,t));
 return encounterView(await Encounters.create(translated,actor,t),actor,t);
}
async function note(id:string,actor:Actor,input:unknown,header:unknown,t:Transaction,sign=false){
 object(input,sign?[]:Notes.fields);
 const [e]=await q('SELECT id,patient_id,doctor_id,api_version,record_revision FROM hms_encounters WHERE public_id=CAST(:id AS uuid) AND facility_id=CAST(:facility AS uuid) FOR UPDATE',{id:I.isUuid(id)?id:fail(422,'A canonical UUID is required.','UUID_REQUIRED'),facility:actor.facilityId},t);
 if(!e)fail(404,'Encounter is not available in the current facility.','RESOURCE_NOT_FOUND');
 const expected=Notes.expected(header);if(expected!==e.api_version)fail(412,'The encounter changed. Compare the latest record before submitting your preserved draft.','VERSION_STALE',e.api_version);
 // The public aggregate version is validated first. Translate its exact
 // locked snapshot to the existing content counter, never a silent rebase.
 if(sign)await Notes.sign(Number(e.id),actor,String(e.record_revision),t);
 else await Notes.save(Number(e.id),actor,input as Record<string,unknown>,String(e.record_revision),t);
 const [updated]=await q('SELECT * FROM hms_encounters WHERE id=:id',{id:e.id},t);return encounterView(updated,actor,t);
}
async function identity(kind:string,id:string,actor:Actor){const row=await I.locate(kind,id,actor,undefined,true);
 if(kind==='patient')await patientScope(Number(row.id),actor);
 if(kind==='encounter')await patientScope(Number(row.patient_id),actor);
 if(row.patient_id&&kind!=='encounter')await patientScope(Number(row.patient_id),actor);
 return {resource_type:kind,id:row.public_id};
}
module.exports={patient,readEncounter,create,note,identity};
