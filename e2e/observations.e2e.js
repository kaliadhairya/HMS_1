// Shared OPD/IPD observations: native v2 writes and legacy vital adapters both
// produce the same append-only, facility-scoped clinical record.
const crypto=require('crypto');
const {api,apiLogin,sql,runner,assert,stamp,inCare,requireThrowawayDb}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');
requireThrowawayDb();
async function call(method,path,token,body,headers={}){
 const res=await fetch(`${process.env.E2E_API||'http://127.0.0.1:5064/api'}${path}`,{method,headers:{'content-type':'application/json',authorization:`Bearer ${token}`,...(method!=='GET'?{'idempotency-key':crypto.randomUUID()}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
 return {status:res.status,data:await res.json().catch(()=>null)};
}
(async()=>{
 const {step,done}=runner('Shared observations'),tag=stamp(),doctor=await apiLogin('doctor'),nurse=await apiLogin('nurse'),receptionist=await apiLogin('receptionist');
 await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);
 let patient,encounter;
 await step('A native observation set requires a current, facility-bound encounter',async()=>{
  const p=await api('POST','/patients/hms',{token:receptionist,body:{patientType:'other',name:`Observation ${tag}`,age:37,gender:'Female',opdIndoor:'OPD',testDate:new Date().toISOString().slice(0,10),phoneNumber:`72${tag}`.slice(-10).padEnd(10,'4')}});
  assert(p.status===201,`patient ${p.status}`);patient=p.data.data.id;await inCare(patient);
  const patientIdentity=await call('GET',`/v2/legacy-identities/patient/${patient}`,doctor);assert(patientIdentity.status===200,'patient identity');
  const made=await call('POST','/v2/encounters',doctor,{patient_id:patientIdentity.data.data.id,chief_complaint:'Synthetic observation acceptance fixture',encounter_type:'OPD'}, {'idempotency-key':crypto.randomUUID()});
  assert(made.status===201,`encounter ${made.status} ${made.data?.code}`);encounter=made.data.data.id;
 });
 await step('Native values keep their exact units and produce no inferred normal/abnormal label',async()=>{
  const p=await call('GET',`/v2/legacy-identities/patient/${patient}`,doctor),now=new Date().toISOString();
  const body={patient_id:p.data.data.id,encounter_id:encounter,observed_at:now,observations:[
   {code:'blood-pressure-systolic',value:147,unit_code:'mm[Hg]'},
   {code:'blood-pressure-diastolic',value:92,unit_code:'mm[Hg]'},
   {code:'body-temperature',value:37.8,unit_code:'Cel'}]};
  const created=await call('POST','/v2/observations',doctor,body,{'idempotency-key':crypto.randomUUID()});
  assert(created.status===201,`observation ${created.status} ${created.data?.code}`);
  assert(created.data.data.observations.length===3&&created.data.data.observations[2].unit_code==='Cel','measurement value/unit changed');
  assert(!('alerts'in created.data.data)&&!('interpretation'in created.data.data.observations[0]),'unapproved clinical interpretation was added');
  const fetched=await call('GET',`/v2/observations/${created.data.data.id}`,doctor);assert(fetched.status===200&&fetched.data.data.observations.length===3,'set read');
  const listed=await call('GET',`/v2/observations/patient/${p.data.data.id}`,doctor);assert(listed.status===200&&listed.data.data.some(r=>r.id===created.data.data.id),'patient list');
  const [row]=await sql('SELECT count(*)::int sets FROM hms_observation_sets WHERE public_id=$1',[created.data.data.id]);assert(row.sets===1,'duplicate set');
 });
 await step('Idempotent replay creates no extra observation set',async()=>{
  const p=await call('GET',`/v2/legacy-identities/patient/${patient}`,doctor);
  const body={patient_id:p.data.data.id,encounter_id:encounter,observed_at:new Date().toISOString(),observations:[{code:'heart-rate',value:88,unit_code:'/min'}]},key=crypto.randomUUID();
  const a=await call('POST','/v2/observations',doctor,body,{'idempotency-key':key}),b=await call('POST','/v2/observations',doctor,body,{'idempotency-key':key});
  assert(a.status===201&&b.status===201&&a.data.data.id===b.data.data.id,'command replay changed observation identity');
  const [count]=await sql("SELECT count(*)::int n FROM hms_observation_sets WHERE source_kind='native' AND patient_id=$1",[patient]);assert(count.n===2,'replay inserted a second set');
 });
 await step('Legacy OPD vital inserts are projected into the shared model and legacy reads use that projection',async()=>{
  const inserted=await api('POST','/hms/vitals',{token:doctor,body:{patient_id:patient,encounter_type:'OPD',bp_systolic:128,bp_diastolic:79,temperature:36.8,temp_unit:'C',pulse:77,spo2:98}});
  assert(inserted.status===201,`legacy write ${inserted.status}`);
  const [projection]=await sql("SELECT count(*)::int n FROM hms_observation_sets s JOIN hms_observations o ON o.set_id=s.id WHERE s.source_kind='legacy_opd_vitals' AND s.patient_id=$1 AND o.code='heart-rate' AND o.value_numeric=77",[patient]);assert(projection.n===1,'legacy insert was not normalized');
  const history=await call('GET',`/hms/vitals/history/${patient}`,doctor);assert(history.status===200&&history.data.data.some(v=>Number(v.pulse)===77&&v.temp_unit==='C'),'legacy read did not project the shared observation');
 });
 await step('Unassigned nursing staff and operational administrators cannot read the clinical observation chart',async()=>{
  const p=await call('GET',`/v2/legacy-identities/patient/${patient}`,doctor);
  assert((await call('GET',`/v2/observations/patient/${p.data.data.id}`,nurse)).status===403,'unassigned nurse read chart');
  assert((await call('GET',`/v2/observations/patient/${p.data.data.id}`,await apiLogin('admin'))).status===403,'admin read chart');
 });
 done();process.exit();
})();
