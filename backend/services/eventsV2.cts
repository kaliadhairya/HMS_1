// Catch-up after missed live notifications through the v2 API (completion A3, blueprint 3.10).
// The page is the one the live socket and /api/events use (utils/outbox.js eventsPage), so
// audience, facility and doctor care scope are identical. The cursor is the delivery sequence of
// the last event received; the patient is named by public identifier.
const {eventsPage,latestSequence}=require('../utils/outbox');
const {sequelize}=require('../models/db');
const {QueryTypes}=require('sequelize');
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}

async function page(cursor:any,actor:any){
 if(cursor===undefined||cursor===''){const latest=await latestSequence();return {events:[],next_cursor:String(latest),latest_cursor:String(latest),has_more:false};}
 if(!/^\d{1,15}$/.test(String(cursor)))fail(422,'cursor must be the delivery sequence of the last event received.','INVALID_CURSOR');
 const result=await eventsPage(actor,Number(cursor));
 const ids=[...new Set(result.data.map((e:any)=>e.data.patient_id).filter((id:any)=>id!=null))];
 const map=new Map<number,string>();
 if(ids.length){
  const rows:any[]=await sequelize.query('SELECT id,public_id FROM hms_patients WHERE id IN (:ids)',{replacements:{ids},type:QueryTypes.SELECT});
  for(const r of rows)map.set(Number(r.id),r.public_id);
 }
 const events=result.data.map(({type,data}:any)=>{
  const {event_id,event_type,schema_version,delivery_sequence,occurred_at,patient_id,aggregate,correlation_id,...payload}=data;
  return {id:String(event_id),type,schema_version,sequence:String(delivery_sequence),occurred_at,
   patient_id:patient_id==null?null:(map.get(Number(patient_id))??null),aggregate:aggregate??null,correlation_id:correlation_id??null,data:payload};
 });
 return {events,next_cursor:String(result.next_sequence),latest_cursor:String(result.latest_sequence),has_more:result.has_more};
}

module.exports={page};
