import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db'),I=require('./identities.cts'),F=require('./facilities.cts');
const D=require('./clinicalDocuments.cts'),{patientInCare}=require('../utils/careTeam'),{publish}=require('../utils/outbox');
type Actor={id:number;role:string;facilityId?:string};
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT',retry:{max:0}});
const CODES:Record<string,{unit:string;display:string}>={
 'blood-pressure-systolic':{unit:'mm[Hg]',display:'mmHg'},'blood-pressure-diastolic':{unit:'mm[Hg]',display:'mmHg'},
 'body-temperature':{unit:'Cel|[degF]',display:'temperature'},
 'body-weight':{unit:'kg',display:'kg'},'body-height':{unit:'cm',display:'cm'},'oxygen-saturation':{unit:'%',display:'%'},
 'heart-rate':{unit:'/min',display:'/min'},'respiratory-rate':{unit:'/min',display:'/min'},'pain-score':{unit:'{score}',display:'score'},
 'intake-oral':{unit:'mL',display:'mL'},'intake-intravenous':{unit:'mL',display:'mL'},'output-urine':{unit:'mL',display:'mL'},'output-drain':{unit:'mL',display:'mL'}
};
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function object(value:unknown,allowed:readonly string[]):Record<string,any>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'Send a JSON object.','INVALID_REQUEST');
 const b=value as Record<string,unknown>,extra=Object.keys(b).find(k=>!allowed.includes(k));if(extra)fail(422,`Unsupported field ${extra}.`,'UNSUPPORTED_FIELD');return b;
}
function observedTime(raw:unknown):Date{
 if(typeof raw!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|[+-]\d\d:\d\d)$/.test(raw))fail(422,'observed_at must include an explicit UTC offset.','INVALID_OBSERVED_TIME');
 const time=new Date(raw);if(!Number.isFinite(time.getTime()))fail(422,'observed_at is invalid.','INVALID_OBSERVED_TIME');return time;
}
async function scope(actor:Actor,patient:number,write:boolean,t?:Transaction){
 await D.authorize(actor,patient,actor.role==='nurse'?'nursing_assessment':'clinical_note',write,t);
 if(actor.role==='doctor'&&!(await patientInCare(actor.id,patient,t)))fail(403,'This patient is not in your current care.','PATIENT_NOT_IN_CARE');
}
async function view(id:string,actor:Actor,t?:Transaction){
 const [set]=await q(`SELECT s.id,s.public_id,s.patient_id,s.encounter_id,s.admission_id,s.context_kind,s.observed_at,s.recorded_by,s.facility_id,
  s.source_kind,s.correction_of,s.correction_reason FROM hms_observation_sets s
  WHERE s.public_id=CAST(:id AS uuid) AND s.facility_id=CAST(:facility AS uuid)`,{id,facility:actor.facilityId},t);
 if(!set)fail(404,'Observation set is not available in this facility.','RESOURCE_NOT_FOUND');
 await scope(actor,Number(set.patient_id),false,t);
 const observations=await q(`SELECT public_id,code,code_system,value_numeric,value_text,value_boolean,unit_code,unit_display,method
  FROM hms_observations WHERE set_id=:id AND facility_id=CAST(:facility AS uuid) ORDER BY code`,{id:set.id,facility:actor.facilityId},t);
 // A set never changes (a correction is a new linked set), so its version is always 1.
 return {id:set.public_id,version:1,patient_id:(await I.locate('patient',set.patient_id,actor,t,true)).public_id,
  encounter_id:set.encounter_id?(await I.locate('encounter',set.encounter_id,actor,t,true)).public_id:null,
  admission_id:set.admission_id?(await I.locate('admission',set.admission_id,actor,t,true)).public_id:null,
  context_kind:set.context_kind,observed_at:set.observed_at,recorded_by:(await I.locate('principal',set.recorded_by,actor,t,true)).public_id,
  facility_id:set.facility_id,source:set.source_kind,correction_of:set.correction_of,correction_reason:set.correction_reason,
  observations:observations.map((o:any)=>({id:o.public_id,code:o.code,code_system:o.code_system,
   value:o.value_numeric===null?o.value_text===null?o.value_boolean:Number(o.value_numeric):Number(o.value_numeric),unit_code:o.unit_code,unit_display:o.unit_display,method:o.method}))};
}
async function create(input:unknown,actor:Actor,t:Transaction){
 const b=object(input,['patient_id','encounter_id','admission_id','observed_at','observations','correction_of','correction_reason']);
 if((b.encounter_id==null)===(b.admission_id==null))fail(422,'Choose exactly one encounter or admission context.','CARE_CONTEXT_REQUIRED');
 const patient=await I.locate('patient',b.patient_id,actor,t),patientId=I.legacyNumber(patient);
 await scope(actor,patientId,true,t);
 let encounter:number|null=null,admission:number|null=null;
 if(b.encounter_id!=null){const e=await I.locate('encounter',b.encounter_id,actor,t);if(Number(e.patient_id)!==patientId)fail(409,'Encounter and patient do not match.','PATIENT_CONTEXT_MISMATCH');
  const [row]=await q("SELECT status FROM hms_encounters WHERE id=:id AND facility_id=:facility FOR SHARE",{id:e.id,facility:actor.facilityId},t);
  if(!row||row.status==='Finalized')fail(409,'A new observation needs an open encounter.','CARE_CONTEXT_CLOSED');encounter=I.legacyNumber(e);
 }else{const a=await I.locate('admission',b.admission_id,actor,t);if(Number(a.patient_id)!==patientId)fail(409,'Admission and patient do not match.','PATIENT_CONTEXT_MISMATCH');
  const [row]=await q("SELECT status FROM hms_admissions WHERE id=:id AND facility_id=:facility FOR SHARE",{id:a.id,facility:actor.facilityId},t);
  if(!row||row.status!=='Active')fail(409,'A new observation needs an active admission.','CARE_CONTEXT_CLOSED');admission=I.legacyNumber(a);
 }
 const observedAt=observedTime(b.observed_at),values=b.observations;
 if(!Array.isArray(values)||values.length<1||values.length>30)fail(422,'Provide between 1 and 30 observations.','INVALID_OBSERVATIONS');
 const seen=new Set<string>(),clean:any[]=[];
 for(const raw of values){const o=object(raw,['code','value','unit_code','method']),code=String(o.code||''),rule=CODES[code];
  if(!rule)fail(422,'Choose a supported observation code.','OBSERVATION_CODE_UNSUPPORTED');if(seen.has(code))fail(422,'An observation set cannot repeat a code.','DUPLICATE_OBSERVATION');seen.add(code);
  const unit=code==='body-temperature'?String(o.unit_code||''):rule.unit;
  if(code==='body-temperature'?!['Cel','[degF]'].includes(unit):o.unit_code!==rule.unit)fail(422,`The unit for ${code} must be ${rule.unit}.`,'OBSERVATION_UNIT_MISMATCH');
  if(typeof o.value!=='number'||!Number.isFinite(o.value))fail(422,`The value for ${code} must be a finite number.`,'INVALID_OBSERVATION_VALUE');
  if(o.method!=null&&(typeof o.method!=='string'||o.method.length>200))fail(422,'method must be at most 200 characters.','INVALID_OBSERVATION_METHOD');
  clean.push({code,value:o.value,unit,display:code==='body-temperature'?(unit==='Cel'?'°C':'°F'):rule.display,method:o.method||null});
 }
 let correctionOf:string|null=null,reason:string|null=null;
 if(b.correction_of!=null){
  if(typeof b.correction_of!=='string'||!/^[0-9a-f-]{36}$/i.test(b.correction_of)||typeof b.correction_reason!=='string'||b.correction_reason.trim().length<10||b.correction_reason.trim().length>500)
   fail(422,'A correction requires the prior observation-set UUID and a 10–500 character reason.','CORRECTION_REASON_REQUIRED');
  const [prior]=await q('SELECT id,patient_id,encounter_id,admission_id FROM hms_observation_sets WHERE public_id=CAST(:id AS uuid) AND facility_id=:facility FOR SHARE',{id:b.correction_of,facility:actor.facilityId},t);
  if(!prior||Number(prior.patient_id)!==patientId||Number(prior.encounter_id||0)!==Number(encounter||0)||Number(prior.admission_id||0)!==Number(admission||0))fail(409,'The correction must stay with the same patient and care context.','CORRECTION_CONTEXT_MISMATCH');
  correctionOf=prior.id;reason=b.correction_reason.trim();
 }
 const [set]=await q(`INSERT INTO hms_observation_sets(patient_id,encounter_id,admission_id,context_kind,observed_at,recorded_by,facility_id,source_kind,correction_of,correction_reason)
  VALUES(:patient,:encounter,:admission,:kind,:observedAt,:user,:facility,'native',:correctionOf,:reason) RETURNING id,public_id`,
  {patient:patientId,encounter,admission,kind:admission?'admission':'encounter',observedAt,user:actor.id,facility:actor.facilityId,correctionOf,reason},t);
 for(const o of clean)await q(`INSERT INTO hms_observations(set_id,facility_id,code,code_system,value_numeric,unit_code,unit_display,method)
  VALUES(:set,:facility,:code,'urn:hms:observation',:value,:unit,:display,:method)`,{set:set.id,facility:actor.facilityId,...o},t);
 await publish('clinical.observation.recorded',`user:${actor.id}`,{patient_id:patientId,observation_set_id:set.public_id,count:clean.length},{transaction:t});
 return view(set.public_id,actor,t);
}
async function byPatient(patientUuid:string,actor:Actor,t?:Transaction){
 const patient=await I.locate('patient',patientUuid,actor,t);await scope(actor,I.legacyNumber(patient),false,t);
 const rows=await q(`SELECT public_id FROM hms_observation_sets WHERE patient_id=:patient AND facility_id=:facility ORDER BY observed_at DESC,id DESC LIMIT 500`,{patient:patient.id,facility:actor.facilityId},t);
 const data=[];for(const row of rows)data.push(await view(row.public_id,actor,t));return data;
}
async function authorizeRequest(path:string,method:string,body:any,actor:Actor){
 if(!['POST','PUT','PATCH','DELETE'].includes(method)||path!=='/observations')return;
 if(!['doctor','nurse'].includes(actor.role))fail(403,'A clinician must record observations.','CLINICAL_ROLE_REQUIRED');
 await F.requirePrivilege(actor,'CHART_READ');
 const patient=await I.locate('patient',body?.patient_id,actor);await scope(actor,I.legacyNumber(patient),true);
}
module.exports={create,view,byPatient,authorizeRequest};
