// Synthetic acceptance fixtures only. These are not clinical formulary content.
const crypto=require('crypto');
const {isDeepStrictEqual}=require('node:util');
const {api,apiLogin,sql,runner,assert,inCare,requireThrowawayDb}=require('./helpers');
const {clinicalFixture}=require('./clinicalFixtures');
requireThrowawayDb();
const at=m=>new Date(Date.now()+m*60000).toISOString();
const checked=(r,status=200)=>{assert(r.status===status,`${r.status}: ${JSON.stringify(r.data).slice(0,500)}`);return r.data.data;};
(async()=>{
 const {step,done}=runner('Native medication authority'),tag=crypto.randomUUID().slice(0,8);
 const doctor=await apiLogin('doctor'),pharmacist=await apiLogin('pharmacist'),admin=await apiLogin('admin'),nurse=await apiLogin('nurse');
 await clinicalFixture('doctor',['CHART_READ','PRESCRIBE','CLINICAL_SIGN']);await clinicalFixture('pharmacist',['CHART_READ','DISPENSE']);
 const [patient]=await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic native medication patient',$1,'other',30,'Other','OPD',CURRENT_DATE) RETURNING id,public_id",['VM-'+tag]);await inCare(patient.id);
 const [user]=await sql("SELECT id FROM hms_users WHERE username='doctor'");
 const [encounter]=await sql("INSERT INTO hms_encounters(patient_id,doctor_id,status) VALUES($1,$2,'Draft') RETURNING id,public_id,facility_id",[patient.id,user.id]);
 const legacy=(method,path,body,token=pharmacist,revision)=>api(method,'/medication'+path,{token,body,headers:revision===undefined?{}:{'if-match':String(revision)}});
 const ingredient=checked(await legacy('POST','/ingredients',{code_system:'urn:synthetic-native-medication',code:tag,name:'Synthetic native ingredient',provenance:'SYNTHETIC TEST ONLY',effective_at:at(-60)}),201);
 const product=checked(await legacy('POST','/products',{code:'VM-'+tag,name:'Synthetic native product '+tag,strength:'1',strength_unit:'mg',dose_form:'TEST-FORM',route:'TEST-ROUTE',base_unit:'mL',pack_unit:'test-pack',pack_conversion:'10',quantity_precision:3,concentration_denominator:'1',concentration_unit:'mL',controlled:false,provenance:'SYNTHETIC TEST ONLY',effective_at:at(-60),ingredients:[{ingredient_id:ingredient.id,amount:'1',unit:'mg'}]}),201);
 const [supplier]=await sql("INSERT INTO hms_suppliers(name,is_active) VALUES($1,1) RETURNING id",['Synthetic native supplier '+tag]);
 const [location]=await sql("SELECT id FROM hms_med_locations WHERE code='MAIN' AND facility_id=$1 ORDER BY id LIMIT 1",[encounter.facility_id]);assert(location,'Missing prepared main pharmacy fixture');
 checked(await legacy('POST','/receipts',{supplier_id:supplier.id,invoice_ref:'VM-'+tag,lines:[{product_id:product.id,manufacturer_lot:'VM-'+tag,expiry_date:new Date(Date.now()+30*86400000).toISOString().slice(0,10),manufacturer:'Synthetic test manufacturer',document_ref:'SYNTHETIC ONLY',quantity:'20',purchase_rate:'1.25',mrp:'2.50'}]}),201);
 const body={patient_id:patient.public_id,encounter_id:encounter.public_id,product_id:product.id,dose:'1',dose_unit:'mL',route:'TEST-ROUTE',frequency:{type:'INTERVAL',interval_minutes:60},starts_at:at(-5),ends_at:at(1440),supply_quantity:'3',supply_unit:'mL'};
 const native=(method,path,b,token=doctor,version,key)=>api(method,'/v2'+path,{token,body:b,headers:{...(version===undefined?{}:{'if-match':String(version)}),...(key?{'idempotency-key':key}:{})}});
 let order,fill,fillBody,fillKey,fillResponse,oldVersion,schedule,dose,uniquePharmacy;
 await step('UUID order creation is replayed exactly and rejects numeric identities and approximate quantities',async()=>{
  const key=crypto.randomUUID(),r=await native('POST','/medication-orders',body,doctor,undefined,key);order=checked(r,201);
  assert(order.patient_id===patient.public_id&&order.encounter_id===encounter.public_id&&Number(order.dose)===1,'Native relationships or exact quantities changed');
  const again=await native('POST','/medication-orders',body,doctor,undefined,key);assert(again.status===201&&isDeepStrictEqual(again.data,r.data),'Retry did not replay the original committed operation');
  for(const invalid of [{...body,patient_id:patient.id},{...body,dose:1},{...body,patientId:patient.public_id}])assert((await native('POST','/medication-orders',invalid)).status===422,'Invalid public contract accepted');
 });
 await step('Legacy and native commands share content authority and explicit preconditions',async()=>{
  assert((await native('POST',`/medication-orders/${order.id}/sign`,{})).status===428,'Missing public precondition accepted');
  assert((await native('POST',`/medication-orders/${order.id}/sign`,{},doctor,999)).status===412,'Stale public precondition accepted');
  oldVersion=order.version;const [row]=await sql('SELECT revision FROM hms_med_orders WHERE id=$1',[order.id]);
  checked(await legacy('POST',`/orders/${order.id}/sign`,{reason:'Synthetic prescriber approval'},doctor,row.revision));
  assert((await native('POST',`/medication-orders/${order.id}/hold`,{reason:'Stale review'},doctor,oldVersion)).status===412,'Legacy signature did not invalidate the native review');
  order=checked(await native('GET','/medication-orders/'+order.id));assert(order.state==='SIGNED','Signature not visible');
  assert((await native('POST',`/medication-orders/${order.id}/verify`,{state:'VERIFIED'},doctor,order.version)).status===403,'Prescriber performed independent pharmacy review');
  assert((await native('POST',`/medication-orders/${order.id}/hold`,{reason:'Admin bypass'},admin,order.version)).status===403,'Administrator acquired prescribing authority');
  order=checked(await native('POST',`/medication-orders/${order.id}/verify`,{state:'VERIFIED',reason:'Synthetic independent coverage review',coverage_acknowledged:true},pharmacist,order.version));
 });
 await step('Fulfillment identifies the exact signed line and rejects foreign-facility stock',async()=>{
  fillBody={order_id:order.id,order_version_id:crypto.randomUUID(),product_id:product.id,location_id:location.id,quantity:'0.25'};
  assert((await native('POST','/dispenses',fillBody,pharmacist,order.version)).status===409,'Wrong signed line version fulfilled');
  const [facility]=await sql("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic foreign pharmacy','UTC') RETURNING id",['VM-'+tag]);
  const [foreign]=await sql("INSERT INTO hms_med_locations(code,name,kind,timezone,facility_id) VALUES($1,'Synthetic foreign main','STORE','UTC',$2) RETURNING id",['VM-'+tag,facility.id]);
  fillBody.order_version_id=order.order_version_id;
  assert((await native('POST','/dispenses',{...fillBody,location_id:foreign.id},pharmacist,order.version)).status===422,'Foreign stock location accepted');
  assert(checked(await native('GET','/medication-orders/'+order.id)).version===order.version,'Rejected fill changed the order');
 });
 await step('A partial fill commits once with its charge, stock movement and a new public review version',async()=>{
  oldVersion=order.version;fillKey=crypto.randomUUID();fillResponse=await native('POST','/dispenses',fillBody,pharmacist,oldVersion,fillKey);fill=checked(fillResponse,201);
  assert(fill.order_version>oldVersion&&Number(fill.lines[0].quantity)===0.25,'Fulfillment did not advance public review state');
  const replay=await native('POST','/dispenses',fillBody,pharmacist,oldVersion,fillKey);assert(replay.status===201&&isDeepStrictEqual(replay.data,fillResponse.data),'Exact dispense retry changed result');
  const [counts]=await sql('SELECT count(*)::int n FROM hms_med_dispenses WHERE version_id=$1',[order.order_version_id]);assert(counts.n===1,'Replay created another physical fill');
  const read=checked(await native('GET','/dispenses/'+fill.id,undefined,pharmacist));assert(read.patient_id===patient.public_id&&read.lines[0].batch_id,'Dispense read lost canonical identity');
 });
 await step('A new fill needs a fresh public review while the signed content stays immutable',async()=>{
  assert((await native('POST','/dispenses',{...fillBody,quantity:'0.75'},pharmacist,oldVersion)).status===412,'Stale fulfillment review accepted');
  order=checked(await native('GET','/medication-orders/'+order.id));checked(await native('POST','/dispenses',{...fillBody,quantity:'0.75'},pharmacist,order.version),201);
  order=checked(await native('GET','/medication-orders/'+order.id));assert(Number(order.remaining_quantity)===2,'Partial fulfillment arithmetic diverged');
  let denied=false;try{await sql('UPDATE hms_med_order_versions SET dose=2 WHERE id=$1',[order.order_version_id]);}catch{denied=true;}assert(denied,'Signed clinical content rewritten');
 });
 await step('Bedside preparation requires exact patient, signed version and a fresh occurrence review',async()=>{
  await clinicalFixture('nurse',['CHART_READ','NURSING_DOCUMENT']);
  const made=checked(await native('POST',`/medication-orders/${order.id}/schedules`,{from_at:body.starts_at,through_at:at(120)},nurse,order.version),201);schedule=made.occurrences[0];assert(schedule&&schedule.state==='PENDING','No due occurrence created');
  dose={schedule_id:schedule.id,order_version_id:order.order_version_id,patient_id:patient.public_id,product_id:product.id,dispense_line_id:fill.lines[0].id,dose:'1',dose_unit:'mL',route:'TEST-ROUTE',outcome:'GIVEN',actual_at:at(0),scan_evidence:{mode:'MANUAL',reason:'Synthetic scanner unavailable',patient_identifier:'VM-'+tag,product_id:product.id,identity_confirmed:true,dose_checked:true,route_checked:true,time_checked:true}};
  // A single line must contain the full physical dose; combine nothing implicitly.
  const fresh=checked(await native('POST','/dispenses',{...fillBody,quantity:'1'},pharmacist,order.version),201);dose.dispense_line_id=fresh.lines[0].id;
  const noClaim=await native('POST','/administrations',dose,nurse,schedule.version);assert(noClaim.status===422&&noClaim.data.code==='BEDSIDE_CLAIM_REQUIRED','Physical dose recorded without bedside claim');
  const {schedule_id,...prepare}=dose;
  const wrong=await native('POST',`/medication-schedules/${schedule.id}/prepare`,{...prepare,order_version_id:crypto.randomUUID()},nurse,schedule.version);assert(wrong.status===409,'Wrong exact order version prepared');
  const before=schedule.version;const claimed=checked(await native('POST',`/medication-schedules/${schedule.id}/prepare`,prepare,nurse,before),201);assert(claimed.version>before&&claimed.bedside_claim.state==='PENDING_DOCUMENTATION','Claim not visible in occurrence review version');
  assert((await native('POST','/administrations',dose,nurse,before)).status===412,'Pre-claim occurrence review accepted');schedule=claimed;
 });
 await step('Dose documentation replays once and never repeats the physical administration',async()=>{
  const key=crypto.randomUUID();dose.actual_at=at(0);const response=await native('POST','/administrations',dose,nurse,schedule.version,key),record=checked(response,201);
  assert(record.patient_id===patient.public_id&&record.order_version_id===order.order_version_id&&record.schedule_version>schedule.version,'Exact bedside evidence or version lost');
  const replay=await native('POST','/administrations',dose,nurse,schedule.version,key);assert(replay.status===201&&isDeepStrictEqual(replay.data,response.data),'Dose retry changed the committed response');
  const current=checked(await native('GET','/medication-schedules/'+schedule.id,undefined,nurse));assert(current.state==='GIVEN','Occurrence state not updated');
  assert((await native('POST','/administrations',dose,nurse,current.version)).status===409,'Same physical occurrence recorded twice');
  const read=checked(await native('GET','/administrations/'+record.id,undefined,nurse));assert(read.id===record.id&&read.performer_id,'Administration read lacks immutable attribution');
 });
 await step('A pharmacy login without professional approval cannot read or fulfill through either API',async()=>{
  const password='SyntheticNative@123',hash=await require('../backend/node_modules/bcryptjs').hash(password,10),username='vm-unqualified-'+tag;
  await sql("INSERT INTO hms_users(username,password,name,role,is_active,first_login) VALUES($1,$2,'Synthetic unqualified pharmacy','pharmacist',1,0)",[username,hash]);
  const login=await api('POST','/auth/login',{body:{username,password},headers:{'X-Auth-Transport':'bearer'}});assert(login.status===200&&login.data.token,'Synthetic account login failed');const token=login.data.token;uniquePharmacy={username,token};
  assert((await native('GET','/medication-orders/'+order.id,undefined,token)).status===403,'Unqualified pharmacy read permitted');
  assert((await native('POST','/dispenses',fillBody,token,order.version)).status===403,'Unqualified pharmacy native fill permitted');
  const [row]=await sql('SELECT revision FROM hms_med_orders WHERE id=$1',[order.id]);assert((await legacy('POST',`/orders/${order.id}/dispense`,fillBody,token,row.revision)).status===403,'Unqualified pharmacy legacy bypass permitted');
 });
 await step('Revoking pharmacy approval also blocks disclosure through a previously completed receipt',async()=>{
  const grant=await clinicalFixture('pharmacist',['CHART_READ','DISPENSE'],{username:uniquePharmacy.username});
  order=checked(await native('GET','/medication-orders/'+order.id));const key=crypto.randomUUID(),b={...fillBody,quantity:'0.25'};
  checked(await native('POST','/dispenses',b,uniquePharmacy.token,order.version,key),201);
  const revoke=await api('POST',`/facilities/professional-roles/${grant.roleId}/revoke`,{token:admin,body:{reason:'Synthetic clinical privilege revocation'},headers:{'if-match':String(grant.revision)}});checked(revoke);
  assert((await native('POST','/dispenses',b,uniquePharmacy.token,order.version,key)).status===403,'Completed native receipt disclosed after clinical privilege revocation');
  assert((await legacy('GET','/orders/'+order.id,undefined,uniquePharmacy.token)).status===403,'Legacy chart remained accessible after revocation');
 });
 done();process.exit();
})().catch(e=>{console.error(e.message);process.exit(1)});
