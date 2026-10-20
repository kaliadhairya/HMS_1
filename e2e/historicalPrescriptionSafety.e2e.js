const crypto=require('node:crypto');
const {api,apiLogin,sql,inCare,runner,assert,requireThrowawayDb,syntheticClinician}=require('./helpers');
const {historicalPrescription}=require('./historicalPrescriptionFixture');
requireThrowawayDb();
(async()=>{
 const {step,done}=runner('Historical prescription boundary'),tag=crypto.randomUUID().slice(0,8);
 await require('./clinicalFixtures').clinicalFixture('doctor',['CHART_READ','CLINICAL_SIGN']);
 await require('./clinicalFixtures').clinicalFixture('pharmacist',['CHART_READ','DISPENSE']);
 await require('./clinicalFixtures').clinicalFixture('nurse',['CHART_READ','NURSING_DOCUMENT']);
 const doctor=await apiLogin('doctor'),admin=await apiLogin('admin'),desk=await apiLogin('receptionist'),nurse=await apiLogin('nurse'),pharmacist=await apiLogin('pharmacist');
 const [user]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
 const make=async label=>{
  const [p]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES($1,$2,'other',30,'Unknown','OPD',hms_service_today()) RETURNING id",['Synthetic history '+label,tag+'-'+label]);
  const [e]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id",[p.id,user.id]);
  const rx=await historicalPrescription({patientId:p.id,encounterId:e.id,doctorId:user.id,items:[{medicine_name:'Synthetic retained text',dose:'1',dose_unit:'tablet'}]});return {p,e,rx};
 };
 const own=await make('own'),unrelated=await make('unrelated');await inCare(own.p.id);
 await step('Retired writers cannot create, replace or alter legacy clinical supply',async()=>{
  const [before]=await sql('SELECT count(*)::int n FROM hms_prescription_items WHERE prescription_id=$1',[own.rx.id]);
  for(const [method,path,body]of [['POST','/hms/prescriptions',{patient_id:own.p.id,encounter_id:own.e.id}],['PUT',`/hms/prescriptions/${own.rx.id}/items`,{items:[{medicine_name:'Must not replace'}]}],['PATCH',`/hms/prescriptions/${own.rx.id}/status`,{status:'Dispensed'}]]){
   const r=await api(method,path,{token:doctor,body});assert(r.status===410&&r.data.code==='LEGACY_PRESCRIPTION_RETIRED','Unsafe legacy authoring remained available');
  }
  const [after]=await sql('SELECT count(*)::int n FROM hms_prescription_items WHERE prescription_id=$1',[own.rx.id]);assert(after.n===before.n,'Historical lines changed');
 });
 await step('Authorized historical reads and PDFs retain the original text and explicit historical meaning',async()=>{
  const r=await api('GET',`/hms/prescriptions/${own.rx.id}`,{token:doctor});assert(r.status===200&&r.data.data.items[0].medicine_name==='Synthetic retained text','Historical data was lost');
  assert((await api('GET',`/hms/prescriptions/${own.rx.id}`,{token:pharmacist})).status===200,'Approved pharmacy work could not read historical text');
  assert((await api('GET',`/pdf/prescription/${own.rx.id}`,{token:doctor})).status===200,'Authorized historical PDF unavailable');
 });
 await step('Administration, front desk and unrelated clinical staff cannot read or print charts',async()=>{
  for(const token of [admin,desk,nurse])for(const path of [`/hms/prescriptions/${own.rx.id}`,`/pdf/prescription/${own.rx.id}`])assert((await api('GET',path,{token})).status===403,'A non-care identity accessed a historical chart');
  for(const path of [`/hms/prescriptions/${unrelated.rx.id}`,`/hms/prescriptions/patient/${unrelated.p.id}`,`/hms/prescriptions/encounter/${unrelated.e.id}`,`/pdf/prescription/${unrelated.rx.id}`])assert((await api('GET',path,{token:doctor})).status===403,'An unrelated chart was disclosed');
 });
 await step('A foreign-facility historical identifier is unavailable even to a doctor caring for that patient',async()=>{
  const [f]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic historical foreign','UTC') RETURNING id",['HIST-'+tag]);
  const [e]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status,facility_id) VALUES($1,$2,'Draft',$3) RETURNING id",[own.p.id,user.id,f.id]);
  const [rx]=await sql("INSERT INTO hms_prescriptions(patient_id,encounter_id,doctor_id,status,facility_id) VALUES($1,$2,$3,'Draft',$4) RETURNING id",[own.p.id,e.id,user.id,f.id]);
  for(const path of [`/hms/prescriptions/${rx.id}`,`/pdf/prescription/${rx.id}`])assert((await api('GET',path,{token:doctor})).status===404,'Foreign historical chart was disclosed');
 });
 await step('A login with care membership but no verified clinical credential cannot read or print',async()=>{
  const username='hist-'+tag.slice(0,12),password=crypto.randomBytes(24).toString('hex'),hash=await require('../backend/node_modules/bcryptjs').hash(password,4);
  const [u]=await sql("INSERT INTO hms_users(username,password,name,role,is_active) VALUES($1,$2,'Synthetic unverified historical reader','doctor',1) RETURNING id",[username,hash]);
  await syntheticClinician(u.id,'doctor',{credential:false}); // practitioner record without a verified credential
  await sql("INSERT INTO hms_care_team_assignments(patient_id,practitioner_user_id,role,assigned_by) VALUES($1,$2,'consulting',$3)",[own.p.id,u.id,user.id]);
  const login=await api('POST','/auth/login',{body:{username,password},headers:{'X-Auth-Transport':'bearer'}});assert(login.data.token,'Synthetic login failed');
  for(const path of [`/hms/prescriptions/${own.rx.id}`,`/pdf/prescription/${own.rx.id}`])assert((await api('GET',path,{token:login.data.token})).status===403,'Unverified login obtained a clinical record');
 });
 done();process.exit();
})().catch(error=>{console.error(error.message);process.exit(1)});
