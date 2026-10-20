// One source for the implemented public clinical API schemas and client types.
// Planned adapters are documented separately; this does not advertise absent endpoints.
const fs=require('node:fs'),path=require('node:path');
type Schema={type?:string|string[];format?:string;enum?:unknown[];properties?:Record<string,Schema>;required?:string[];additionalProperties?:boolean|Schema;$ref?:string;items?:Schema;anyOf?:Schema[];minimum?:number};
const ref=(name:string):Schema=>({$ref:`#/components/schemas/${name}`});
const uuid:Schema={type:'string',format:'uuid'},integer:Schema={type:'integer',minimum:1},text:Schema={type:'string'},nullable=(s:Schema):Schema=>({anyOf:[s,{type:'null'}]});
const object=(properties:Record<string,Schema>,required=Object.keys(properties)):Schema=>({type:'object',properties,required,additionalProperties:false});
const DocumentSchema=require('../domain/clinicalDocumentSchema.cts');
const MedicationSchema=require('../domain/medicationCommandSchema.cts');
const instant:Schema={type:'string',format:'date-time'},decimal:Schema={type:'string'},boolean:Schema={type:'boolean'};
const medContent:Record<string,Schema>={product_id:nullable(uuid),ingredient_id:nullable(uuid),dose:decimal,dose_unit:text,route:text,frequency:object({type:text,interval_minutes:integer},['type']),starts_at:instant,ends_at:instant,prn:boolean,indication:nullable(text),max_dose:nullable(decimal),max_period_hours:nullable(decimal),min_interval_minutes:nullable(integer),supply_quantity:decimal,supply_unit:text};
if(MedicationSchema.contentFields.some((key:string)=>!medContent[key]))throw new Error('Medication domain fields require a public contract.');
const scan=object({mode:{type:'string',enum:['BARCODE','MANUAL']},patient_identifier:text,product_id:uuid,product_barcode:text,reason:text,identity_confirmed:boolean,dose_checked:boolean,route_checked:boolean,time_checked:boolean},['mode','patient_identifier','dose_checked','route_checked','time_checked']);
const adminInput={schedule_id:uuid,order_version_id:uuid,patient_id:uuid,product_id:uuid,dispense_line_id:uuid,dose:decimal,dose_unit:text,route:text,scan_evidence:scan,outcome:{type:'string',enum:['GIVEN','HELD','REFUSED','OMITTED']} as Schema,actual_at:instant,reason:text,witness_id:uuid,late_review_id:uuid};
const adminRequired=['schedule_id','order_version_id','patient_id','product_id','dose','dose_unit','route','scan_evidence','outcome','actual_at'];
const noteKeys:string[]=DocumentSchema.encounterFields;
const sectionNames=(type:string):string[]=>DocumentSchema.fields[type].map((k:string)=>Object.entries(DocumentSchema.publicSectionKeys).find(([,v])=>v===k)?.[0]||k);
const noteProps=Object.fromEntries(noteKeys.map(k=>[k,nullable(text)]));
const resourceKinds=['principal','patient','practitioner','department','doctor_record','encounter','admission','ward','bed','appointment','token','clinical_document','diagnosis','lab_order','lab_item','vital','patient_document','medicine_legacy','batch','supplier','prescription_legacy','prescription_item_legacy','bill_legacy','bill_item_legacy','payment_legacy'];
const schemas:Record<string,Schema>={
 Error:object({success:{type:'boolean',enum:[false]},code:text,message:text,current_version:integer},['success','message']),
 Identity:object({resource_type:{type:'string',enum:resourceKinds},id:uuid}),
 Patient:object({id:uuid,uhid:nullable(text),name:text,gender:nullable(text),dob:nullable({type:'string',format:'date'}),age:nullable({type:['integer','number','string']}),identity_status:text,merged_into_patient_id:nullable(uuid),version:integer}),
 EncounterDraft:object(noteProps,[]),
 EncounterCreate:object({patient_id:uuid,token_id:nullable(uuid),appointment_id:nullable(uuid),department_id:nullable(uuid),chief_complaint:nullable(text),encounter_type:{type:'string',enum:['OPD','IPD','Emergency']}},['patient_id']),
 Encounter:object({id:uuid,patient_id:uuid,doctor_id:uuid,facility_id:uuid,status:text,encounter_type:nullable(text),occurred_at:nullable({type:'string',format:'date-time'}),version:integer,note_version:integer,token_id:nullable(uuid),appointment_id:nullable(uuid),department_id:nullable(uuid),notes_document_id:nullable(uuid),...noteProps,signed_note_version:integer,signature_digest:text},['id','patient_id','doctor_id','facility_id','status','version','note_version',...noteKeys]),
 Empty:object({}),
 DocumentType:{type:'string',enum:['clinical_note','discharge_summary','nursing_assessment','care_plan','encounter_note']},
 DocumentContent:{anyOf:Object.keys(DocumentSchema.fields).map(type=>object(Object.fromEntries(sectionNames(type).map(k=>[k,nullable(text)])),[]))},
 DocumentCreate:{anyOf:Object.keys(DocumentSchema.fields).filter(type=>type!=='encounter_note').map(type=>object({patient_id:uuid,encounter_id:nullable(uuid),admission_id:nullable(uuid),
  doc_type:{type:'string',enum:[type]},content:object(Object.fromEntries(sectionNames(type).map(k=>[k,nullable(text)])),[])},['patient_id',...(type==='clinical_note'?[]:['doc_type']),...(type==='discharge_summary'?['admission_id']:[])]))},
 DocumentDraft:object({content:ref('DocumentContent')}),
 Amendment:object({reason:text}),
 Signature:object({version:integer,canonical_signed_content:{type:'object',additionalProperties:nullable(text)},canonicalization:{type:'string',enum:['hms-json-v1']},digest:text,meaning:text,amends_version:nullable(integer),amendment_reason:nullable(text),signed_at:{type:'string',format:'date-time'},signed_by:uuid,signed_by_name:text}),
 ClinicalDocument:object({id:uuid,patient_id:uuid,encounter_id:nullable(uuid),admission_id:nullable(uuid),author_user_id:uuid,facility_id:uuid,doc_type:ref('DocumentType'),state:{type:'string',enum:['draft','signed']},version:integer,draft_version:integer,signed_version:nullable(integer),amendment_reason:nullable(text),content:ref('DocumentContent'),signatures:{type:'array',items:ref('Signature')}}),
 ObservationInput:object({code:text,value:{type:'number'},unit_code:text,method:nullable(text)},['code','value','unit_code']),
 ObservationCreate:object({patient_id:uuid,encounter_id:nullable(uuid),admission_id:nullable(uuid),observed_at:instant,observations:{type:'array',items:ref('ObservationInput')},correction_of:nullable(uuid),correction_reason:nullable(text)},['patient_id','observed_at','observations']),
 Observation:{type:'object',properties:{id:uuid,code:text,code_system:text,value:{type:'number'},unit_code:nullable(text),unit_display:nullable(text),method:nullable(text)},required:['id','code','code_system','value','unit_code','unit_display','method'],additionalProperties:false},
 ObservationSet:{type:'object',properties:{id:uuid,patient_id:uuid,encounter_id:nullable(uuid),admission_id:nullable(uuid),context_kind:{type:'string',enum:['encounter','admission']},observed_at:instant,recorded_by:uuid,facility_id:uuid,source:text,correction_of:nullable(uuid),correction_reason:nullable(text),observations:{type:'array',items:ref('Observation')}},required:['id','patient_id','encounter_id','admission_id','context_kind','observed_at','recorded_by','facility_id','source','correction_of','correction_reason','observations'],additionalProperties:false},
 ObservationSetList:{type:'array',items:ref('ObservationSet')},
 MedicationCreate:object({patient_id:uuid,encounter_id:uuid,admission_id:nullable(uuid),...medContent},['patient_id','encounter_id','dose','dose_unit','route','frequency','starts_at','ends_at','supply_quantity','supply_unit']),
 MedicationOverride:object({finding_code:text,reason:text}),
 MedicationSign:object({reason:text,override_requests:{type:'array',items:ref('MedicationOverride')}},[]),
 MedicationReason:object({reason:text}),
 MedicationAmend:object({...medContent,reason:text},['reason']),
 MedicationVerify:object({state:{type:'string',enum:['VERIFIED','CLARIFICATION']},reason:text,coverage_acknowledged:boolean,overrides:{type:'array',items:ref('MedicationOverride')}},['state','reason']),
 MedicationOrder:object({id:uuid,version:integer,patient_id:uuid,encounter_id:uuid,admission_id:nullable(uuid),prescriber_id:uuid,facility_id:uuid,state:text,order_version_id:uuid,content_version:integer,...medContent,product_snapshot:nullable({type:'object',additionalProperties:true}),remaining_quantity:decimal,signed_at:nullable(instant),verification:nullable(object({state:text,reviewer_id:nullable(uuid),reviewed_at:nullable(instant),reason:nullable(text)}))}),
 DispenseCreate:object({order_id:uuid,order_version_id:uuid,product_id:uuid,location_id:uuid,quantity:decimal,witness_id:uuid,reason:text},['order_id','order_version_id','product_id','location_id','quantity']),
 DispenseLine:object({id:uuid,order_version_id:uuid,product_id:uuid,batch_id:uuid,location_id:uuid,substitution_id:nullable(uuid),quantity:decimal,unit:text,rate:decimal,amount:decimal}),
 Dispense:object({id:uuid,version:integer,patient_id:uuid,order_id:uuid,order_version_id:uuid,dispenser_id:uuid,facility_id:uuid,created_at:instant,order_version:integer,lines:{type:'array',items:ref('DispenseLine')}}),
 MedicationSchedule:object({id:uuid,version:integer,order_id:uuid,order_version_id:uuid,patient_id:uuid,facility_id:uuid,scheduled_at:instant,state:text,prn:boolean,indication:nullable(text),bedside_claim:nullable(object({id:uuid,state:text,performer_id:uuid,created_at:instant,documented_at:nullable(instant)}))}),
 MedicationScheduleCreate:object({from_at:instant,through_at:instant},['through_at']),
 MedicationSchedules:object({id:uuid,version:integer,patient_id:uuid,occurrences:{type:'array',items:ref('MedicationSchedule')}}),
 MedicationPrepare:object(Object.fromEntries(Object.entries(adminInput).filter(([key])=>key!=='schedule_id')),['order_version_id','patient_id','product_id','dispense_line_id','dose','dose_unit','route','scan_evidence']),
 AdministrationCreate:object(adminInput,adminRequired),
 Administration:object({id:uuid,version:integer,schedule_id:uuid,schedule_version:integer,order_id:uuid,order_version_id:uuid,patient_id:uuid,facility_id:uuid,product_id:uuid,dispense_line_id:nullable(uuid),outcome:text,dose:decimal,dose_unit:text,route:text,actual_at:instant,recorded_at:instant,performer_id:uuid,scan_evidence:scan,reason:nullable(text),witness_id:nullable(uuid),base_quantity:decimal,late_review_id:nullable(uuid)}),
};
type Operation={method:string;path:string;name:string;input?:string;output:string;status?:number;version?:boolean};
const operations:Operation[]=[
 {method:'get',path:'/legacy-identities/{kind}/{id}',name:'resolveLegacyIdentity',output:'Identity'},
 {method:'get',path:'/patients/{id}',name:'readPatient',output:'Patient'},
 {method:'get',path:'/encounters/{id}',name:'readEncounter',output:'Encounter'},
 {method:'post',path:'/encounters',name:'createEncounter',input:'EncounterCreate',output:'Encounter',status:201},
 {method:'put',path:'/encounters/{id}/draft',name:'saveEncounterDraft',input:'EncounterDraft',output:'Encounter',version:true},
 {method:'post',path:'/encounters/{id}/sign',name:'signEncounter',input:'Empty',output:'Encounter',version:true},
 {method:'get',path:'/observations/patient/{id}',name:'readPatientObservations',output:'ObservationSetList'},
 {method:'get',path:'/observations/{id}',name:'readObservationSet',output:'ObservationSet'},
 {method:'post',path:'/observations',name:'createObservationSet',input:'ObservationCreate',output:'ObservationSet',status:201},
 {method:'get',path:'/clinical-documents/{id}',name:'readClinicalDocument',output:'ClinicalDocument'},
 {method:'post',path:'/clinical-documents',name:'createClinicalDocument',input:'DocumentCreate',output:'ClinicalDocument',status:201},
 ...(['draft','sign','amend','sign-amendment'] as const).map(action=>({method:action==='draft'?'put':'post',path:`/clinical-documents/{id}/${action}`,name:{draft:'saveDocumentDraft',sign:'signDocument',amend:'startDocumentAmendment','sign-amendment':'signDocumentAmendment'}[action],input:action==='draft'?'DocumentDraft':action==='sign'?'Empty':'Amendment',output:'ClinicalDocument',version:true})),
 {method:'get',path:'/medication-orders/{id}',name:'readMedicationOrder',output:'MedicationOrder'},
 {method:'post',path:'/medication-orders',name:'createMedicationOrder',input:'MedicationCreate',output:'MedicationOrder',status:201},
 ...(['sign','hold','resume','discontinue','amend','verify'] as const).map(action=>({method:'post',path:`/medication-orders/{id}/${action}`,name:{sign:'signMedicationOrder',hold:'holdMedicationOrder',resume:'resumeMedicationOrder',discontinue:'discontinueMedicationOrder',amend:'amendMedicationOrder',verify:'verifyMedicationOrder'}[action],input:{sign:'MedicationSign',hold:'MedicationReason',resume:'MedicationReason',discontinue:'MedicationReason',amend:'MedicationAmend',verify:'MedicationVerify'}[action],output:'MedicationOrder',version:true})),
 {method:'post',path:'/dispenses',name:'createDispense',input:'DispenseCreate',output:'Dispense',status:201,version:true},
 {method:'get',path:'/dispenses/{id}',name:'readDispense',output:'Dispense'},
 {method:'post',path:'/medication-orders/{id}/schedules',name:'createMedicationSchedules',input:'MedicationScheduleCreate',output:'MedicationSchedules',status:201,version:true},
 {method:'get',path:'/medication-schedules/{id}',name:'readMedicationSchedule',output:'MedicationSchedule'},
 {method:'post',path:'/medication-schedules/{id}/prepare',name:'prepareMedicationAdministration',input:'MedicationPrepare',output:'MedicationSchedule',status:201,version:true},
 {method:'post',path:'/administrations',name:'createAdministration',input:'AdministrationCreate',output:'Administration',status:201,version:true},
 {method:'get',path:'/administrations/{id}',name:'readAdministration',output:'Administration'},
];
const paths:Record<string,Record<string,unknown>>={};
for(const op of operations){
 const command=op.method!=='get',parameters:any[]=[];
 for(const name of [...op.path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]))parameters.push({name,in:'path',required:true,schema:op.path.startsWith('/legacy-identities')?(name==='kind'?{type:'string',enum:resourceKinds}:{type:'string',pattern:'^[1-9][0-9]*$'}):uuid});
 if(command)parameters.push({name:'Idempotency-Key',in:'header',required:true,schema:{type:'string',minLength:8,maxLength:200,pattern:'^[A-Za-z0-9._:-]+$'}});
 if(op.version)parameters.push({name:'If-Match',in:'header',required:true,schema:{type:'string',pattern:'^("[1-9][0-9]*"|[1-9][0-9]*)$'},description:'The public aggregate version returned by this API. Never substitute a legacy draft or content revision.'});
 const envelope=object({success:{type:'boolean',enum:[true]},data:ref(op.output),...(command?{version:integer,operation_id:uuid}:{})});
 const responses:any={[op.status||200]:{description:'Committed response; an exact idempotent replay retains the original operation_id.',headers:{ETag:{schema:text,description:'Public aggregate version'}},content:{'application/json':{schema:envelope}}}};
 for(const code of [400,401,403,404,409,412,422,428,500,503])responses[code]={description:({400:'Malformed transport header',500:'Operation cannot be confirmed; reconcile its original idempotency key',401:'Invalid session',403:'Scope or clinical privilege denied',404:'Resource unavailable in this facility',409:'Invalid state or idempotency conflict',412:'Reviewed version is stale',422:'Invalid clinical fields or identity',428:'Required precondition missing',503:'Integrity or operational state cannot be confirmed'} as Record<number,string>)[code],content:{'application/json':{schema:ref('Error')}}};
 (paths[op.path]||={})[op.method]={operationId:op.name,parameters,responses,...(op.input?{requestBody:{required:true,content:{'application/json':{schema:ref(op.input)}}}}:{})};
}
const spec={openapi:'3.1.0',info:{title:'HMS clinical API v2',version:'2.0.0',description:'Implemented patient, encounter, shared observation, clinical document and medication commands. Observations preserve measured values, units, source and context; no clinical alert thresholds are inferred. Clinical document fields depend on doc_type. Signatures expose the original canonical_signed_content; digest does not cover the snake_case presentation. Dispensing reviews the order version; bedside preparation and administration review the schedule version. Immutable administration records have version 1; corrections remain linked records. Full clinical adapter coverage remains in the clinical completion checklist.'},servers:[{url:'/api/v2'}],security:[{session:[]},{bearer:[]}],paths,components:{securitySchemes:{session:{type:'apiKey',in:'cookie',name:'hms_session'},bearer:{type:'http',scheme:'bearer',bearerFormat:'purpose-bound access assertion'}},schemas}};
function ts(schema:Schema):string{
 if(schema.$ref)return schema.$ref.split('/').pop()!;
 if(schema.enum)return schema.enum.map(v=>JSON.stringify(v)).join(' | ');
 if(schema.anyOf)return schema.anyOf.map(ts).join(' | ');
 if(Array.isArray(schema.type))return schema.type.map(t=>ts({...schema,type:t})).join(' | ');
 if(schema.type==='null')return 'null';if(schema.type==='integer'||schema.type==='number')return 'number';
 if(schema.type==='string')return 'string';if(schema.type==='boolean')return 'boolean';
 if(schema.type==='array')return `Array<${ts(schema.items!)}>`;
 if(schema.type==='object'){
  if(!schema.properties)return `Record<string, ${typeof schema.additionalProperties==='object'?ts(schema.additionalProperties):'unknown'}>`;
  return '{\n'+Object.entries(schema.properties).map(([k,v])=>`  ${JSON.stringify(k)}${schema.required?.includes(k)?'':'?'}: ${ts(v)};`).join('\n')+'\n}';
 }throw new Error('Unsupported contract schema');
}
const types='// Generated by backend/scripts/generateClinicalContracts.cts. Do not edit.\n'+Object.entries(schemas).map(([name,schema])=>`export type ${name} = ${ts(schema)};`).join('\n\n')+'\n\nexport type CommandResponse<T> = {success:true;data:T;version:number;operation_id:string};\nexport type ReadResponse<T> = {success:true;data:T};\n';
const client='// Generated by backend/scripts/generateClinicalContracts.cts. Do not edit.\n'+
 `import type {${Object.keys(schemas).join(', ')}, CommandResponse, ReadResponse} from './v2.generated';\n`+
 `export type ClinicalTransport = {request<T>(config:{method:string;url:string;data?:unknown;headers?:Record<string,string>}):Promise<{data:T}>};\n`+
 operations.map(op=>{
  const command=op.method!=='get',params=[...op.path.matchAll(/\{([^}]+)\}/g)].map(m=>m[1]),args=['transport:ClinicalTransport',...params.map(name=>`${name}:string`)];
  if(op.input)args.push(`body:${op.input}`);
  if(command)args.push(`options:{idempotencyKey:string${op.version?';expectedVersion:number':''}}`);
  const response=`${command?'CommandResponse':'ReadResponse'}<${op.output}>`;
  const url='/v2'+op.path.replace(/\{([^}]+)\}/g,(_,name)=>'${encodeURIComponent('+name+')}');
  return `export async function ${op.name}(${args.join(', ')}):Promise<${response}>{\n`+
   ` return (await transport.request<${response}>({method:${JSON.stringify(op.method)},url:\`${url}\`${op.input?',data:body':''}${command?",headers:{'Idempotency-Key':options.idempotencyKey"+(op.version?",'If-Match':String(options.expectedVersion)":"")+"}":''}})).data;\n}\n`;
 }).join('\n');
const root=path.resolve(__dirname,'../..'),outputs=new Map<string,string>([
 [path.join(root,'backend/contracts/v2.openapi.json'),JSON.stringify(spec,null,2)+'\n'],
 [path.join(root,'frontend/src/api/v2.generated.ts'),types],
 [path.join(root,'frontend/src/api/v2.client.ts'),client],
]);
let failed=false;
for(const [file,contents] of outputs){
 if(process.argv.includes('--check')){if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==contents){console.error('Clinical contract is stale: '+path.relative(root,file));failed=true;}}
 else fs.writeFileSync(file,contents);
}
if(failed)process.exitCode=1;
module.exports={spec,operations};
