// Laboratory orders through the v2 API (completion A3). Patients, encounters and orders are
// named by public identifier; the order command itself (privileges, patient scope, encounter
// state, registration, catalogue version checks) is the same one the legacy route calls.
// Cancellation requires If-Match with the order revision it was based on.
const I=require('./identities.cts');
const O=require('./laboratoryOrders');
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}

function project(order:any){
 const items=(order.items||[]).map((i:any)=>({item_name:i.item_name,status:i.status,lab_state:i.lab_state??null}));
 return {id:order.public_id,version:Number(order.lab_revision),status:order.status,items};
}

async function create(body:any,actor:any,t:any){
 if(!body?.patient_id||!body?.encounter_id)fail(422,'patient_id and encounter_id are required.','VALIDATION_FAILED');
 const patient=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));
 const encounter=I.legacyNumber(await I.locate('encounter',body.encounter_id,actor,t));
 const order=await O.create({...body,patient_id:patient,encounter_id:encounter},actor,t);
 return project(order);
}

async function cancel(id:string,ifMatch:any,actor:any,t:any){
 const orderId=I.legacyNumber(await I.locate('lab_order',id,actor,t));
 const done=await O.cancel(orderId,actor,ifMatch,t);
 return {id,version:Number(done.revision),status:'Cancelled',items:[]};
}

// Specimens, results, reports and critical-result follow-up (A3, blueprint 3.10). Patients,
// ordered tests and orders are named by public identifier; specimens, result versions and
// critical tasks by their own UUIDs. Each step is the legacy laboratory command, so custody,
// privileges, QC, release rules and the If-Match revision checks are the same for both APIs.
// The version of a specimen or task is its revision; of a result, its ordered test's revision.
const S=require('./laboratorySpecimens');
const R=require('./laboratoryResults');
const F=require('./laboratoryFollowup');
const C=require('./laboratoryCommon');
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value:any,name:string):string{if(!UUID.test(String(value??'')))fail(422,`${name} must be an identifier.`,'VALIDATION_FAILED');return String(value);}
async function publicOf(table:string,id:number,t:any):Promise<string>{
 const row=await C.one(`SELECT public_id FROM ${table} WHERE id=:id`,{id},t);
 return row.public_id;
}
async function specimenView(s:any,t:any){
 return {id:s.id,accession:s.accession,patient_id:await publicOf('hms_patients',s.patient_id,t),specimen_type:s.specimen_type,container:s.container,
  location:s.location,state:s.state,collected_at:s.collected_at??null,received_at:s.received_at??null,version:Number(s.revision)};
}

async function createSpecimen(body:any,actor:any,t:any){
 if(!body?.patient_id||!Array.isArray(body?.links))fail(422,'patient_id and links are required.','VALIDATION_FAILED');
 const patient=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));
 const links=[];
 for(const l of body.links)links.push({item_id:I.legacyNumber(await I.locate('lab_item',l?.item_id,actor,t)),requirement_id:uuid(l?.requirement_id,'requirement_id')});
 const s=await S.create({patient_id:patient,specimen_type:body.specimen_type,container:body.container,location:body.location,links},actor,t);
 return specimenView(s,t);
}

// collect, receive or reject: the patient and accession on the label are confirmed again.
const STEPS:Record<string,string>={collect:'COLLECTED',receive:'RECEIVED',reject:'REJECTED'};
async function specimenStep(id:string,step:string,body:any,ifMatch:any,actor:any,t:any){
 const state=STEPS[step];
 if(!state)fail(404,'Unknown specimen step.','RESOURCE_NOT_FOUND');
 if(!body?.patient_id)fail(422,'Confirm the patient on the label (patient_id).','VALIDATION_FAILED');
 const patient=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));
 const s=await S.transition(uuid(id,'The specimen'),{patient_id:patient,accession:body.accession,state,location:body.location,reason:body.reason,occurred_at:body.occurred_at},actor,ifMatch,t);
 return specimenView(s,t);
}

async function enterResult(itemId:string,body:any,ifMatch:any,actor:any,t:any){
 const item=I.legacyNumber(await I.locate('lab_item',itemId,actor,t));
 const r=await R.write(item,{...body,specimen_id:body?.specimen_id?uuid(body.specimen_id,'specimen_id'):undefined},actor,ifMatch,t);
 return {id:r.result.id,item_id:itemId,specimen_id:r.result.specimen_id??null,value:r.result.raw_value??null,unit:r.result.unit??null,state:'ENTERED',version:Number(r.revision)};
}

async function verifyResult(id:string,body:any,ifMatch:any,actor:any,t:any){
 const r=await R.review(uuid(id,'The result'),body||{},actor,ifMatch,t);
 return {id,decision:r.decision,critical_result_id:r.critical_task?.id??null,version:Number(r.revision)};
}

async function releaseReport(orderId:string,body:any,ifMatch:any,actor:any,t:any){
 const order=I.legacyNumber(await I.locate('lab_order',orderId,actor,t));
 const r=await R.release(order,body||{},actor,ifMatch,t);
 return {id:r.report.id,order_id:orderId,report_version_id:r.version.id,report_version:Number(r.version.version),status:r.version.status,version:Number(r.revision)};
}

// Acknowledging a critical result and documenting the clinical action are separate commands.
async function criticalStep(id:string,action:'acknowledge'|'close',body:any,ifMatch:any,actor:any,t:any){
 const task=await F.taskCommand(uuid(id,'The critical result'),{...body,action},actor,ifMatch,t,'critical');
 return {id:task.id,state:task.state,acknowledged_at:task.acknowledged_at??null,clinical_action:task.clinical_action??null,closed_at:task.closed_at??null,version:Number(task.revision)};
}

module.exports={create,cancel,createSpecimen,specimenStep,enterResult,verifyResult,releaseReport,criticalStep};
