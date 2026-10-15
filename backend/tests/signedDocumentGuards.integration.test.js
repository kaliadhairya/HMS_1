const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),{Client}=require('pg');
const enabled=process.env.HMS_FACILITY_TEST==='true';
test('signed document projection and amendment guards hold in PostgreSQL',{skip:!enabled},async t=>{
 if(!/^hms_(p4_final_(?!claude)|verify_final_)/.test(process.env.DB_NAME||''))throw new Error('Use a dedicated clinical completion test database.');
 const c=new Client({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DB_USER,password:process.env.DB_PASSWORD});await c.connect();
 try{
  await c.query('BEGIN');
  const {rows:[u]}=await c.query("SELECT u.id,hms_initial_facility() facility FROM hms_users u WHERE username='doctor'");
  await c.query("SELECT set_config('app.actor_id',$1,true),set_config('app.facility_id',$2,true)",[String(u.id),u.facility]);
  const {rows:[p]}=await c.query("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) VALUES('Synthetic signed projection guard',$1,'other',30,'Female','OPD',CURRENT_DATE) RETURNING id",['DG-'+crypto.randomUUID().slice(0,12)]);
  const first={history:'Synthetic first signed revision'},firstJson=JSON.stringify(first),digest=crypto.createHash('sha256').update(firstJson).digest('hex');
  const {rows:[d]}=await c.query("INSERT INTO hms_clinical_documents(patient_id,author_user_id,facility_id,doc_type,draft_content) VALUES($1,$2,$3,'clinical_note',$4) RETURNING id",[p.id,u.id,u.facility,firstJson]);
  await c.query("INSERT INTO hms_document_signatures(document_id,version,content,digest,signed_by,meaning,facility_id) VALUES($1,1,$2,$3,$4,'authored and signed',$5)",[d.id,firstJson,digest,u.id,u.facility]);
  await c.query("UPDATE hms_clinical_documents SET state='signed',signed_version=1 WHERE id=$1",[d.id]);
  const rejects=async(sql,values,code)=>{
   await c.query('SAVEPOINT refused_command');let error;
   try{await c.query(sql,values);}catch(e){error=e;}
   await c.query('ROLLBACK TO SAVEPOINT refused_command');assert.equal(error?.code,code);
  };
  await t.test('signed presentation text cannot be overwritten',()=>rejects("UPDATE hms_clinical_documents SET draft_content='{}' WHERE id=$1",[d.id],'42501'));
  await t.test('signed version cannot be removed or rewound',()=>rejects('UPDATE hms_clinical_documents SET signed_version=NULL WHERE id=$1',[d.id],'42501'));
  await t.test('clinical author and document type remain stable',()=>rejects("UPDATE hms_clinical_documents SET doc_type='care_plan' WHERE id=$1",[d.id],'42501'));
  await t.test('reopening requires a new revision and recorded reason',()=>rejects("UPDATE hms_clinical_documents SET state='draft' WHERE id=$1",[d.id],'23514'));
  await t.test('a signed document cannot be deleted',()=>rejects('DELETE FROM hms_clinical_documents WHERE id=$1',[d.id],'42501'));
  await t.test('a linked amendment signs its exact new content while retaining the predecessor',async()=>{
   const reason='Synthetic reviewed correction reason',second={history:'Synthetic corrected revision'};
   await c.query("UPDATE hms_clinical_documents SET state='draft',draft_version=draft_version+1,amendment_reason=$2 WHERE id=$1",[d.id,reason]);
   await c.query('UPDATE hms_clinical_documents SET draft_content=$2,draft_version=draft_version+1 WHERE id=$1',[d.id,JSON.stringify(second)]);
   await rejects("UPDATE hms_clinical_documents SET state='signed',signed_version=2 WHERE id=$1",[d.id],'23514');
   const nextDigest=crypto.createHash('sha256').update(JSON.stringify(second)).digest('hex');
   await c.query("INSERT INTO hms_document_signatures(document_id,version,content,digest,signed_by,meaning,amends_version,amendment_reason,facility_id) VALUES($1,2,$2,$3,$4,'amended and signed',1,$5,$6)",[d.id,JSON.stringify(second),nextDigest,u.id,reason,u.facility]);
   await c.query("UPDATE hms_clinical_documents SET state='signed',signed_version=2 WHERE id=$1",[d.id]);
   const {rows}=await c.query('SELECT content,digest,amends_version FROM hms_document_signatures WHERE document_id=$1 ORDER BY version',[d.id]);assert.equal(rows.length,2);assert.deepEqual(rows[0].content,first);assert.equal(rows[0].digest,digest);assert.equal(rows[1].amends_version,1);
  });
 }finally{await c.query('ROLLBACK');await c.end();}
});
