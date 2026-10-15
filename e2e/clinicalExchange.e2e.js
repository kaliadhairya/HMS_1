// Real PostgreSQL/HTTP coverage for the final clinical exchange increment.
// Run after medication.e2e.js. Only throwaway data and synthetic content.
const crypto=require('crypto');
const fs=require('fs');
const os=require('os');
const path=require('path');
const {spawnSync}=require('child_process');
const {API,api,apiLogin,sql,runner,assert,inCare,requireThrowawayDb}=require('./helpers');
requireThrowawayDb();
const tag=crypto.randomUUID().slice(0,8);
const call=(method,url,token,body,etag)=>api(method,url,{token,body,headers:etag?{'if-match':String(etag)}:{}});
const get=async(url,token)=>{const r=await fetch(API+'/fhir/'+url,{headers:{authorization:'Bearer '+token}});return {status:r.status,body:await r.json()};};
(async()=>{
 const {step,done}=runner('Final clinical exchange');
 const admin=await apiLogin('admin'),doctor=await apiLogin('doctor'),nurse=await apiLogin('nurse');
 let pid,admission,doc,signature,rx,resources=[],original,amended;
 await step('Capability statement declares exactly the 15 primary clinical resource types',async()=>{
  const c=(await get('metadata',admin)).body.rest[0].resource.map(r=>r.type);
  for(const t of ['Patient','Practitioner','PractitionerRole','Organization','Location','Encounter','Condition','AllergyIntolerance','MedicationRequest','MedicationDispense','MedicationAdministration','ServiceRequest','Specimen','Observation','DiagnosticReport'])assert(c.includes(t),'Missing '+t);
  assert(c.length===15,'Unexpected capability count '+c.length);
 });
 await step('Immutable medication versions, dispenses and administrations preserve source identities and quantities',async()=>{
  const [r]=await sql(`SELECT o.patient_id,v.id,v.dose,v.dose_unit,o.encounter_id FROM hms_med_order_versions v JOIN hms_med_orders o ON o.id=v.order_id
    WHERE v.signed_at IS NOT NULL AND EXISTS(SELECT 1 FROM hms_med_dispense_lines l WHERE l.version_id=v.id)
      AND EXISTS(SELECT 1 FROM hms_med_administrations a JOIN hms_med_order_versions av ON av.id=a.version_id WHERE av.order_id=o.id)
    ORDER BY v.signed_at DESC LIMIT 1`);
  assert(r,'Run medication.e2e.js first');rx=r;
  for(const type of ['MedicationRequest','MedicationDispense','MedicationAdministration']){
   const out=await get(`${type}?patient=${r.patient_id}`,admin);
   assert(out.status===200,'Search '+type+' '+out.status);
   assert(out.body.entry.length,'Missing '+type+' source fixture');
   for(const e of out.body.entry){assert(e.resource.subject.reference===`Patient/${r.patient_id}`,'Wrong subject');resources.push(e.resource);}
  }
  const med=resources.find(m=>m.id===r.id);assert(med&&med.dosageInstruction[0].doseAndRate[0].doseQuantity.value===Number(r.dose),'Changed signed dose');
  const read=await get('MedicationRequest/'+r.id,admin);assert(read.status===200&&read.body.id===r.id,'Version read');
  const [draft]=await sql('SELECT id FROM hms_med_order_versions WHERE signed_at IS NULL LIMIT 1');
  assert(draft,'Needs unsigned draft fixture');assert((await get('MedicationRequest/'+draft.id,admin)).status===404,'Unsigned prescription exported');
 });
 await step('Prescription documents are self-contained and stable for identical signed source versions',async()=>{
  const a=await get('documents/prescription/'+rx.encounter_id,admin),b=await get('documents/prescription/'+rx.encounter_id,admin);
  assert(a.status===200&&a.body.type==='document','Prescription '+a.status);
  assert(a.body.id===b.body.id,'Unstable source identity');
  const references=new Set(a.body.entry.map(e=>`${e.resource.resourceType}/${e.resource.id}`));
  const section=a.body.entry[0].resource.section[0];
  assert(section.code.coding[0].code==='440545006','Prescription section code');
  assert(section.entry.every(e=>references.has(e.reference)),'Incomplete medication closure');
  original=a.body;
 });
 await step('PractitionerRole, ward/bed Location and ServiceRequest expose exact governed identities',async()=>{
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const role=await get('PractitionerRole/'+u.id,admin);assert(role.status===200&&role.body.practitioner.reference===`Practitioner/${u.id}`,'Practitioner role');resources.push(role.body);
  const [b]=await sql('SELECT id FROM hms_beds ORDER BY id LIMIT 1');
  const bed=await get('Location/bed-'+b.id,admin);assert(bed.status===200&&bed.body.partOf.reference.startsWith('Location/ward-'),'Location');resources.push(bed.body);
  const [i]=await sql('SELECT patient_id FROM hms_investigation_orders ORDER BY id DESC LIMIT 1');
  const orders=await get('ServiceRequest?patient='+i.patient_id,admin);assert(orders.status===200&&orders.body.entry.length,'Service requests');resources.push(...orders.body.entry.map(e=>e.resource));
 });
 await step('Discharge drafts require a matching patient/admission and cannot be exported',async()=>{
  const [p]=await sql(`INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',35,'Female','IPD',hms_service_today()) RETURNING id`,['Synthetic continuity '+tag,'CONT-'+tag]);pid=p.id;await inCare(pid);
  const [u]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
  const [a]=await sql("INSERT INTO hms_admissions(patient_id,admitting_doctor_id,status,admission_date) VALUES($1,$2,'Active',now()) RETURNING id",[pid,u.id]);admission=a.id;
  const wrong=await call('POST','/clinical-documents',doctor,{patientId:rx.patient_id,admissionId:admission,docType:'discharge_summary',content:{}});
  assert(wrong.status===409,'Mismatched patient/admission '+wrong.status);
  assert((await call('POST','/clinical-documents',nurse,{patientId:pid,admissionId:admission,docType:'discharge_summary',content:{}})).status===403,'Nurse signed medical discharge');
  const made=await call('POST','/clinical-documents',doctor,{patientId:pid,admissionId:admission,docType:'discharge_summary',content:{diagnosis:'Synthetic diagnosis'}});
  assert(made.status===201,'Create discharge '+made.status);doc=made.data.data.id;
  const incomplete=await call('POST',`/clinical-documents/${doc}/sign`,doctor,undefined,1);
  assert(incomplete.status===422,'Incomplete discharge signed '+incomplete.status);
  assert((await get('documents/discharge/999999999',admin)).status===404,'Unsigned document served');
 });
 await step('A complete discharge signature freezes its digest; active admission export is refused',async()=>{
  const content={diagnosis:'Synthetic diagnosis',condition:'Synthetic reviewed condition',instructions:'Synthetic handover instructions',warningSigns:'Synthetic reviewed escalation instructions',followUp:'Synthetic named clinician follow-up',course:'Synthetic course <script>unsafe</script>'};
  const save=await call('PUT',`/clinical-documents/${doc}/draft`,doctor,{content},1);assert(save.status===200,'Save discharge');
  const signed=await call('POST',`/clinical-documents/${doc}/sign`,doctor,undefined,2);assert(signed.status===200,'Sign discharge '+signed.status);
  [signature]=await sql('SELECT id,version,digest FROM hms_document_signatures WHERE document_id=$1',[doc]);
  assert((await get('documents/discharge/'+signature.id,admin)).status===409,'Active admission exported as discharged');
  await sql("UPDATE hms_admissions SET status='Discharged',discharge_date=now() WHERE id=$1",[admission]);
  const out=await get('documents/discharge/'+signature.id,admin);assert(out.status===200,'Discharge export '+out.status);amended=out.body;
  assert(!JSON.stringify(out.body).includes('<script>'),'Unescaped narrative');
 });
 await step('Linked discharge amendment leaves the original signature/export intact and enforces the recorded reason',async()=>{
  const reason='Synthetic correction after reviewed handover';
  const start=await call('POST',`/clinical-documents/${doc}/amend`,doctor,{reason},2);assert(start.status===200,'Start amendment');
  const bad=await call('POST',`/clinical-documents/${doc}/sign-amendment`,doctor,{reason:'A different unreviewed explanation'},3);assert(bad.status===409,'Changed amendment reason accepted');
  const signed=await call('POST',`/clinical-documents/${doc}/sign-amendment`,doctor,{reason},3);assert(signed.status===200,'Sign linked amendment');
  const originalAfter=await get('documents/discharge/'+signature.id,admin);assert(originalAfter.status===200&&originalAfter.body.id===amended.id,'Original export changed');
  const [s]=await sql('SELECT id FROM hms_document_signatures WHERE document_id=$1 AND version=2',[doc]);
  const newExport=await get('documents/discharge/'+s.id,admin);assert(newExport.status===200&&newExport.body.entry[0].resource.status==='amended','Amended signature');
  assert(newExport.body.id!==amended.id,'Versions share identity');
 });
 await step('The added resources and both new documents pass the official FHIR R4/ABDM validator',async()=>{
  const dir=process.env.HMS_FHIR_VALIDATOR_DIR||path.join(os.homedir(),'hms-tools/fhir/validator-6.10.4');
  assert(fs.existsSync(path.join(dir,'classes/HmsValidate.class')),'Official validator missing');
  const out=fs.mkdtempSync(path.join(os.tmpdir(),'hms-final-fhir-'));
  const all=new Map(resources.map(r=>[r.resourceType+'/'+r.id,r]));
  for(let pass=0;pass<5;pass++){
   const refs=[...new Set((JSON.stringify([...all.values()]).match(/"reference":"[A-Za-z]+\/[^\"]+"/g)||[]).map(m=>m.slice(13,-1)))];
   let changed=false;
   for(const ref of refs){if(all.has(ref))continue;const r=await get(ref,admin);assert(r.status===200,'Unresolved '+ref+' '+r.status);all.set(ref,r.body);changed=true;}
   if(!changed)break;
  }
  resources=[...all.values()];
  fs.writeFileSync(path.join(out,'resources.json'),JSON.stringify({resourceType:'Bundle',type:'collection',entry:resources.map(r=>({fullUrl:'https://hms.example/api/fhir/'+r.resourceType+'/'+r.id,resource:r}))}));
  fs.writeFileSync(path.join(out,'prescription.json'),JSON.stringify(original));fs.writeFileSync(path.join(out,'discharge.json'),JSON.stringify(amended));
  const r=spawnSync('java',['-cp',`${dir}/lib/*:${dir}/classes`,'HmsValidate',out],{encoding:'utf8',timeout:180000,env:{...process.env,HMS_FHIR_TX:'n/a'}});
  fs.writeFileSync(path.join(out,'validation.log'),(r.stdout||'')+(r.stderr||''),{mode:0o600});
  console.log('      '+(r.stdout||'').split('\n').filter(l=>l.startsWith('validated')).join(' '));
  const errors=(r.stdout||'').split('\n').filter(l=>l.startsWith('ERROR')).slice(0,8);
  assert(r.status===0,errors.join('\n')||r.stderr?.slice(-300)||'Validator failed');
  fs.rmSync(out,{recursive:true,force:true});
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
