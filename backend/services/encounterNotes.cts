import type { Transaction } from 'sequelize';
const {sequelize}=require('../models/db');
const {patientInCare}=require('../utils/careTeam');
const {publish}=require('../utils/outbox');
const crypto=require('node:crypto');
type Actor={id:number;role:string;facilityId?:string};
type NoteContent=Record<string,string|null>;
const FIELDS=['chief_complaint','hopi','past_medical_history','surgical_history','family_history','social_history','current_medications','general_examination','cvs_findings','rs_findings','abdomen_findings','cns_findings'] as const;
const rows=(sql:string,replacements:Record<string,unknown>,transaction:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT'});
function fail(status:number,message:string,code:string,current?:number):never{throw Object.assign(new Error(message),{status,code,current});}
function expected(raw:unknown):number{
 if(raw===undefined)fail(428,'Send If-Match with the record revision you reviewed.','PRECONDITION_REQUIRED');
 const m=String(raw).match(/^(?:"([1-9]\d*)"|([1-9]\d*))$/);const n=Number(m?.[1]||m?.[2]);
 if(!Number.isSafeInteger(n))fail(400,'If-Match must contain one positive record revision.','INVALID_REVISION');return n;
}
async function load(id:number,actor:Actor,raw:unknown,t:Transaction){
 const [e]=await rows('SELECT * FROM hms_encounters WHERE id=:id AND facility_id=:facility FOR UPDATE',{id,facility:actor.facilityId},t);
 if(!e)fail(404,'Encounter not found.','NOT_FOUND');
 if(actor.role!=='doctor'||Number(e.doctor_id)!==actor.id||!(await patientInCare(actor.id,e.patient_id,t)))fail(403,'Only the responsible doctor in care may save or sign this encounter.','PATIENT_NOT_IN_CARE');
 if(e.status==='Finalized')fail(400,'Cannot change a finalized encounter; use a linked amendment.','ENCOUNTER_FINALIZED');
 const revision=expected(raw);if(Number(e.record_revision)!==revision)fail(412,'The encounter changed. Compare the latest record before saving your preserved draft.','VERSION_STALE',Number(e.record_revision));return e;
}
const contentOf=(e:any):NoteContent=>Object.fromEntries(FIELDS.map(k=>[k,e[k]??null]));
async function ensureDocument(e:any,t:Transaction){
 if(e.notes_document_id)return e.notes_document_id;
 const [doc]=await rows(`INSERT INTO hms_clinical_documents(patient_id,encounter_id,doc_type,author_user_id,draft_content)
 VALUES(:p,:e,'encounter_note',:u,CAST(:content AS jsonb)) RETURNING id`,{p:e.patient_id,e:e.id,u:e.doctor_id,content:JSON.stringify(contentOf(e))},t);
 await rows('UPDATE hms_encounters SET notes_document_id=:doc WHERE id=:id',{doc:doc.id,id:e.id},t);return doc.id;
}
async function save(id:number,actor:Actor,input:Record<string,unknown>,raw:unknown,t:Transaction){
 await require('./facilities.cts').requirePrivilege(actor,'CLINICAL_SIGN',t);
 const e=await load(id,actor,raw,t);const changes:NoteContent={};
 for(const k of FIELDS){if(!(k in input))continue;const v=input[k];if(v!==null&&typeof v!=='string')fail(422,`${k} must be text.`,'INVALID_NOTE');if(typeof v==='string'&&v.length>5000)fail(422,`${k} is too long.`,'INVALID_NOTE');changes[k]=v as string|null;}
 const content={...contentOf(e),...changes};if(JSON.stringify(content).length>30000)fail(422,'The consultation note is too long.','INVALID_NOTE');
 const doc=await ensureDocument(e,t);
 const sets=Object.keys(changes).map(k=>`${k}=:${k}`);
 const [updated]=await rows(`UPDATE hms_encounters SET ${[...sets,'record_revision=record_revision+1','updated_at=now()'].join(',')} WHERE id=:id RETURNING record_revision`,{...changes,id},t);
 await rows(`UPDATE hms_clinical_documents SET draft_content=CAST(:content AS jsonb),draft_version=:revision,updated_at=now() WHERE id=:doc AND state='draft'`,{content:JSON.stringify(content),revision:updated.record_revision,doc},t);
 return {id,revision:Number(updated.record_revision),notes_document_id:Number(doc)};
}
async function sign(id:number,actor:Actor,raw:unknown,t:Transaction){
 await require('./facilities.cts').requirePrivilege(actor,'CLINICAL_SIGN',t);
 const e=await load(id,actor,raw,t);const content=contentOf(e);
 if(!Object.values(content).some(v=>v?.trim()))fail(422,'Review and save clinical content before signing.','EMPTY_CLINICAL_NOTE');
 const doc=await ensureDocument(e,t);
 const canonical=Object.fromEntries(Object.keys(content).sort().map(k=>[k,content[k]]));const digest=crypto.createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
 await rows(`INSERT INTO hms_document_signatures(document_id,version,content,digest,signed_by,meaning)
 VALUES(:doc,1,CAST(:content AS jsonb),:digest,:u,'authored and signed')`,{doc,content:JSON.stringify(content),digest,u:actor.id},t);
 await rows(`UPDATE hms_clinical_documents SET draft_content=CAST(:content AS jsonb),state='signed',signed_version=1 WHERE id=:doc`,{doc,content:JSON.stringify(content)},t);
 await rows("UPDATE hms_encounters SET status='Finalized',record_revision=record_revision+1,updated_at=now() WHERE id=:id",{id},t);
 if(e.token_id)await rows("UPDATE hms_tokens SET status='Done' WHERE id=:id",{id:e.token_id},t);
 if(e.appointment_id)await rows("UPDATE hms_appointments SET status='Completed' WHERE id=:id AND status IN ('Scheduled','Checked-in')",{id:e.appointment_id},t);
 await publish('clinical.note.signed',`user:${actor.id}`,{patient_id:e.patient_id,encounter_id:id,document_id:Number(doc),version:1,digest},{transaction:t});
 return {id,revision:Number(e.record_revision)+1,notes_document_id:Number(doc),digest};
}
module.exports={save,sign,expected,fields:FIELDS};
