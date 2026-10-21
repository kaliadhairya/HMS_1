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

module.exports={create,cancel};
