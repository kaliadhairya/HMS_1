const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {Client}=require('pg');
test('canonical identity registry preserves exact legacy identities and cannot be forged by the runtime',{skip:process.env.HMS_FACILITY_TEST!=='true',timeout:30000},async t=>{
 assert.match(process.env.DB_NAME||'',/^hms_(p4_final|verify_final)_/);
 const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});await c.connect();
 const role='hms_verify_final_identity_'+crypto.randomBytes(4).toString('hex');
 const denied=async(sql,params=[])=>{await c.query('SAVEPOINT denied');try{await assert.rejects(c.query(sql,params),e=>['42501','23514','23503'].includes(e.code));}finally{await c.query('ROLLBACK TO SAVEPOINT denied');}};
 try{
  await c.query('BEGIN');
  const [{id:facility}]=(await c.query('SELECT hms_initial_facility() id')).rows;
  const [{id:admin}]=(await c.query("SELECT id FROM hms_users WHERE username='admin'")).rows;
  await t.test('every registered existing numeric resource has one exact unique UUID mapping',async()=>{
   const tables=(await c.query('SELECT resource_key,resource_table::text relation FROM hms_identity_resources')).rows;
   for(const r of tables){assert.match(r.relation,/^hms_[a-z0-9_]+$/);const [{n}]=(await c.query(`SELECT count(*)::int n FROM ${r.relation} r LEFT JOIN hms_legacy_identity_map m ON m.resource_key=$1 AND m.legacy_id=r.id AND m.public_id=r.public_id WHERE m.public_id IS NULL`,[r.resource_key])).rows;assert.equal(n,0,r.resource_key);}
  });
  await c.query(`CREATE ROLE ${role} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);await c.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await c.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role}`);await c.query(`GRANT INSERT,UPDATE ON hms_wards TO ${role}`);await c.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  // Deliberately grant these in the negative fixture: the trigger's authority
  // restriction must still reject direct forged registry/map inserts.
  await c.query(`GRANT INSERT ON hms_identity_resources,hms_legacy_identity_map TO ${role}`);
  await c.query(`SET LOCAL ROLE ${role}`);await c.query("SELECT set_config('hms.actor_user_id',$1,true),set_config('hms.facility_id',$2,true)",[String(admin),facility]);
  let ward;
  await t.test('a runtime business insert captures its UUID through the scoped fixed-path trigger',async()=>{
   [ward]=(await c.query("INSERT INTO hms_wards(name) VALUES('Synthetic stable UUID ward') RETURNING id,public_id")).rows;
   const [map]=(await c.query("SELECT legacy_id,public_id FROM hms_legacy_identity_map WHERE resource_key='ward' AND legacy_id=$1",[ward.id])).rows;assert.equal(map.public_id,ward.public_id);assert.equal(map.legacy_id,String(ward.id));
  });
  await t.test('neither numeric nor public identities can be rewritten',async()=>{
   await denied('UPDATE hms_wards SET public_id=$1 WHERE id=$2',[crypto.randomUUID(),ward.id]);
   await denied('UPDATE hms_wards SET id=id+10000000 WHERE id=$1',[ward.id]);
  });
  await t.test('direct registry extension and mapping forgery are denied even with table INSERT grants',async()=>{
   await denied("INSERT INTO hms_identity_resources(resource_key,resource_table,facility_owned) VALUES('forged','hms_facilities',false)");
   await denied("INSERT INTO hms_legacy_identity_map(resource_key,legacy_id,public_id) VALUES('ward',999999999,$1)",[crypto.randomUUID()]);
  });
 }finally{await c.query('ROLLBACK').catch(()=>{});await c.end();}
});
