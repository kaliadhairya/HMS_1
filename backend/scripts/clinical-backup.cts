// Consistent, authenticated encrypted logical backups. No passwords in argv.
// Restore validation creates/drops only a private hms_verify_final_* database;
// it starts no application or workers and cannot emit clinical external effects.
const fs=require('node:fs');
const fsp=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const {pipeline}=require('node:stream/promises');
const {Client}=require('pg');
const V=require('../services/recoveryValidation.cts');
type Config={host:string;port:number;user:string;password:string;database:string};
const config=(restore=false):Config=>({host:(restore?process.env.RESTORE_DB_HOST:process.env.BACKUP_DB_HOST)||process.env.DB_HOST||'127.0.0.1',port:Number((restore?process.env.RESTORE_DB_PORT:process.env.BACKUP_DB_PORT)||process.env.DB_PORT||5432),user:(restore?process.env.RESTORE_DB_USER:process.env.BACKUP_DB_USER)||process.env.DB_USER||'postgres',password:(restore?process.env.RESTORE_DB_PASSWORD:process.env.BACKUP_DB_PASSWORD)||process.env.DB_PASSWORD||'',database:process.env.DB_NAME||''});
function key(){const raw=process.env.BACKUP_ENCRYPTION_KEY;if(!raw||!/^[a-f0-9]{64}$/i.test(raw))throw new Error('BACKUP_ENCRYPTION_KEY must contain 32 random bytes as hex');return Buffer.from(raw,'hex');}
const bin=(name:string)=>path.join(process.env.PG_BIN||'/usr/lib/postgresql/18/bin',name);
const hash=async(file:string)=>{const h=crypto.createHash('sha256');for await(const part of fs.createReadStream(file))h.update(part);return h.digest('hex');};
const secretEnv=async(c:Config,dir:string)=>{
 const escape=(v:string)=>v.replaceAll('\\','\\\\').replaceAll(':','\\:');const file=path.join(dir,'.pgpass');
 await fsp.writeFile(file,[c.host,String(c.port),c.database,c.user,c.password].map(escape).join(':')+'\n',{mode:0o600,flag:'wx'});
 const env:NodeJS.ProcessEnv={...process.env,PGHOST:c.host,PGPORT:String(c.port),PGUSER:c.user,PGDATABASE:c.database,PGPASSFILE:file};delete env.PGPASSWORD;delete env.DB_PASSWORD;delete env.BACKUP_DB_PASSWORD;delete env.RESTORE_DB_PASSWORD;return {env,file};
};
function launch(name:string,args:string[],env:NodeJS.ProcessEnv){
 const child=spawn(bin(name),args,{env,stdio:['pipe','pipe','pipe'],timeout:300000,killSignal:'SIGTERM'});let stderr='';child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-4096);});
 const done=new Promise<void>((resolve,reject)=>{child.on('error',reject);child.on('close',(code:number)=>code===0?resolve():reject(new Error(`${name} failed (${code}); see protected diagnostic file`)));});
 done.catch(()=>{});return {child,done,diagnostic:()=>stderr};
}
async function backup(directory:string){
 const c=config();if(!c.database)throw new Error('DB_NAME is required');const k=key(),id=crypto.randomUUID();
 await fsp.mkdir(directory,{mode:0o700});const client=new Client({...c,connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});await client.connect();let secret:any;
 try{
  const {rows:[lease]}=await client.query('SELECT pg_try_advisory_lock(727288) AS ok');if(!lease.ok)throw new Error('Another backup owns the database backup lease');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const {rows:[source]}=await client.query("SELECT pg_export_snapshot() AS snapshot,version() AS engine,current_database() AS database,pg_current_wal_lsn()::text AS lsn,clock_timestamp() AS observed_at");
  const snapshot=await V.inventory(client);const checks=await V.invariants(client);if(Object.values(checks).some(n=>n!==0))throw new Error('Source invariants failed: '+JSON.stringify(checks));
  const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',k,iv);cipher.setAAD(Buffer.from('hms-logical-backup:'+id));
  secret=await secretEnv(c,directory);const dump=launch('pg_dump',['--format=custom','--snapshot='+source.snapshot,'--no-owner'],secret.env);
  const artifact=path.join(directory,'database.dump.gcm');
  try{await Promise.all([pipeline(dump.child.stdout,cipher,fs.createWriteStream(artifact,{mode:0o600,flags:'wx'})),dump.done]);}
  catch(e){dump.child.kill('SIGTERM');await fsp.writeFile(path.join(directory,'diagnostic.txt'),dump.diagnostic(),{mode:0o600});throw e;}
  const metadata={version:1,id,kind:'LOGICAL',status:'STORED',source:{database:source.database,engine:source.engine,lsn:source.lsn,observed_at:source.observed_at},snapshot,
   artifact:{name:'database.dump.gcm',sha256:await hash(artifact),algorithm:'aes-256-gcm',key_id:process.env.BACKUP_KEY_ID||'configured',iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex')},checks,
   candidate:{commit:require('node:child_process').execFileSync('git',['rev-parse','HEAD'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim(),working_tree_dirty:Boolean(require('node:child_process').execFileSync('git',['status','--porcelain'],{cwd:path.resolve(__dirname,'../..'),encoding:'utf8'}).trim())},stored_at:new Date().toISOString()};
  await client.query('COMMIT');
  await fsp.writeFile(path.join(directory,'manifest.json'),JSON.stringify({...metadata,signature:crypto.createHmac('sha256',k).update(JSON.stringify(metadata)).digest('hex')},null,2)+'\n',{mode:0o600,flag:'wx'});
  return {status:'STORED',id,directory};
 }finally{await client.query('ROLLBACK').catch(()=>{});await client.end();if(secret)await fsp.unlink(secret.file).catch(()=>{});}
}
async function verify(directory:string,database:string){
 if(!/^hms_verify_final_[a-z0-9_]+$/.test(database)||database===process.env.DB_NAME)throw new Error('Restore target must be a distinct hms_verify_final_* database');
 const k=key(),raw=JSON.parse(await fsp.readFile(path.join(directory,'manifest.json'),'utf8')),{signature,...manifest}=raw;
 const expected=crypto.createHmac('sha256',k).update(JSON.stringify(manifest)).digest('hex');
 if(typeof signature!=='string'||signature!==expected)throw new Error('Backup manifest signature does not match');
 if(manifest.version!==1||manifest.artifact.name!=='database.dump.gcm'||manifest.artifact.algorithm!=='aes-256-gcm')throw new Error('Unsupported backup manifest');
 const artifact=path.join(directory,manifest.artifact.name);if(await hash(artifact)!==manifest.artifact.sha256)throw new Error('Backup artifact checksum does not match');
 const temp=await fsp.mkdtemp(path.join(require('node:os').tmpdir(),'hms-restore-'));await fsp.chmod(temp,0o700);
 const c=config(true),admin=new Client({...c,database:'postgres',connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});await admin.connect();let created=false,secret:any;const started=Date.now();
 try{
  const plain=path.join(temp,'database.dump');const decipher=crypto.createDecipheriv('aes-256-gcm',k,Buffer.from(manifest.artifact.iv,'hex'));decipher.setAAD(Buffer.from('hms-logical-backup:'+manifest.id));decipher.setAuthTag(Buffer.from(manifest.artifact.tag,'hex'));
  await pipeline(fs.createReadStream(artifact),decipher,fs.createWriteStream(plain,{mode:0o600,flags:'wx'}));
  await admin.query(`CREATE DATABASE "${database}" TEMPLATE template0`);created=true;
  secret=await secretEnv({...c,database},temp);const restore=launch('pg_restore',['--dbname='+database,'--no-owner','--exit-on-error',plain],secret.env);restore.child.stdin.end();restore.child.stdout.resume();
  try{await restore.done;}catch(e){await fsp.writeFile(path.join(directory,'restore-diagnostic.txt'),restore.diagnostic(),{mode:0o600});throw e;}
  const client=new Client({...c,database,connectionTimeoutMillis:5000,query_timeout:30000,statement_timeout:30000});await client.connect();let actual:any,checks:any;
  try{actual=await V.inventory(client);checks=await V.invariants(client);}finally{await client.end();}
  const problems=[];if(V.digest(actual)!==V.digest(manifest.snapshot))problems.push('Snapshot counts, migration checksums or extensions differ');
  if(Object.values(checks).some(n=>n!==0))problems.push('Restored invariants failed');
  const result={kind:'LOGICAL_RESTORE',status:problems.length?'FAILED':'VERIFIED_DATABASE',backup_id:manifest.id,source_candidate:manifest.candidate,
   measured_restore_seconds:(Date.now()-started)/1000,checks,snapshot_matches:!problems.includes('Snapshot counts, migration checksums or extensions differ'),external_effects:'DISABLED_NO_APPLICATION_STARTED',
   document_versions:'NOT_CLAIMED_DATABASE_ONLY',problems,verified_at:new Date().toISOString()};
  await fsp.writeFile(path.join(directory,'database-verification.json'),JSON.stringify(result,null,2)+'\n',{mode:0o600});if(problems.length)throw new Error(problems.join('; '));return result;
 }finally{if(created)await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`).catch(()=>{});await admin.end();await fsp.rm(temp,{recursive:true,force:true});}
}
async function main(){const [mode,dir,db]=process.argv.slice(2);if(!dir||!['backup','verify'].includes(mode))throw new Error('Usage: clinical-backup.cts backup <new-directory> | verify <directory> <hms_verify_final_database>');console.log(JSON.stringify(mode==='backup'?await backup(path.resolve(dir)):await verify(path.resolve(dir),db)));}
if(require.main===module)main().catch((e:Error)=>{console.error(e.message);process.exitCode=1;});
module.exports={backup,verify};
