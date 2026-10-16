// An independent synthetic critical result, created through governed APIs.
const crypto=require('crypto');
const {api,apiLogin,sql,assert,inCare,requireThrowawayDb}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');
async function criticalFixture(patientId){
 requireThrowawayDb();const tag=crypto.randomUUID().slice(0,8),lab=await apiLogin('lab_technician'),doctor=await apiLogin('doctor'),admin=await apiLogin('super_admin');
 await clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN','LAB_PROCESS','LAB_RELEASE']);await clinicalFixture('lab_technician',['CHART_READ','LAB_PROCESS']);await inCare(patientId);
 const [d]=await sql("SELECT id FROM hms_users WHERE username='doctor'"),[l]=await sql("SELECT id FROM hms_users WHERE username='labtech'");
 const ok=(r,status=200)=>{assert(r.status===status,`Synthetic critical fixture ${r.status}: ${JSON.stringify(r.data).slice(0,300)}`);return r.data.data;};
 const call=(path,body,revision,token=lab)=>api('POST','/laboratory'+path,{token,body,headers:revision===undefined?{}:{'if-match':String(revision)}});
 const base={provenance:'SYNTHETIC UI ACCEPTANCE ONLY; NOT CLINICAL CONTENT',effective_at:new Date(Date.now()-60000).toISOString()};
 for(const privilege of ['CONTENT','TECHNICAL_REVIEW'])ok(await call('/privileges',{user_id:l.id,privilege,reason:base.provenance,valid_from:base.effective_at,valid_until:new Date(Date.now()+86400000).toISOString()},undefined,admin),201);
 const test=ok(await call('/catalogue',{...base,code_system:'urn:synthetic-critical-ui',code:tag,name:'Synthetic UI critical finding',kind:'TEST',section:'TEST',unit:'TEST-U',method:'TEST-METHOD',requirements:[{specimen_type:'TEST-BLOOD',container:'TEST-TUBE'}]}),201);
 const escalation=ok(await call('/configuration/escalation',{...base,code:tag,version:1,steps:[{after_seconds:300,recipient_user_id:d.id}]}),201);
 ok(await call('/configuration/critical',{...base,test_version_id:test.id,version:1,method:'TEST-METHOD',unit:'TEST-U',upper_bound:'1',lower_inclusive:false,upper_inclusive:false,escalation_policy_id:escalation.id}),201);
 const rule=ok(await call('/configuration/qc',{...base,test_version_id:test.id,version:1,method:'TEST-METHOD',criteria:{synthetic_control:'fixture'}}),201),qc=ok(await call('/qc',{rule_id:rule.id,status:'PASS',evidence:{synthetic_control:'pass'}}),201);
 const [encounter]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",[patientId,d.id]);
 const order=ok(await call('/orders',{patient_id:patientId,encounter_id:encounter.id,test_version_ids:[test.id]},undefined,doctor),201),item=order.items[0];
 const [requirement]=await sql('SELECT id FROM hms_lab_requirements WHERE test_version_id=$1',[test.id]);
 let specimen=ok(await call('/specimens',{patient_id:patientId,specimen_type:'TEST-BLOOD',container:'TEST-TUBE',location:'SYNTHETIC',links:[{item_id:item.id,requirement_id:requirement.id}]}),201);
 for(const state of ['COLLECTED','RECEIVED'])specimen=ok(await call(`/specimens/${specimen.id}/transition`,{patient_id:patientId,accession:specimen.accession,state,location:'SYNTHETIC',reason:'Synthetic custody evidence'},specimen.revision));
 const result=ok(await call(`/items/${item.id}/results`,{specimen_id:specimen.id,raw_value:'5',unit:'TEST-U',method:'TEST-METHOD'},0),201);
 const review=ok(await call(`/results/${result.result.id}/technical-review`,{decision:'VERIFIED',qc_record_id:qc.id,reason:'Synthetic independently governed critical UI fixture'},1));
 assert(review.critical_task?.id,'Synthetic critical workflow did not produce its task');return review.critical_task;
}
module.exports={criticalFixture};
