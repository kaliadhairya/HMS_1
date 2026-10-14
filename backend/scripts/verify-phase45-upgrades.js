// Prove late-arriving Phase 4 migrations safely join an already-migrated
// Phase 5 database, as well as the normal Phase 4 -> Phase 5 upgrade.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),{Client}=require('pg');
assert.equal(process.env.HMS_TEST_DATABASE,'true');assert.match(process.env.DB_NAME||'',/^hms_p4_p5_/);
const root=path.resolve(__dirname,'../..'),privateRoot=fs.mkdtempSync(path.join(os.tmpdir(),'hms-phase45-upgrades-'));
fs.chmodSync(privateRoot,0o700);
const config={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD};
const hash=rows=>crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');
function command(binary,args,env,cwd=root){const r=spawnSync(binary,args,{env:{...process.env,...env},cwd,encoding:'utf8',maxBuffer:16*1024*1024});if(r.status!==0)throw new Error(binary+' failed: '+(r.stderr||r.stdout).slice(-1000));return r.stdout;}
(async()=>{const admin=new Client({...config,database:'postgres'});await admin.connect();try{
 for(const [label,branch] of [['phase4','phase4/laboratory'],['phase5','phase5/revenue-cycle']]){
  const database='hms_p4_p5_upgrade_'+label+'_'+process.pid;assert.match(database,/^hms_p4_p5_upgrade_phase[45]_\d+$/);
  await admin.query('CREATE DATABASE '+database);const temp=path.join(privateRoot,label);fs.mkdirSync(temp,{mode:0o700});
  const archive=spawnSync('git',['archive',branch,'backend/migrations'],{cwd:root,maxBuffer:16*1024*1024});assert.equal(archive.status,0);
  const extract=spawnSync('tar',['-x','-C',temp],{input:archive.stdout});assert.equal(extract.status,0);
  fs.writeFileSync(path.join(temp,'backend/migrate.js'),command('git',['show',branch+':backend/migrate.js']));
  fs.symlinkSync(path.join(root,'backend/node_modules'),path.join(temp,'backend/node_modules'),'dir');
  const db=new Client({...config,database});await db.connect();
  try{
   command(process.execPath,[path.join(temp,'backend/migrate.js'),'up'],{DB_NAME:database});
   // Add a synthetic clinical source in the source branch's existing model.
   const p=(await db.query("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic upgrade patient',$1,'other',30,'Male','OPD',CURRENT_DATE) RETURNING id",['UPG-'+label+'-'+process.pid])).rows[0];
   const u=(await db.query("INSERT INTO hms_users(username,password,name,role,is_active) VALUES($1,'NOT-A-LOGIN','Synthetic upgrade actor','doctor',1) RETURNING id",['upgrade-'+label+'-'+process.pid])).rows[0];
   const e=(await db.query("INSERT INTO hms_encounters(id,patient_id,doctor_id,status) VALUES(nextval('hms_encounters_seq'),$1,$2,'Draft') RETURNING id",[p.id,u.id])).rows[0];
   const o=(await db.query("INSERT INTO hms_investigation_orders(encounter_id,patient_id,doctor_id,status) VALUES($1,$2,$3,'Pending') RETURNING id",[e.id,p.id,u.id])).rows[0];
   await db.query("INSERT INTO hms_investigation_order_items(order_id,item_name,test_category,status) VALUES($1,'Synthetic upgrade test','TEST','Pending')",[o.id]);
   const original=(await db.query('SELECT id,order_id,item_name,status FROM hms_investigation_order_items ORDER BY id')).rows;
   const financial=label==='phase5'?(await db.query('SELECT id,source_type,source_key,account_id,amount FROM hms_charge_events ORDER BY id')).rows:null;
   command(process.execPath,['backend/migrate.js','up'],{DB_NAME:database});command(process.execPath,['backend/migrate.js','check'],{DB_NAME:database});
   assert.equal(hash((await db.query('SELECT id,order_id,item_name,status FROM hms_investigation_order_items ORDER BY id')).rows),hash(original),'Clinical source identity changed during upgrade');
   if(financial)assert.equal(hash((await db.query('SELECT id,source_type,source_key,account_id,amount FROM hms_charge_events ORDER BY id')).rows),hash(financial),'Phase 4 migration rewrote an existing Phase 5 charge');
   if(label==='phase5'){const quarantine=(await db.query('SELECT count(*)::int AS n FROM hms_lab_reconciliation WHERE item_id IS NOT NULL')).rows[0];assert.equal(quarantine.n,original.length,'Legacy items were guessed or lost instead of quarantined');}
   else {const charges=(await db.query("SELECT count(*)::int AS n FROM hms_charge_events WHERE source_type='lab_order_item'")).rows[0];assert.equal(charges.n,original.length,'Phase 5 failed to capture existing clinical source charges');}
   console.log(label+' -> combined: PASS; clinical identities retained; '+(financial?'existing charges unchanged':'new charges captured by Phase 5'));
  }finally{await db.end();await admin.query('DROP DATABASE '+database);}
 }
}finally{await admin.end();fs.rmSync(privateRoot,{recursive:true,force:true});}})().catch(e=>{console.error(e.message);process.exitCode=1;});
