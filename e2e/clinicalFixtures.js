// Explicit synthetic approvals for clinical acceptance tests. Never called
// by application startup/seed. These are not hospital qualifications or go-live
// approvals; the real administration APIs exercise their authority checks.
const crypto=require('crypto');
const {api,apiLogin,sql,assert,requireThrowawayDb}=require('./helpers');
const kinds={doctor:'medical_registration',nurse:'nursing_registration',pharmacist:'pharmacy_registration',lab_technician:'laboratory_qualification'};
const defaults={doctor:'doctor',nurse:'nurse',pharmacist:'pharmacist',lab_technician:'labtech'};
const cache=new Map();
async function clinicalFixture(role,actions,{username=defaults[role]}={}){
 requireThrowawayDb();assert(kinds[role]&&Array.isArray(actions),'Choose explicit fixture professional role/actions.');
 const existing=cache.get(username);if(existing&&actions.every(a=>existing.actions.has(a)))return existing;
 const admin=await apiLogin('admin'),verifier=await apiLogin('super_admin');
 const [u]=await sql('SELECT id,role FROM hms_users WHERE username=$1',[username]);assert(u&&u.role===role,'Fixture account must match its explicit login identity and role.');
 const [{service_day}]=await sql('SELECT hms_service_today()::text AS service_day');
 const checked=(response,status=200)=>{assert(response.status===status,`Synthetic clinical approval failed: ${response.status} ${response.data?.code||response.data?.message||''}`);return response.data.data;};
 let state=existing;
 if(!state){
  const tag=crypto.randomUUID(),qualification=checked(await api('POST',`/practitioners/${u.id}/credentials`,{token:admin,body:{kind:kinds[role],identifier:'SYNTHETIC-E2E-'+tag,issuingBody:'SYNTHETIC ACCEPTANCE COUNCIL',validFrom:service_day}}),201);
  checked(await api('POST',`/practitioners/${u.id}/credentials/${qualification.id}/verify`,{token:verifier,body:{reference:'SYNTHETIC-ONLY-'+tag,reason:'Synthetic acceptance fixture verification; not a hospital credential'}}));
  const p=checked(await api('GET',`/practitioners/${u.id}`,{token:admin}));
  const validFrom=new Date(Date.now()-3600000).toISOString(),validUntil=new Date(Date.now()+24*3600000).toISOString();
  const grant=checked(await api('POST','/facilities/professional-roles',{token:admin,body:{practitionerId:p.public_id,role,validFrom,validUntil,reason:'Synthetic acceptance fixture professional approval only'}}));
  state={userId:u.id,qualificationId:qualification.id,roleId:grant.id,revision:grant.revision,validFrom,validUntil,actions:new Set()};cache.set(username,state);
 }
 for(const action of actions){if(state.actions.has(action))continue;
  const approval=checked(await api('POST',`/facilities/professional-roles/${state.roleId}/privileges`,{token:admin,headers:{'if-match':String(state.revision)},body:{action,validFrom:state.validFrom,validUntil:state.validUntil,reason:'Synthetic acceptance fixture action approval only'}}));
  state.revision=approval.roleRevision;state.actions.add(action);
 }
 return state;
}
module.exports={clinicalFixture};
