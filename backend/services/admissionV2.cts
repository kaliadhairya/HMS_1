// Admissions through the v2 API (completion A3). A transfer names the admission and the
// target bed by public identifier, and must state the admission version it was based on
// (If-Match). The same locks, bed rules and occupancy records as the legacy transfer apply.
const I=require('./identities.cts');
const {sequelize}=require('../models/db');
const {QueryTypes}=require('sequelize');
const {openOccupancy,closeOccupancy}=require('../utils/adt');
const {logAction}=require('../utils/auditLogger');
type Actor={id:number;role:string;facilityId?:string;ip?:string};
const WARD_STAFF=['super_admin','admin','nurse','doctor'];
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
function canWardAct(actor:Actor){if(!WARD_STAFF.includes(actor.role))fail(403,'Your role cannot move patients between beds.','ROLE_NOT_PERMITTED');}
const rows=(sql:string,replacements:any,t:any):Promise<any[]>=>sequelize.query(sql,{replacements,type:QueryTypes.SELECT,transaction:t});
const execute=(sql:string,replacements:any,t:any)=>sequelize.query(sql,{replacements,type:QueryTypes.UPDATE,transaction:t});

function expectedVersion(ifMatch:any):number{
 if(ifMatch===undefined||ifMatch===null||ifMatch==='')fail(428,'If-Match with the admission version is required.','PRECONDITION_REQUIRED');
 const v=Number(String(ifMatch).replace(/"/g,''));
 if(!Number.isSafeInteger(v)||v<1)fail(400,'If-Match must be the admission version.','INVALID_PRECONDITION');
 return v;
}

async function projection(admissionLegacyId:number,t:any){
 const [row]=await rows(`SELECT a.public_id,a.api_version,a.status,a.admission_date,b.public_id AS bed_public,p.public_id AS patient_public
   FROM hms_admissions a JOIN hms_patients p ON p.id=a.patient_id LEFT JOIN hms_beds b ON b.id=a.bed_id WHERE a.id=:id`,{id:admissionLegacyId},t);
 return {id:row.public_id,version:Number(row.api_version),patient_id:row.patient_public,bed_id:row.bed_public??null,status:row.status,admission_date:row.admission_date};
}

async function transfer(id:string,body:any,actor:Actor,ifMatch:any,t:any){
 canWardAct(actor);
 const expected=expectedVersion(ifMatch);
 const reason=String(body?.reason??'').trim();
 if(reason.length<5)fail(422,'Say why the patient is being moved.','VALIDATION_FAILED');
 if(!body?.to_bed_id)fail(422,'to_bed_id is required.','VALIDATION_FAILED');
 const admissionId=I.legacyNumber(await I.locate('admission',id,actor,t));
 const toBedId=I.legacyNumber(await I.locate('bed',body.to_bed_id,actor,t));
 const [adm]=await rows('SELECT id,patient_id,bed_id,status,api_version FROM hms_admissions WHERE id=:id FOR UPDATE',{id:admissionId},t);
 if(!adm)fail(404,'Admission not found.','RESOURCE_NOT_FOUND');
 if(Number(adm.api_version)!==expected)fail(412,'This admission changed after you read it. Reload it and try again.','VERSION_CONFLICT');
 if(adm.status!=='Active')fail(409,'Only an active admission can be moved.','ADMISSION_NOT_ACTIVE');
 if(!adm.bed_id)fail(409,'This admission is not in a bed.','ADMISSION_NOT_IN_BED');
 if(Number(adm.bed_id)===toBedId)fail(409,'The patient is already in that bed.','ALREADY_IN_BED');
 // Both beds are locked in id order, so concurrent moves cannot deadlock.
 const beds=await rows('SELECT id,status,is_active,bed_number FROM hms_beds WHERE id IN (:a,:b) ORDER BY id FOR UPDATE',{a:Number(adm.bed_id),b:toBedId},t);
 const from=beds.find((b:any)=>Number(b.id)===Number(adm.bed_id));
 const to=beds.find((b:any)=>Number(b.id)===toBedId);
 if(!to||!from)fail(404,'Bed not found.','RESOURCE_NOT_FOUND');
 if(Number(to.is_active)!==1||to.status!=='Available')fail(409,`Bed ${to.bed_number} is not ready (${Number(to.is_active)!==1?'inactive':to.status}).`,'BED_NOT_READY');
 await closeOccupancy(sequelize,{admissionId,reason:`transferred: ${reason}`,transaction:t});
 await execute("UPDATE hms_beds SET status = 'Dirty' WHERE id = :id",{id:from.id},t);
 await execute("UPDATE hms_beds SET status = 'Occupied' WHERE id = :id",{id:toBedId},t);
 const updated=await rows('UPDATE hms_admissions SET bed_id = :toBedId, api_version = api_version + 1 WHERE id = :admissionId AND api_version = :expected RETURNING id',{toBedId,admissionId,expected},t);
 if(!updated.length)fail(412,'This admission changed after you read it. Reload it and try again.','VERSION_CONFLICT');
 await openOccupancy(sequelize,{bedId:toBedId,admissionId,userId:actor.id,reason:`transfer: ${reason}`,transaction:t});
 await logAction(actor.id,'UPDATE','admission',admissionId,{bed:Number(from.id)},{bed:toBedId,reason},actor.ip);
 return projection(admissionId,t);
}

async function read(id:string,actor:Actor,t:any){
 canWardAct(actor);
 const admissionId=I.legacyNumber(await I.locate('admission',id,actor,t));
 return projection(admissionId,t);
}

module.exports={transfer,read};
