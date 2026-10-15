const crypto=require('node:crypto');
const {api,apiLogin,sql,runner,assert,inCare,requireThrowawayDb}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('V2 document command authority'),tag=crypto.randomUUID().slice(0,8);
 const doctor=await apiLogin('doctor'),admin=await apiLogin('admin'),nurse=await apiLogin('nurse');
 await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);await clinicalFixture('nurse',['CHART_READ','NURSING_DOCUMENT']);
 const [p]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic document authority patient',$1,'other',30,'Female','OPD',CURRENT_DATE) RETURNING id,public_id",['V2DOC-'+tag]);await inCare(p.id);
 let doc,legacy,version,firstSignature;
 await step('UUID creation uses snake_case and exact retry records one document and one operation',async()=>{
  const key=crypto.randomUUID(),body={patient_id:p.public_id,content:{chief_complaint:'Synthetic reviewed complaint'}};
  const created=await api('POST','/v2/clinical-documents',{token:doctor,body,headers:{'idempotency-key':key}});
  assert(created.status===201,'Create '+created.status+' '+created.data.code);doc=created.data.data.id;version=created.data.version;
  const replay=await api('POST','/v2/clinical-documents',{token:doctor,body,headers:{'idempotency-key':key}});
  assert(replay.status===201&&replay.data.data.id===doc&&replay.data.operation_id===created.data.operation_id,'Creation replay diverged');
  [legacy]=await sql('SELECT id FROM hms_clinical_documents WHERE public_id=$1',[doc]);
  assert(created.data.data.content.chief_complaint===body.content.chief_complaint,'Wrong public casing');
 });
 await step('Missing preconditions, stale snapshots and unknown content fields are refused',async()=>{
  const path='/v2/clinical-documents/'+doc+'/draft';
  assert((await api('PUT',path,{token:doctor,body:{content:{history:'Must not save'}}})).status===428,'Missing version accepted');
  assert((await api('PUT',path,{token:doctor,body:{content:{history:'Must not save'}},headers:{'if-match':'999'}})).status===412,'Stale version accepted');
  assert((await api('PUT',path,{token:doctor,body:{content:{chiefComplaint:'Wrong casing'}},headers:{'if-match':String(version)}})).status===422,'Mixed casing accepted');
 });
 await step('Two commands against one reviewed public version commit exactly one draft',async()=>{
  const replies=await Promise.all(['A','B'].map(value=>api('PUT','/v2/clinical-documents/'+doc+'/draft',{token:doctor,body:{content:{history:'Synthetic draft '+value}},headers:{'if-match':String(version)}})));
  assert(replies.map(r=>r.status).sort().join(',')==='200,412','Concurrent saves '+replies.map(r=>r.status));version=replies.find(r=>r.status===200).data.version;
 });
 await step('Legacy writes invalidate the public snapshot and both transports sign one immutable record',async()=>{
  const [native]=await sql('SELECT draft_version FROM hms_clinical_documents WHERE id=$1',[legacy.id]);
  const saved=await api('PUT','/clinical-documents/'+legacy.id+'/draft',{token:doctor,body:{content:{history:'Synthetic legacy-compatible revision'}},headers:{'if-match':String(native.draft_version)}});assert(saved.status===200,'Legacy save refused');
  assert((await api('POST','/v2/clinical-documents/'+doc+'/sign',{token:doctor,body:{},headers:{'if-match':String(version)}})).status===412,'Legacy edit invisible to v2');
  version=(await api('GET','/v2/clinical-documents/'+doc,{token:doctor})).data.data.version;
  const signed=await api('POST','/v2/clinical-documents/'+doc+'/sign',{token:doctor,body:{},headers:{'if-match':String(version)}});
  assert(signed.status===200&&signed.data.data.signatures.length===1,'Shared signing failed '+signed.status+' '+signed.data.code);version=signed.data.version;firstSignature=signed.data.data.signatures[0];
  const digest=crypto.createHash('sha256').update(JSON.stringify(Object.fromEntries(Object.keys(firstSignature.canonical_signed_content).sort().map(k=>[k,firstSignature.canonical_signed_content[k]])))).digest('hex');
  assert(digest===firstSignature.digest,'Presentation altered signed canonical content');
 });
 await step('An amendment retains its predecessor and cannot be passed through initial-sign',async()=>{
  const reason='Synthetic correction with documented reasoning';
  const amended=await api('POST','/v2/clinical-documents/'+doc+'/amend',{token:doctor,body:{reason},headers:{'if-match':String(version)}});assert(amended.status===200,'Amend failed');version=amended.data.version;
  const initial=await api('POST','/v2/clinical-documents/'+doc+'/sign',{token:doctor,body:{},headers:{'if-match':String(version)}});assert(initial.status===409&&initial.data.code==='AMENDMENT_SIGNATURE_REQUIRED','Amendment signed as original');
  const changed=await api('PUT','/v2/clinical-documents/'+doc+'/draft',{token:doctor,body:{content:{history:'Synthetic corrected revision'}},headers:{'if-match':String(version)}});assert(changed.status===200,'Amendment save failed');version=changed.data.version;
  const signed=await api('POST','/v2/clinical-documents/'+doc+'/sign-amendment',{token:doctor,body:{reason},headers:{'if-match':String(version)}});assert(signed.status===200,'Amendment sign failed');version=signed.data.version;
  const signatures=signed.data.data.signatures;assert(signatures.length===2&&signatures[1].amends_version===1,'Missing linked correction');assert(signatures[0].digest===firstSignature.digest,'Prior signature changed');
 });
 await step('Admin role and a nurse without current responsibility do not grant chart access',async()=>{
  assert((await api('GET','/v2/clinical-documents/'+doc,{token:admin})).status===403,'Administrator chart access');
  assert((await api('GET','/clinical-documents/'+legacy.id,{token:admin})).status===403,'Legacy administration bypass');
  assert((await api('GET','/v2/clinical-documents/'+doc,{token:nurse})).status===403,'Unassigned nurse read chart');
  assert((await api('POST','/v2/clinical-documents',{token:nurse,body:{patient_id:p.public_id,doc_type:'nursing_assessment',content:{assessment:'Unassigned care'}}})).status===403,'Unassigned nurse authored');
 });
 await step('Cross-facility document identifiers do not reveal records and successful reads are audited',async()=>{
  const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic document scope facility','UTC') RETURNING id",['VD-'+tag]);
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [foreign]=await sql("INSERT INTO hms_clinical_documents(patient_id,author_user_id,facility_id,doc_type) VALUES($1,$2,$3,'clinical_note') RETURNING public_id",[p.id,u.id,f.id]);
  assert((await api('GET','/v2/clinical-documents/'+foreign.public_id,{token:doctor})).status===404,'Foreign facility chart access');
  const [event]=await sql("SELECT count(*)::int n FROM audit.access_events WHERE path=$1 AND patient_id=$2 AND outcome='read'",['/api/v2/clinical-documents/'+doc,p.id]);assert(event.n>0,'Document access missing audit');
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
