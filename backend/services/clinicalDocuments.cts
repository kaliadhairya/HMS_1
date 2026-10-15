import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),crypto=require('node:crypto');
const F=require('./facilities.cts'),{patientInCare}=require('../utils/careTeam'),{publish}=require('../utils/outbox');
const Notes=require('./encounterNotes.cts');
type Actor={id:number;role:string;facilityId?:string};
type Content=Record<string,string>;
type DocumentType='clinical_note'|'discharge_summary'|'nursing_assessment'|'care_plan'|'encounter_note';
type Create={patientId:number;encounterId?:number|null;admissionId?:number|null;docType?:DocumentType;content?:unknown};
const fields:Record<DocumentType,readonly string[]>=require('../domain/clinicalDocumentSchema.cts').fields;
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
function fail(status:number,message:string,code:string,current?:number):never{throw Object.assign(new Error(message),{status,code,current});}
function id(value:unknown,label:string,optional=false):number|null{
 if(optional&&(value===undefined||value===null))return null;
 const n=Number(value);if(!Number.isSafeInteger(n)||n<1)fail(422,`${label} must identify an existing record.`,'INVALID_ID');return n;
}
function canonical(value:any):any{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;
}
const digestOf=(content:unknown):string=>crypto.createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
function cleanContent(input:unknown,type:DocumentType):Content{
 if(!input||typeof input!=='object'||Array.isArray(input))fail(422,'Content must be an object of named text sections.','INVALID_CONTENT');
 const allowed=fields[type];if(!allowed)fail(422,'Choose a supported document type.','INVALID_DOCUMENT_TYPE');
 const source=input as Record<string,unknown>,out:Content={};
 for(const key of Object.keys(source)){
  if(!allowed.includes(key))fail(422,`Unsupported content section ${key}.`,'UNSUPPORTED_FIELD');
  const value=source[key];if(value===undefined||value===null)continue;
  if(typeof value!=='string'||value.length>5000)fail(422,`${key} must be text of at most 5,000 characters.`,'INVALID_CONTENT');out[key]=value;
 }
 if(JSON.stringify(out).length>(type==='encounter_note'?30000:20000))fail(422,'The clinical document is too long.','INVALID_CONTENT');return out;
}
async function care(actor:Actor,patient:number,t?:Transaction){
 if(!actor.facilityId)fail(403,'An authorized facility is required.','FACILITY_CONTEXT_REQUIRED');
 if(actor.role==='doctor'){
  if(!(await patientInCare(actor.id,patient,t)))fail(403,'This patient is not in your current care.','PATIENT_NOT_IN_CARE');return;
 }
 if(actor.role==='nurse'){
  const responsible=await q(`SELECT r.id FROM hms_med_nursing_responsibility r JOIN hms_admissions a ON a.patient_id=r.patient_id AND a.facility_id=r.facility_id
   WHERE r.patient_id=:patient AND r.responsible_user_id=:user AND r.facility_id=:facility AND a.status='Active'${t?' FOR SHARE OF r,a':''}`,{patient,user:actor.id,facility:actor.facilityId},t);
  if(responsible.length)return;
 }
 fail(403,'A current care assignment is required.','PATIENT_NOT_IN_CARE');
}
async function authorize(actor:Actor,patient:number,type:DocumentType,write:boolean,t?:Transaction){
 if(!['doctor','nurse'].includes(actor.role))fail(403,'Clinical access requires a clinical role and approved privilege.','CLINICAL_PRIVILEGE_REQUIRED');
 if(write&&actor.role==='nurse'&&!['nursing_assessment','care_plan'].includes(type))fail(403,'Nurses may author nursing assessments and care plans.','DOCUMENT_AUTHOR_REQUIRED');
 await care(actor,patient,t);
 if(write)await F.requirePrivilege(actor,'CHART_READ',t);
 await F.requirePrivilege(actor,write?(actor.role==='nurse'?'NURSING_DOCUMENT':'CLINICAL_SIGN'):'CHART_READ',t);
}
async function load(docId:number,actor:Actor,t?:Transaction,lock=false){
 const [doc]=await q(`SELECT * FROM hms_clinical_documents WHERE id=:id AND facility_id=:facility${lock?' FOR UPDATE':''}`,{id:docId,facility:actor.facilityId},t);
 if(!doc)fail(404,'Clinical document not found in this facility.','RESOURCE_NOT_FOUND');return doc;
}
function view(doc:any){return {id:Number(doc.id),patient_id:Number(doc.patient_id),encounter_id:doc.encounter_id?Number(doc.encounter_id):null,
 admission_id:doc.admission_id?Number(doc.admission_id):null,doc_type:doc.doc_type,amendment_reason:doc.amendment_reason||null,
 state:doc.state,version:Number(doc.draft_version),signed_version:doc.signed_version?Number(doc.signed_version):null,content:doc.draft_content};}
async function create(input:Create,actor:Actor,t:Transaction){
 const patient=id(input.patientId,'Patient')!,encounter=id(input.encounterId,'Encounter',true),admission=id(input.admissionId,'Admission',true),type=input.docType||'clinical_note';
 if(type==='encounter_note')fail(409,'Start the initial encounter note through the consultation workflow.','ENCOUNTER_COMMAND_REQUIRED');
 await authorize(actor,patient,type,true,t);
 const [p]=await q('SELECT id,is_active,identity_status FROM hms_patients WHERE id=:id FOR SHARE',{id:patient},t);
 if(!p)fail(404,'Patient not found.','RESOURCE_NOT_FOUND');
 if(Number(p.is_active)!==1||p.identity_status==='merged')fail(409,'New documents require the current active patient identity.','PATIENT_IDENTITY_REVIEW_REQUIRED');
 if(type==='discharge_summary'&&!admission)fail(422,'Choose the admission for the discharge summary.','ADMISSION_REQUIRED');
 for(const [context,table] of [[encounter,'hms_encounters'],[admission,'hms_admissions']] as const){
  if(context&&!(await q(`SELECT id FROM ${table} WHERE id=:id AND patient_id=:patient AND facility_id=:facility FOR SHARE`,{id:context,patient,facility:actor.facilityId},t)).length)
   fail(409,'The selected care context is unavailable or belongs to another patient.','PATIENT_CONTEXT_MISMATCH');
 }
 const content=cleanContent(input.content||{},type);
 const [doc]=await q(`INSERT INTO hms_clinical_documents(patient_id,encounter_id,admission_id,doc_type,author_user_id,draft_content,facility_id)
 VALUES(:patient,:encounter,:admission,:type,:user,CAST(:content AS jsonb),:facility) RETURNING *`,{patient,encounter,admission,type,user:actor.id,content:JSON.stringify(content),facility:actor.facilityId},t);
 await publish('clinical.document.started',`user:${actor.id}`,{patient_id:patient,document_id:Number(doc.id),version:doc.api_version},{transaction:t});return doc;
}
async function read(docId:number,actor:Actor,t?:Transaction){
 const doc=await load(docId,actor,t);await authorize(actor,Number(doc.patient_id),doc.doc_type,false,t);
 if(doc.signed_version){const [signature]=await q('SELECT content,digest FROM hms_document_signatures WHERE document_id=:id AND version=:version AND facility_id=:facility',{id:doc.id,version:doc.signed_version,facility:actor.facilityId},t);
  if(!signature||digestOf(signature.content)!==signature.digest)fail(503,'The signed document failed its integrity check.','SIGNED_RECORD_INTEGRITY_FAILED');
  if(doc.state==='signed')doc.draft_content=signature.content;
 }
 return doc;
}
function signProblem(doc:any){
 if(doc.doc_type==='discharge_summary'&&!['diagnosis','condition','instructions','warningSigns','followUp'].every(k=>doc.draft_content[k]?.trim()))
  fail(422,'Review diagnosis, condition, instructions, warning signs and follow-up before signing.','DISCHARGE_CONTENT_INCOMPLETE');
 if(!Object.values(doc.draft_content).some(v=>typeof v==='string'&&v.trim()))fail(422,'An empty document cannot be signed.','EMPTY_CLINICAL_NOTE');
}
async function change(docId:number,actor:Actor,action:'draft'|'sign'|'amend'|'sign-amendment',input:{content?:unknown;reason?:unknown},raw:unknown,t:Transaction,publicVersion=false){
 const expected=Notes.expected(raw),doc=await load(docId,actor,t,true);
 await authorize(actor,Number(doc.patient_id),doc.doc_type,true,t);
 if(Number(doc.author_user_id)!==actor.id)fail(403,'Only the recorded author may change or sign this document.','DOCUMENT_AUTHOR_REQUIRED');
 const actual=Number(publicVersion?doc.api_version:doc.draft_version);
 if(expected!==actual)fail(412,'The document changed. Compare the latest record before submitting your preserved draft.','VERSION_STALE',actual);
 if(doc.doc_type==='encounter_note'&&!doc.signed_version)fail(409,'Save and sign the initial encounter note through the consultation workflow.','ENCOUNTER_COMMAND_REQUIRED');
 let reason:string|undefined,digest:string|undefined;
 if(action==='amend'||action==='sign-amendment'){
  if(typeof input.reason!=='string'||input.reason.trim().length<10||input.reason.trim().length>500)fail(422,'Record an amendment reason of 10–500 characters.','AMENDMENT_REASON_REQUIRED');reason=input.reason.trim();
 }
 if(action==='draft'){
  if(doc.state==='signed')fail(409,'This document is signed. Start a linked amendment.','NOTE_SIGNED');
  const content=cleanContent(input.content,doc.doc_type);
  await q('UPDATE hms_clinical_documents SET draft_content=CAST(:content AS jsonb),draft_version=draft_version+1,updated_at=now() WHERE id=:id',{content:JSON.stringify(content),id:doc.id},t);
 }else if(action==='amend'){
  if(doc.state!=='signed')fail(409,'Only a signed document can be amended.','AMENDMENT_NOT_AVAILABLE');
  await q("UPDATE hms_clinical_documents SET state='draft',draft_version=draft_version+1,amendment_reason=:reason,updated_at=now() WHERE id=:id",{id:doc.id,reason},t);
 }else{
  if(doc.state!=='draft')fail(409,'This document has already been signed.','NOTE_SIGNED');
  if(action==='sign'&&doc.signed_version)fail(409,'An existing signed record requires a linked amendment signature.','AMENDMENT_SIGNATURE_REQUIRED');
  if(action==='sign-amendment'&&(!doc.signed_version||doc.amendment_reason!==reason))fail(409,'The amendment must match the recorded reason and prior signature.','AMENDMENT_CONTEXT_MISMATCH');
  signProblem(doc);digest=digestOf(doc.draft_content);
  const [next]=await q('SELECT COALESCE(max(version),0)+1 AS version FROM hms_document_signatures WHERE document_id=:id',{id:doc.id},t);
  await q(`INSERT INTO hms_document_signatures(document_id,version,content,digest,signed_by,meaning,amends_version,amendment_reason,facility_id)
   VALUES(:id,:version,CAST(:content AS jsonb),:digest,:user,:meaning,:amends,:reason,:facility)`,{id:doc.id,version:next.version,content:JSON.stringify(doc.draft_content),digest,user:actor.id,
   meaning:action==='sign'?'authored and signed':'amended and signed',amends:action==='sign'?null:doc.signed_version,reason:action==='sign'?null:reason,facility:actor.facilityId},t);
  await q("UPDATE hms_clinical_documents SET state='signed',signed_version=:version,updated_at=now() WHERE id=:id",{id:doc.id,version:next.version},t);
 }
 const updated=await load(docId,actor,t);
 await publish(`clinical.document.${action}`,`user:${actor.id}`,{patient_id:Number(doc.patient_id),document_id:Number(doc.id),version:updated.api_version,...(digest?{digest}:{})},{transaction:t});
 return {row:updated,digest};
}
async function versions(docId:number,actor:Actor,t?:Transaction){
 await read(docId,actor,t);
 const signatures=await q(`SELECT s.version,s.content,s.digest,s.meaning,s.amends_version,s.amendment_reason,s.signed_at,s.signed_by,u.name AS signed_by_name
 FROM hms_document_signatures s JOIN hms_users u ON u.id=s.signed_by WHERE s.document_id=:id AND s.facility_id=:facility ORDER BY s.version`,{id:docId,facility:actor.facilityId},t);
 if(signatures.some(s=>digestOf(s.content)!==s.digest))fail(503,'A signed version failed its integrity check.','SIGNED_RECORD_INTEGRITY_FAILED');return signatures;
}
module.exports={create,read,change,versions,view,fields,canonical,digestOf,care};
