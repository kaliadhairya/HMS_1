import type {Transaction} from 'sequelize';
const {sequelize}=require('../models/db');
type Actor={id:number;role:string;facilityId?:string};
const KINDS=['principal','patient','practitioner','department','doctor_record','encounter','admission','ward','bed','appointment','token','clinical_document','diagnosis','lab_order','lab_item','vital','patient_document','medicine_legacy','batch','supplier','prescription_legacy','prescription_item_legacy','bill_legacy','bill_item_legacy','payment_legacy'] as const;
type Resource=typeof KINDS[number];
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
const q=(sql:string,replacements:Record<string,unknown>,transaction?:Transaction):Promise<any[]>=>sequelize.query(sql,{replacements,transaction,type:'SELECT'});
async function registry(kind:Resource,t?:Transaction){
 if(!KINDS.includes(kind))fail(404,'Identity resource is not supported.','IDENTITY_RESOURCE_UNKNOWN');
 const [r]=await q(`SELECT resource_table::text relation,facility_owned,
  (SELECT array_agg(a.attname::text) FROM pg_attribute a WHERE a.attrelid=resource_table AND NOT a.attisdropped AND a.attname IN ('patient_id','facility_id','api_version')) metadata_columns
 FROM hms_identity_resources WHERE resource_key=:kind`,{kind},t);
 if(!r||!/^hms_[a-z0-9_]+$/.test(r.relation))fail(503,'The identity registry is not available.','IDENTITY_REGISTRY_UNAVAILABLE');return r;
}
async function find(kind:Resource,value:unknown,actor:Actor,t?:Transaction,legacy=false,metadataOnly=false){
 if(!actor.facilityId)fail(403,'A verified facility context is required.','FACILITY_CONTEXT_REQUIRED');
 if(legacy){if(!/^[1-9]\d*$/.test(String(value))||BigInt(String(value))>9223372036854775807n)fail(422,'The legacy identity must be a positive bigint.','INVALID_LEGACY_ID');}
 else if(!UUID.test(String(value)))fail(422,'A canonical UUID is required; numeric IDs belong to the legacy API.','UUID_REQUIRED');
 const r=await registry(kind,t);
 const projection=metadataOnly?['r.id','r.public_id',...(r.metadata_columns||[]).map((c:string)=>`r.${c}`)].join(','):'r.*';
 const [row]=await q(`SELECT ${projection} FROM ${r.relation} r JOIN hms_legacy_identity_map m ON m.resource_key=:kind AND m.legacy_id=r.id AND m.public_id=r.public_id
 WHERE ${legacy?'r.id=CAST(:value AS bigint)':'r.public_id=CAST(:value AS uuid)'}${r.facility_owned?' AND r.facility_id=CAST(:facility AS uuid)':''}`,{kind,value:String(value),facility:actor.facilityId},t);
 if(!row)fail(404,'The resource is not available in the current scope.','RESOURCE_NOT_FOUND');return row;
}
function legacyNumber(row:any):number{const n=Number(row.id);if(!Number.isSafeInteger(n)||n<1)fail(409,'The legacy adapter cannot represent this identity safely.','LEGACY_ID_RECONCILIATION_REQUIRED');return n;}
module.exports={find,locate:(kind:Resource,value:unknown,actor:Actor,t?:Transaction,legacy=false)=>find(kind,value,actor,t,legacy,true),legacyNumber,kinds:KINDS,isUuid:(value:unknown)=>UUID.test(String(value))};
