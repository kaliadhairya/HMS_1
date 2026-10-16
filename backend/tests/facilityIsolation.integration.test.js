const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg');
test('actual PostgreSQL facility policies and verified clinical credential gates',{skip:process.env.HMS_FACILITY_TEST!=='true',timeout:30000},async t=>{
 assert.match(process.env.DB_NAME||'',/^hms_(p4_final|verify_final)_/);
 const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});
 await c.connect();const role='hms_verify_final_scope_'+crypto.randomBytes(5).toString('hex');
 try{
  await c.query('BEGIN');
  const initial=(await c.query('SELECT hms_initial_facility() id')).rows[0].id;
  const other=(await c.query("INSERT INTO hms_facilities(code,name,timezone) VALUES($1,'Synthetic scope acceptance facility','UTC') RETURNING id",[role])).rows[0].id;
  const users=(await c.query("SELECT id,role FROM hms_users WHERE username IN ('doctor','admin','superadmin') ORDER BY id")).rows;
  const doctor=users.find(u=>u.role==='doctor').id,admins=users.filter(u=>['admin','super_admin'].includes(u.role));assert.equal(admins.length,2);
  const wardA=(await c.query("INSERT INTO hms_wards(name,facility_id) VALUES('Synthetic facility A ward',$1) RETURNING id",[initial])).rows[0].id;
  const wardB=(await c.query("INSERT INTO hms_wards(name,facility_id) VALUES('Synthetic facility B ward',$1) RETURNING id",[other])).rows[0].id;
  for(const [owner,facility,suffix] of [[doctor,initial,'own'],[admins[0].id,initial,'peer'],[doctor,other,'foreign']])await c.query(`INSERT INTO hms_idempotency_keys(user_id,facility_id,idempotency_key,method,path,request_hash,request_id,state,response_status,response_body)
   VALUES($1,$2,$3,'POST','/synthetic',repeat('a',64),$4,'completed',200,'{"synthetic":true}')`,[owner,facility,role+'-'+suffix,crypto.randomUUID()]);
  await c.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
  await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);
  await c.query(`GRANT INSERT,UPDATE,DELETE ON hms_wards,hms_beds TO ${role}`);
  await c.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  await c.query(`SET LOCAL ROLE ${role}`);
  const expectDenied=async(query,params=[])=>{await c.query('SAVEPOINT denied');try{await assert.rejects(c.query(query,params),e=>e.code==='42501'||e.code==='23503');}finally{await c.query('ROLLBACK TO SAVEPOINT denied');}};
  await t.test('a runtime connection without verified facility context reads no clinical rows',async()=>{
   assert.equal((await c.query('SELECT id FROM hms_wards')).rows.length,0);
   await expectDenied("INSERT INTO hms_wards(name) VALUES('Must be refused')");
  });
  await c.query("SELECT set_config('hms.actor_user_id',$1,true),set_config('hms.facility_id',$2,true)",[String(doctor),initial]);
  await t.test('a valid facility connection can see its ward but not another facility',async()=>{
   const rows=(await c.query('SELECT id FROM hms_wards WHERE id=ANY($1::int[])',[[wardA,wardB]])).rows;
   assert.deepEqual(rows.map(r=>r.id),[wardA]);
  });
  await t.test('receipt payloads are scoped to both the actor and facility at the database boundary',async()=>{
   const rows=(await c.query('SELECT idempotency_key FROM hms_idempotency_keys WHERE idempotency_key LIKE $1',[role+'-%'])).rows;
   assert.deepEqual(rows.map(r=>r.idempotency_key),[role+'-own']);
  });
  await t.test('the restricted identity passes production checks and captures writes without audit-table grants',async()=>{
   await require('../services/databaseRuntime.cts').verifyRuntime({query:async sql=>(await c.query(sql)).rows});
   const [row]=(await c.query("INSERT INTO hms_wards(name) VALUES('Synthetic restricted-role audited ward') RETURNING id")).rows;
   await c.query('RESET ROLE');
   const captured=(await c.query("SELECT actor_user_id,new_values FROM audit.row_changes WHERE table_name='hms_wards' AND row_id=$1 ORDER BY id DESC LIMIT 1",[String(row.id)])).rows[0];
   assert.equal(captured.actor_user_id,doctor);assert.equal(captured.new_values.facility_id,initial);
   await c.query(`SET LOCAL ROLE ${role}`);
  });
  await t.test('foreign-facility writes and ownership rewrites are refused',async()=>{
   await expectDenied("INSERT INTO hms_wards(name,facility_id) VALUES('Wrong facility',$1)",[other]);
   await expectDenied('UPDATE hms_wards SET facility_id=$1 WHERE id=$2',[other,wardA]);
   assert.equal((await c.query("UPDATE hms_wards SET name='Attempted wrong-facility write' WHERE id=$1 RETURNING id",[wardB])).rows.length,0);
  });
  await t.test('a child cannot point to a parent in another facility',async()=>{
   await c.query('SAVEPOINT foreign_parent');
   try{await c.query("INSERT INTO hms_beds(ward_id,bed_number,facility_id) VALUES($1,'SYNTHETIC',$2)",[wardB,initial]);await assert.rejects(c.query('SET CONSTRAINTS ALL IMMEDIATE'),e=>e.code==='23503');}
   finally{await c.query('ROLLBACK TO SAVEPOINT foreign_parent');}
  });
  await c.query('RESET ROLE');
  await t.test('membership revocation takes effect on the next database statement',async()=>{
   await c.query('SAVEPOINT revoked');
   try{await c.query("UPDATE hms_facility_memberships SET revoked_at=now(),revoked_by_user_id=$1,revocation_reason='Synthetic row-policy membership revocation' WHERE user_id=$1 AND facility_id=$2 AND revoked_at IS NULL",[doctor,initial]);await c.query(`SET LOCAL ROLE ${role}`);assert.equal((await c.query('SELECT id FROM hms_wards WHERE id=$1',[wardA])).rows.length,0);}
   finally{await c.query('ROLLBACK TO SAVEPOINT revoked');}
  });
  // All fixtures remain inside this disposable transaction. The values below
  // are labelled synthetic evidence, never a hospital credential approval.
  await c.query("SELECT set_config('hms.actor_user_id','',true),set_config('hms.facility_id','',true)");
  const practitioner=(await c.query('SELECT id FROM hms_practitioners WHERE user_id=$1',[doctor])).rows[0].id;
  await c.query('UPDATE hms_practitioner_credentials SET ended_by=$1,ended_reason=\'Synthetic acceptance isolation\' WHERE practitioner_id=$2 AND ended_by IS NULL',[admins[0].id,practitioner]);
  const current=async()=>((await c.query("SELECT hms_current_professional_credential($1,'doctor') allowed",[doctor])).rows[0].allowed);
  await t.test('missing or unverified professional credentials cannot authorize clinical work',async()=>{
   assert.equal(await current(),false);
   await c.query("INSERT INTO hms_practitioner_credentials(practitioner_id,kind,identifier,issuing_body,valid_from,valid_to,created_by) VALUES($1,'medical_registration',$2,'SYNTHETIC TEST COUNCIL',hms_service_today()-1,hms_service_today()+1,$3)",[practitioner,role,admins[0].id]);
   assert.equal(await current(),false);
  });
  await t.test('only current independently checked evidence authorizes the professional role',async()=>{
   await c.query("UPDATE hms_practitioner_credentials SET verified_by=$1,verified_at=now(),verification_evidence='{}' WHERE identifier=$2",[admins[1].id,role]);assert.equal(await current(),false);
   await c.query("UPDATE hms_practitioner_credentials SET verification_evidence=$1::jsonb WHERE identifier=$2",[JSON.stringify({reference:'SYNTHETIC-TEST',reason:'Synthetic independent credential verification fixture'}),role]);assert.equal(await current(),true);
   await c.query('UPDATE hms_practitioner_credentials SET verified_by=created_by WHERE identifier=$1',[role]);assert.equal(await current(),false);
   await c.query('UPDATE hms_practitioner_credentials SET verified_by=$1,valid_to=hms_service_today()-1 WHERE identifier=$2',[admins[1].id,role]);assert.equal(await current(),false);
  });
  await t.test('facility foreign key names are independent of PostgreSQL catalog OIDs',async()=>{
   assert.equal((await c.query("SELECT conname FROM pg_constraint WHERE conname ~ '^fk_fac_[0-9]+$'")).rows.length,0);
  });
 }finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
});
