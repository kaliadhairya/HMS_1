const crypto=require('crypto');
const {api,apiLogin,sql,runner,assert,inCare,requireThrowawayDb}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('V2 UUID clinical core'),tag=crypto.randomUUID().slice(0,8);
 const doctor=await apiLogin('doctor'),admin=await apiLogin('admin');
 await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);
 const [user]=await sql("SELECT u.id,u.public_id,d.department_id FROM hms_users u JOIN hms_doctors d ON d.user_id=u.id WHERE u.username='doctor' ORDER BY d.id LIMIT 1");
 const [patient]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate,dob) VALUES($1,$2,'other',30,'Male','OPD',CURRENT_DATE,'1990-01-02') RETURNING id,public_id",['Synthetic UUID clinical patient','V2-'+tag]);await inCare(patient.id);
 let encounter,version,legacy,token,otherPatient;
 await step('Canonical patient reads are UUID-based and audited; numeric input is rejected',async()=>{
  const r=await api('GET','/v2/patients/'+patient.public_id,{token:doctor});assert(r.status===200&&r.data.data.id===patient.public_id,'UUID read failed');assert(r.data.data.dob==='1990-01-02','Birth date changed into an instant');
  assert((await api('GET','/v2/patients/'+patient.id,{token:doctor})).status===422,'Numeric identity silently accepted');
  const [a]=await sql("SELECT patient_id FROM audit.access_events WHERE path=$1 AND outcome='read' ORDER BY id DESC LIMIT 1",['/api/v2/patients/'+patient.public_id]);assert(a.patient_id===patient.id,'V2 chart read not audited');
 });
 await step('Creating an encounter produces UUID relationships, a durable operation and exact retry replay',async()=>{
  const key=crypto.randomUUID(),body={patient_id:patient.public_id,chief_complaint:'Synthetic UUID consultation'};
  const r=await api('POST','/v2/encounters',{token:doctor,body,headers:{'idempotency-key':key}});assert(r.status===201,'Create '+r.status+' '+r.data.code);
  encounter=r.data.data.id;version=r.data.version;assert(encounter&&r.data.operation_id&&r.data.data.doctor_id===user.public_id,'Missing UUID relationships/operation');
  const again=await api('POST','/v2/encounters',{token:doctor,body,headers:{'idempotency-key':key}});assert(again.status===201&&again.data.operation_id===r.data.operation_id&&again.data.data.id===encounter,'Operation not durably replayed');
  [legacy]=await sql('SELECT id,api_version,record_revision FROM hms_encounters WHERE public_id=$1',[encounter]);assert(legacy.api_version===version,'Returned version differs from committed row');
 });
 await step('Missing/stale versions and mixed casing cannot mutate the record',async()=>{
  const path='/v2/encounters/'+encounter+'/draft';
  const missing=await api('PUT',path,{token:doctor,body:{hopi:'Must not save'}});assert(missing.status===428,'Missing precondition '+missing.status);
  const stale=await api('PUT',path,{token:doctor,body:{hopi:'Must not save'},headers:{'if-match':'999'}});assert(stale.status===412,'Stale precondition '+stale.status);
  const casing=await api('PUT',path,{token:doctor,body:{chiefComplaint:'Wrong contract'},headers:{'if-match':String(version)}});assert(casing.status===422,'Mixed casing accepted');
  const [e]=await sql('SELECT hopi,api_version FROM hms_encounters WHERE id=$1',[legacy.id]);assert(!e.hopi&&e.api_version===version,'Rejected command committed');
 });
 await step('UUID and legacy callers share one content/version authority and immutable signatures',async()=>{
  const saved=await api('PUT','/v2/encounters/'+encounter+'/draft',{token:doctor,body:{hopi:'Synthetic reviewed note'},headers:{'if-match':String(version)}});assert(saved.status===200,'Save '+saved.status+' '+saved.data.code);version=saved.data.version;
  const [e]=await sql('SELECT record_revision,api_version FROM hms_encounters WHERE id=$1',[legacy.id]);assert(e.api_version===version,'Incorrect committed version');
  const old=await api('PUT','/hms/encounters/'+legacy.id,{token:doctor,body:{general_examination:'Synthetic legacy-compatible note'},headers:{'if-match':String(e.record_revision)}});assert(old.status===200,'Legacy service diverged '+old.status);
  const conflict=await api('POST','/v2/encounters/'+encounter+'/sign',{token:doctor,body:{},headers:{'if-match':String(version)}});assert(conflict.status===412,'V2 did not see legacy edit');
  const latest=await api('GET','/v2/encounters/'+encounter,{token:doctor});version=latest.data.data.version;
  const signed=await api('POST','/v2/encounters/'+encounter+'/sign',{token:doctor,body:{},headers:{'if-match':String(version)}});assert(signed.status===200&&signed.data.data.signature_digest,'Sign '+signed.status+' '+signed.data.code);version=signed.data.version;
  const [n]=await sql('SELECT count(*)::int n FROM hms_document_signatures s JOIN hms_encounters e ON e.notes_document_id=s.document_id WHERE e.id=$1',[legacy.id]);assert(n.n===1,'More than one initial signature');
 });
 await step('An administrator has no implicit physician authority and foreign-facility encounters are inaccessible',async()=>{
  assert((await api('POST','/v2/encounters',{token:admin,body:{patient_id:patient.public_id}})).status===403,'Administrator started clinical care');
  const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic UUID scope facility','UTC') RETURNING id",['V2-'+tag]);
  const [foreign]=await sql("INSERT INTO hms_encounters(id,patient_id,doctor_id,facility_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,$3,'Draft') RETURNING public_id",[patient.id,user.id,f.id]);
  assert((await api('GET','/v2/encounters/'+foreign.public_id,{token:doctor})).status===404,'Foreign-facility encounter disclosed');
 });
 await step('Exact legacy mappings survive edits and their UUID cannot be rewritten',async()=>{
  const mapped=await api('GET','/v2/legacy-identities/encounter/'+legacy.id,{token:doctor});assert(mapped.status===200&&mapped.data.data.id===encounter,'Legacy mapping changed');
  let denied=false;try{await sql('UPDATE hms_encounters SET public_id=$1 WHERE id=$2',[crypto.randomUUID(),legacy.id]);}catch{denied=true;}assert(denied,'Public identity rewritten');
 });
 await step('A visit identifier cannot be linked to another patient or change their queue state',async()=>{
  [otherPatient]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic different visit patient',$1,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",['V2X-'+tag]);
  [token]=await sql("INSERT INTO hms_tokens(token_number,patient_id,doctor_id,department_id,token_date,status) VALUES($1,$2,$3,$4,hms_service_today(),'Waiting') RETURNING id,public_id",[parseInt(tag.slice(0,5),16),otherPatient.id,user.id,user.department_id]);
  const wrong=await api('POST','/v2/encounters',{token:doctor,body:{patient_id:patient.public_id,token_id:token.public_id}});assert(wrong.status===409&&wrong.data.code==='VISIT_CONTEXT_MISMATCH','Cross-patient visit accepted');
  const [t]=await sql('SELECT status FROM hms_tokens WHERE id=$1',[token.id]);assert(t.status==='Waiting','Wrong-patient queue modified');
 });
 await step('Multiple exact waiting visits require explicit selection and are never joined by guesswork',async()=>{
  await sql("INSERT INTO hms_tokens(token_number,patient_id,doctor_id,department_id,token_date,status) VALUES($1,$2,$3,$5,hms_service_today(),'Waiting'),($4,$2,$3,$5,hms_service_today(),'Waiting')",[parseInt(tag.slice(0,5),16)+1,patient.id,user.id,parseInt(tag.slice(0,5),16)+2,user.department_id]);
  const rejected=await api('POST','/v2/encounters',{token:doctor,body:{patient_id:patient.public_id}});
  assert(rejected.status===409&&rejected.data.code==='VISIT_SELECTION_REQUIRED','Ambiguous visit was guessed');
  const [count]=await sql("SELECT count(*)::int n FROM hms_tokens WHERE patient_id=$1 AND status='Waiting'",[patient.id]);assert(count.n===2,'Rejected ambiguous command changed queue');
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
