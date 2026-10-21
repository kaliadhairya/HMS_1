// Laboratory orders through the v2 API (completion A3). Patients, encounters and orders are
// named by public identifier; the order command itself (privileges, patient scope, encounter
// state, registration, catalogue version checks) is the same one the legacy route calls.
// Cancellation requires If-Match with the order revision it was based on.
const I=require('./identities.cts');
const O=require('./laboratoryOrders');
const S=require('./laboratorySpecimens');
const R=require('./laboratoryResults');
const F=require('./laboratoryFollowup');
const C=require('./laboratoryCommon');
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}

// Lab orders and ordered tests count revisions from 0; v2 versions start at 1, so the public
// version is the revision plus one, and an If-Match is translated back before the shared check.
const publicVersion=(revision:any)=>Number(revision)+1;
function labIfMatch(ifMatch:any){
 if(ifMatch===undefined||ifMatch===null||ifMatch==='')return undefined;
 const m=/^"?(\d+)"?$/.exec(String(ifMatch));
 if(!m||Number(m[1])<1)fail(422,'If-Match must be the version this API returned.','INVALID_PRECONDITION');
 return String(Number(m[1])-1);
}
function project(order:any){
 const items=(order.items||[]).map((i:any)=>({id:i.public_id,test_version_id:i.lab_test_version_id??null,item_name:i.item_name,status:i.status,lab_state:i.lab_state??null,version:publicVersion(i.lab_revision)}));
 return {id:order.public_id,version:publicVersion(order.lab_revision),status:order.status,items};
}

async function create(body:any,actor:any,t:any){
 if(!body?.patient_id||!body?.encounter_id)fail(422,'patient_id and encounter_id are required.','VALIDATION_FAILED');
 const patient=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));
 const encounter=I.legacyNumber(await I.locate('encounter',body.encounter_id,actor,t));
 const order=await O.create({...body,patient_id:patient,encounter_id:encounter},actor,t);
 return project(order);
}

async function read(id:string,actor:any,t:any){
 if(!['doctor','nurse','lab_technician'].includes(actor.role))fail(403,'Your role cannot read laboratory orders.','ROLE_NOT_PERMITTED');
 const orderId=I.legacyNumber(await I.locate('lab_order',id,actor,t));
 const order=await C.one('SELECT * FROM hms_investigation_orders WHERE id=:id',{id:orderId},t);
 if(!order)fail(404,'Laboratory order not found.','RESOURCE_NOT_FOUND');
 await C.scope(actor,order.patient_id,t);
 const items=await C.q('SELECT * FROM hms_investigation_order_items WHERE order_id=:id ORDER BY id',{id:orderId},t);
 return {...project({...order,items}),patient_id:await publicOf('hms_patients',order.patient_id,t)};
}

async function cancel(id:string,ifMatch:any,actor:any,t:any){
 const orderId=I.legacyNumber(await I.locate('lab_order',id,actor,t));
 const done=await O.cancel(orderId,actor,labIfMatch(ifMatch),t);
 return {id,version:publicVersion(done.revision),status:'Cancelled',items:[]};
}

// Specimens, results, reports and critical-result follow-up (A3, blueprint 3.10). Patients,
// ordered tests and orders are named by public identifier; specimens, result versions and
// critical tasks by their own UUIDs. Each step is the legacy laboratory command, so custody,
// privileges, QC, release rules and the If-Match revision checks are the same for both APIs.
// The version of a specimen or task is its revision; of a result, its ordered test's revision.
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
 const r=await R.write(item,{...body,specimen_id:body?.specimen_id?uuid(body.specimen_id,'specimen_id'):undefined},actor,labIfMatch(ifMatch),t);
 return {id:r.result.id,item_id:itemId,specimen_id:r.result.specimen_id??null,value:r.result.raw_value??null,unit:r.result.unit??null,state:'ENTERED',version:publicVersion(r.revision)};
}

async function verifyResult(id:string,body:any,ifMatch:any,actor:any,t:any){
 const r=await R.review(uuid(id,'The result'),body||{},actor,labIfMatch(ifMatch),t);
 return {id,decision:r.decision,critical_result_id:r.critical_task?.id??null,version:publicVersion(r.revision)};
}

async function releaseReport(orderId:string,body:any,ifMatch:any,actor:any,t:any){
 const order=I.legacyNumber(await I.locate('lab_order',orderId,actor,t));
 const r=await R.release(order,body||{},actor,labIfMatch(ifMatch),t);
 return {id:r.report.id,order_id:orderId,report_version_id:r.version.id,report_version:Number(r.version.version),status:r.version.status,version:publicVersion(r.revision)};
}

// Acknowledging a critical result and documenting the clinical action are separate commands.
async function criticalStep(id:string,action:'acknowledge'|'close',body:any,ifMatch:any,actor:any,t:any){
 const task=await F.taskCommand(uuid(id,'The critical result'),{...body,action},actor,ifMatch,t,'critical');
 return {id:task.id,state:task.state,acknowledged_at:task.acknowledged_at??null,clinical_action:task.clinical_action??null,closed_at:task.closed_at??null,version:Number(task.revision)};
}

module.exports={create,read,cancel,createSpecimen,specimenStep,enterResult,verifyResult,releaseReport,criticalStep};
