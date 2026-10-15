import type {Transaction} from 'sequelize';
const I=require('./identities.cts'),D=require('./clinicalDocuments.cts');
type Actor={id:number;role:string;facilityId?:string};
const sectionKeys:Record<string,string>=require('../domain/clinicalDocumentSchema.cts').publicSectionKeys;
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function object(value:unknown,allowed:string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'Send a JSON object.','INVALID_REQUEST');
 for(const key of Object.keys(value))if(!allowed.includes(key))fail(422,`Unsupported field ${key}; use the documented snake_case contract.`,'UNSUPPORTED_FIELD');return value as Record<string,unknown>;
}
function content(input:unknown,type:string){
 const allowed=(D.fields[type]||[]).map((k:string)=>Object.entries(sectionKeys).find(([,v])=>v===k)?.[0]||k);
 return Object.fromEntries(Object.entries(object(input,allowed)).map(([k,v])=>[sectionKeys[k]||k,v]));
}
function presentedContent(input:Record<string,unknown>){return Object.fromEntries(Object.entries(input).map(([k,v])=>[Object.entries(sectionKeys).find(([,legacy])=>legacy===k)?.[0]||k,v]));}
async function view(doc:any,actor:Actor,t?:Transaction){
 const refs:any={};
 for(const [field,kind] of [['patient_id','patient'],['encounter_id','encounter'],['admission_id','admission'],['author_user_id','principal']] as const)
  refs[field]=doc[field]?(await I.locate(kind,doc[field],actor,t,true)).public_id:null;
 const signed=await D.versions(Number(doc.id),actor,t);
 return {id:doc.public_id,...refs,facility_id:doc.facility_id,doc_type:doc.doc_type,state:doc.state,version:doc.api_version,
  draft_version:doc.draft_version,signed_version:doc.signed_version,amendment_reason:doc.amendment_reason||null,content:presentedContent(doc.draft_content),
  signatures:await Promise.all(signed.map(async(s:any)=>({version:s.version,canonical_signed_content:s.content,canonicalization:'hms-json-v1',digest:s.digest,
   signed_by_name:s.signed_by_name,meaning:s.meaning,amends_version:s.amends_version,amendment_reason:s.amendment_reason,signed_at:s.signed_at,
   signed_by:(await I.locate('principal',s.signed_by,actor,t,true)).public_id}))) };
}
async function read(id:string,actor:Actor,t?:Transaction){const meta=await I.locate('clinical_document',id,actor,t);return view(await D.read(I.legacyNumber(meta),actor,t),actor,t);}
async function create(input:unknown,actor:Actor,t:Transaction){
 const b=object(input,['patient_id','encounter_id','admission_id','doc_type','content']),type=String(b.doc_type||'clinical_note');
 const patient=I.legacyNumber(await I.locate('patient',b.patient_id,actor,t)),translated:any={patientId:patient,docType:type,content:content(b.content||{},type)};
 for(const [field,kind,target] of [['encounter_id','encounter','encounterId'],['admission_id','admission','admissionId']] as const)
  if(b[field]!==undefined&&b[field]!==null)translated[target]=I.legacyNumber(await I.locate(kind,b[field],actor,t));
 return view(await D.create(translated,actor,t),actor,t);
}
async function change(id:string,actor:Actor,action:'draft'|'sign'|'amend'|'sign-amendment',input:unknown,header:unknown,t:Transaction){
 const b=object(input,action==='draft'?['content']:action==='sign'?[]:['reason']);
 const meta=await I.locate('clinical_document',id,actor,t),doc=await D.read(I.legacyNumber(meta),actor,t);
 const translated=action==='draft'?{content:content(b.content,doc.doc_type)}:b;
 const result=await D.change(Number(doc.id),actor,action,translated,header,t,true);return view(result.row,actor,t);
}
module.exports={read,create,change};
