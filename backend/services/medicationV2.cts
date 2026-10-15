import type {Transaction} from 'sequelize';
const C=require('./medicationCommon'),O=require('./medicationOrders'),Inventory=require('./medicationInventory'),Nursing=require('./medicationNursing');
const Access=require('./medicationAccess.cts'),I=require('./identities.cts'),Notes=require('./encounterNotes.cts'),Schema=require('../domain/medicationCommandSchema.cts');
type Actor={id:number;role:string;facilityId?:string};
function fail(status:number,message:string,code:string,current?:number):never{throw Object.assign(new Error(message),{status,code,current});}
function object(value:unknown,allowed:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))fail(422,'Send a JSON object.','INVALID_REQUEST');
 const b=value as Record<string,unknown>;for(const k of Object.keys(b))if(!allowed.includes(k))fail(422,`Unsupported field ${k}; use the documented snake_case contract.`,'UNSUPPORTED_FIELD');return b;
}
function quantities(b:Record<string,unknown>){
 for(const k of ['dose','supply_quantity','max_dose','max_period_hours','quantity'])if(b[k]!==undefined&&b[k]!==null&&typeof b[k]!=='string')fail(422,`${k} must be an exact decimal string.`,'DECIMAL_STRING_REQUIRED');
 if(b.prn!==undefined&&typeof b.prn!=='boolean')fail(422,'prn must be a boolean.','INVALID_FIELD_VALUE');
 if(b.frequency!==undefined)object(b.frequency,['type','interval_minutes']);
}
function overrides(value:unknown){if(value===undefined)return;if(!Array.isArray(value)||value.length>100)fail(422,'Use at most 100 explicit override requests.','INVALID_OVERRIDES');
 for(const item of value){const b=object(item,['finding_code','reason']);if(typeof b.finding_code!=='string'||typeof b.reason!=='string')fail(422,'Each override must identify its finding and recorded reason.','INVALID_OVERRIDES');}}
async function reference(kind:string,id:number,actor:Actor,t:Transaction){return (await I.locate(kind,id,actor,t,true)).public_id;}
async function view(o:any,v:any,actor:Actor,t:Transaction){
 const [review]=await C.q('SELECT state,reviewer_user_id,reviewed_at,reason FROM hms_med_verifications WHERE version_id=:id AND facility_id=:facility',{id:v.id,facility:actor.facilityId},t);
 const [supply]=await C.q('SELECT (CAST(:limit AS numeric)-coalesce(sum(quantity),0))::text remaining FROM hms_med_dispense_lines WHERE version_id=:id AND facility_id=:facility',{limit:v.supply_quantity,id:v.id,facility:actor.facilityId},t);
 return {id:o.id,patient_id:await reference('patient',o.patient_id,actor,t),encounter_id:await reference('encounter',o.encounter_id,actor,t),
 admission_id:o.admission_id?await reference('admission',o.admission_id,actor,t):null,prescriber_id:await reference('principal',o.prescriber_user_id,actor,t),facility_id:o.facility_id,
 state:o.state,version:o.api_version,order_version_id:v.id,content_version:v.version,product_id:v.product_id,ingredient_id:v.ingredient_id,product_snapshot:v.product_snapshot,
 dose:String(v.dose),dose_unit:v.dose_unit,route:v.route,frequency:v.frequency,starts_at:v.starts_at,ends_at:v.ends_at,prn:v.prn,indication:v.indication,
 max_dose:v.max_dose===null?null:String(v.max_dose),max_period_hours:v.max_period_hours===null?null:String(v.max_period_hours),min_interval_minutes:v.min_interval_minutes,
 supply_quantity:String(v.supply_quantity),supply_unit:v.supply_unit,remaining_quantity:supply.remaining,signed_at:v.signed_at,
 verification:review?{state:review.state,reviewer_id:review.reviewer_user_id?await reference('principal',review.reviewer_user_id,actor,t):null,reviewed_at:review.reviewed_at,reason:review.reason}:null};
}
async function read(id:string,actor:Actor,t:Transaction){await Access.authorize(actor,'CHART_READ',t);const {o,v}=await C.order(id,t,false);await Access.authorize(actor,'CHART_READ',t,o.patient_id);return view(o,v,actor,t);}
async function create(input:unknown,actor:Actor,t:Transaction){
 const b=object(input,Schema.createFields);quantities(b);await Access.authorize(actor,'PRESCRIBE',t);
 const mapped:any={...b,patient_id:I.legacyNumber(await I.locate('patient',b.patient_id,actor,t)),encounter_id:I.legacyNumber(await I.locate('encounter',b.encounter_id,actor,t))};
 if(b.admission_id!==undefined&&b.admission_id!==null)mapped.admission_id=I.legacyNumber(await I.locate('admission',b.admission_id,actor,t));
 const {order,version}=await O.createOrder(mapped,actor,t);return view(order,version,actor,t);
}
async function locked(id:string,actor:Actor,header:unknown,t:Transaction,action:string){
 await Access.authorize(actor,action,t);const state=await C.order(id,t);await Access.authorize(actor,action,t,state.o.patient_id);
 const expected=Notes.expected(header);if(expected!==state.o.api_version)fail(412,'This order changed. Compare its current content and fulfillment before retrying.','VERSION_STALE',state.o.api_version);return state;
}
async function transition(id:string,action:string,input:unknown,actor:Actor,header:unknown,t:Transaction){
 const b=object(input,action==='amend'?[...Schema.contentFields,'reason']:action==='sign'?['reason','override_requests']:['reason']);quantities(b);overrides(b.override_requests);
 const {o}=await locked(id,actor,header,t,'PRESCRIBE');const result=await O.transition(id,action,b,actor,String(o.revision),t);return view(result.order,result.version,actor,t);
}
async function verify(id:string,input:unknown,actor:Actor,header:unknown,t:Transaction){
 const b=object(input,['state','reason','coverage_acknowledged','overrides']);overrides(b.overrides);
 const {o}=await locked(id,actor,header,t,'DISPENSE');await O.verify(id,b,actor,String(o.revision),t);
 const updated=await C.order(id,t,false);return view(updated.o,updated.v,actor,t);
}
async function dispense(input:unknown,actor:Actor,header:unknown,t:Transaction){
 const b=object(input,Schema.dispenseFields);quantities(b);
 const {o,v}=await locked(String(b.order_id),actor,header,t,'DISPENSE');
 if(!I.isUuid(b.order_version_id)||b.order_version_id!==v.id)fail(409,'Dispense must identify the exact current order line version.','ORDER_VERSION_MISMATCH');
 const result=await Inventory.dispense(o.id,b,actor,String(o.revision),t);return dispenseView(result.dispense,actor,t,result.lines);
}
async function dispenseView(d:any,actor:Actor,t:Transaction,provided?:any[]){
 const version=await C.one('SELECT order_id FROM hms_med_order_versions WHERE id=:id AND facility_id=:facility',{id:d.version_id,facility:actor.facilityId},t);
 if(!version)fail(503,'Fulfillment order version requires reconciliation.','ORDER_VERSION_UNAVAILABLE');
 const {o}=await C.order(version.order_id,t,false);
 await Access.authorize(actor,'CHART_READ',t,o.patient_id);if(Number(d.patient_id)!==Number(o.patient_id))fail(503,'Fulfillment identity requires reconciliation.','FULFILLMENT_IDENTITY_MISMATCH');
 const lines=provided||await C.q('SELECT * FROM hms_med_dispense_lines WHERE dispense_id=:id AND facility_id=:facility ORDER BY id',{id:d.id,facility:actor.facilityId},t);
 return {id:d.id,version:d.api_version,patient_id:await reference('patient',d.patient_id,actor,t),order_id:o.id,order_version_id:d.version_id,
 dispenser_id:await reference('principal',d.dispenser_user_id,actor,t),facility_id:d.facility_id,created_at:d.created_at,order_version:o.api_version,
 lines:await Promise.all(lines.map(async(l:any)=>({id:l.id,order_version_id:l.version_id,product_id:l.product_id,batch_id:await reference('batch',l.batch_id,actor,t),location_id:l.location_id,
  substitution_id:l.substitution_id,quantity:String(l.quantity),unit:l.unit,rate:String(l.rate),amount:String(l.amount)})))};
}
async function readDispense(id:string,actor:Actor,t:Transaction){
 await Access.authorize(actor,'CHART_READ',t);if(!I.isUuid(id))fail(422,'A canonical UUID is required.','UUID_REQUIRED');
 const d=await C.one('SELECT * FROM hms_med_dispenses WHERE id=:id AND facility_id=:facility',{id,facility:actor.facilityId},t);if(!d)fail(404,'Dispense not found in the current facility.','RESOURCE_NOT_FOUND');return dispenseView(d,actor,t);
}
async function occurrence(id:string,actor:Actor,t:Transaction,lock=false){
 if(!I.isUuid(id))fail(422,'A canonical occurrence UUID is required.','UUID_REQUIRED');
 const hint=await C.one('SELECT v.order_id FROM hms_med_schedules s JOIN hms_med_order_versions v ON v.id=s.version_id AND v.facility_id=s.facility_id WHERE s.id=:id AND s.facility_id=:facility',{id,facility:actor.facilityId},t);
 if(!hint)fail(404,'Occurrence not found in the current facility.','RESOURCE_NOT_FOUND');
 // Match the shared command's parent-before-occurrence lock order.
 const {o}=await C.order(hint.order_id,t,lock);
 const s=await C.one(`SELECT * FROM hms_med_schedules WHERE id=:id AND facility_id=:facility ${lock?'FOR UPDATE':''}`,{id,facility:actor.facilityId},t);
 return {o,s};
}
async function scheduleView(o:any,s:any,actor:Actor,t:Transaction){
 const claim=await C.one('SELECT id,state,performer_user_id,created_at,documented_at FROM hms_med_documentation_intents WHERE schedule_id=:id AND facility_id=:facility',{id:s.id,facility:actor.facilityId},t);
 return {id:s.id,version:s.api_version,order_id:o.id,order_version_id:s.version_id,patient_id:await reference('patient',s.patient_id,actor,t),facility_id:s.facility_id,scheduled_at:s.scheduled_at,state:s.state,prn:s.prn,indication:s.indication,
  bedside_claim:claim?{id:claim.id,state:claim.state,performer_id:await reference('principal',claim.performer_user_id,actor,t),created_at:claim.created_at,documented_at:claim.documented_at}:null};
}
async function readSchedule(id:string,actor:Actor,t:Transaction){
 await Access.authorize(actor,'CHART_READ',t);const {o,s}=await occurrence(id,actor,t);await Access.authorize(actor,'CHART_READ',t,o.patient_id);return scheduleView(o,s,actor,t);
}
async function schedule(id:string,input:unknown,actor:Actor,header:unknown,t:Transaction){
 const b=object(input,['from_at','through_at']),action=actor.role==='pharmacist'?'DISPENSE':'NURSING_DOCUMENT';
 const {o}=await locked(id,actor,header,t,action);const created=await Nursing.schedule(id,b,actor,String(o.revision),t);
 return {id:o.id,version:o.api_version,patient_id:await reference('patient',o.patient_id,actor,t),occurrences:await Promise.all(created.map((s:any)=>scheduleView(o,s,actor,t)))};
}
async function mappedAdministration(input:unknown,actor:Actor,t:Transaction):Promise<Record<string,any>>{
 await Access.authorize(actor,'NURSING_DOCUMENT',t);
 const b=object(input,Schema.administrationFields);quantities(b);
 if(b.scan_evidence!==undefined)object(b.scan_evidence,['mode','patient_identifier','product_id','product_barcode','reason','identity_confirmed','dose_checked','route_checked','time_checked']);
 return {...b,patient_id:I.legacyNumber(await I.locate('patient',b.patient_id,actor,t))};
}
async function reviewedOccurrence(input:any,actor:Actor,header:unknown,t:Transaction){
 await Access.authorize(actor,'NURSING_DOCUMENT',t);const {o,s}=await occurrence(input.schedule_id,actor,t,true);
 if(Notes.expected(header)!==s.api_version)fail(412,'This occurrence changed. Review its claim and documentation before retrying.','VERSION_STALE',s.api_version);
 if(!I.isUuid(input.order_version_id)||input.order_version_id!==s.version_id)fail(409,'Documentation must identify the exact scheduled order version.','ORDER_VERSION_MISMATCH');
 return {o,s};
}
async function prepare(id:string,input:unknown,actor:Actor,header:unknown,t:Transaction){
 const publicInput=object(input,Schema.administrationFields.filter((k:string)=>k!=='schedule_id'));
 const b=await mappedAdministration({...publicInput,schedule_id:id},actor,t);const {o}=await reviewedOccurrence(b,actor,header,t);
 await Nursing.prepare(id,b,actor,t);const {s}=await occurrence(id,actor,t);return scheduleView(o,s,actor,t);
}
async function administrationView(a:any,actor:Actor,t:Transaction){
 const {o,s}=await occurrence(a.schedule_id,actor,t);
 return {id:a.id,version:1,schedule_id:s.id,schedule_version:s.api_version,order_id:o.id,order_version_id:a.version_id,patient_id:await reference('patient',a.patient_id,actor,t),facility_id:a.facility_id,
 product_id:a.product_id,dispense_line_id:a.dispense_line_id,outcome:a.outcome,dose:String(a.dose),dose_unit:a.dose_unit,route:a.route,actual_at:a.actual_at,recorded_at:a.recorded_at,performer_id:await reference('principal',a.performer_user_id,actor,t),scan_evidence:a.scan_evidence,reason:a.reason,witness_id:a.witness_id,base_quantity:String(a.base_quantity),late_review_id:a.late_review_id};
}
async function administer(input:unknown,actor:Actor,header:unknown,t:Transaction){
 const b=await mappedAdministration(input,actor,t);await reviewedOccurrence(b,actor,header,t);
 return administrationView(await Nursing.administer(b.schedule_id,b,actor,t),actor,t);
}
async function readAdministration(id:string,actor:Actor,t:Transaction){
 await Access.authorize(actor,'CHART_READ',t);if(!I.isUuid(id))fail(422,'A canonical administration UUID is required.','UUID_REQUIRED');
 const a=await C.one('SELECT * FROM hms_med_administrations WHERE id=:id AND facility_id=:facility',{id,facility:actor.facilityId},t);if(!a)fail(404,'Administration not found in the current facility.','RESOURCE_NOT_FOUND');
 await Access.authorize(actor,'CHART_READ',t,a.patient_id);return administrationView(a,actor,t);
}
// This runs before command-receipt lookup too: a previously successful response
// does not retain clinical access after a qualification/privilege is revoked.
async function authorizeRequest(path:string,method:string,actor:Actor){
 if(!/^\/(medication-orders|medication-schedules|dispenses|administrations)(?:\/|$)/.test(path))return;
 const action=method==='GET'?'CHART_READ':/^\/dispenses(?:\/|$)/.test(path)||/\/verify$/.test(path)?'DISPENSE':/^\/(administrations|medication-schedules)(?:\/|$)/.test(path)?'NURSING_DOCUMENT':/\/schedules$/.test(path)?actor.role==='pharmacist'?'DISPENSE':'NURSING_DOCUMENT':'PRESCRIBE';
 await Access.authorize(actor,action);
}
module.exports={read,create,transition,verify,dispense,readDispense,readSchedule,schedule,prepare,administer,readAdministration,authorizeRequest};
