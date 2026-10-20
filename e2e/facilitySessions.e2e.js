const crypto=require('crypto');
const {api,apiLogin,sql,runner,assert,requireThrowawayDb}=require('./helpers');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Facility session boundaries'),tag=crypto.randomUUID().slice(0,8);
 let user,token,facility,original,unattributedPrivilegeRowsBefore;
 [{n:unattributedPrivilegeRowsBefore}]=await sql("SELECT count(*)::int n FROM audit.row_changes WHERE table_name='hms_clinical_privileges' AND operation='INSERT' AND actor_user_id IS NULL AND request_id IS NULL");
 await step('Session issuance records one explicit facility and returns its approved timezone',async()=>{
  const t=await apiLogin('doctor');const me=await api('GET','/auth/me',{token:t});assert(me.status===200,'Profile '+me.status);
  const actor=me.data.user||me.data.data||me.data;assert(actor.facilityId&&actor.facilityTimezone==='Asia/Kolkata','Missing facility metadata');
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");user=u.id;original=actor.facilityId;
  token=t;
  const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic other facility','UTC') RETURNING id",['SESSION-'+tag]);facility=f.id;
 });
 await step('A caller header cannot select another facility even when a second membership exists',async()=>{
  await sql("INSERT INTO hms_facility_memberships(facility_id,user_id,reason) VALUES($1,$2,'Synthetic second-facility membership')",[facility,user]);
  const r=await api('GET','/auth/me',{token,headers:{'x-facility-id':facility}});assert(r.status===403&&r.data.code==='FACILITY_BINDING_MISMATCH','Header selected a facility '+r.status);
  assert((await api('GET','/auth/me',{token,headers:{'x-facility-id':original}})).status===200,'Matching scope refused');
 });
 await step('An expired membership cannot keep using the facility-bound session',async()=>{
  const [expired]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic expired session facility','UTC') RETURNING id",['EXPIRED-'+tag]);
  await sql("INSERT INTO hms_facility_memberships(facility_id,user_id,valid_from,valid_until,reason) VALUES($1,$2,now()-interval '2 days',now()-interval '1 day','Synthetic expired membership from original grant')",[expired.id,user]);
  const [session]=await sql("INSERT INTO hms_sessions(user_id,facility_id,expires_at) VALUES($1,$2,now()+interval '1 hour') RETURNING id",[user,expired.id]);
  const expiredToken=require('../backend/utils/authTokens').signSessionToken({id:user,role:'doctor'},session.id,expired.id);
  const r=await api('GET','/auth/me',{token:expiredToken});assert(r.status===403&&r.data.code==='FACILITY_MEMBERSHIP_REQUIRED','Expired membership accepted');
 });
 await step('Revocation or facility deactivation blocks subsequent requests',async()=>{
  await sql("UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=$1,revocation_reason='Synthetic session membership revocation' WHERE user_id=$1 AND facility_id=$2 AND revoked_at IS NULL",[user,original]);
  try {
  assert((await api('GET','/auth/me',{token})).status===403,'Revoked membership accepted');
  } finally {
  await sql("INSERT INTO hms_facility_memberships(user_id,facility_id,granted_by_user_id,reason) VALUES($1,$2,(SELECT id FROM hms_users WHERE username='admin'),'Synthetic new grant after session revocation acceptance')",[user,original]);
  }
  await sql("UPDATE hms_facilities SET status='INACTIVE' WHERE id=$1",[original]);
  try {
  assert((await api('GET','/auth/me',{token})).status===403,'Inactive facility accepted');
  } finally {
  await sql("UPDATE hms_facilities SET status='ACTIVE' WHERE id=$1",[original]);
  }
 });
 await step('UUID backfill preserves legacy identities and does not grant clinical privileges',async()=>{
  const [p]=await sql('SELECT public_id,user_id FROM hms_practitioners WHERE user_id=$1',[user]);assert(p?.public_id&&p.user_id===user,'Practitioner mapping');
  const [grants]=await sql("SELECT count(*)::int AS n FROM audit.row_changes WHERE table_name='hms_clinical_privileges' AND operation='INSERT' AND actor_user_id IS NULL AND request_id IS NULL");assert(grants.n===unattributedPrivilegeRowsBefore,'Session lifecycle invented an unattributed clinical approval');
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
