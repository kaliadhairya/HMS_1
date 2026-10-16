// Own the complete disposable runtime in one process: explicit frontend proxy,
// private API and synthetic scanner protocol fixture, all stopped on completion.
// Load protected configuration with node --env-file, never print its contents.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn,execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),state=path.join(process.env.HMS_VERIFICATION_STATE||path.join(require('node:os').homedir(),'.local/state/hms-clinical-final'),'runs',new Date().toISOString().replace(/[:.]/g,'-'));
if(!/^(hms_p4_final_|hms_verify_final_)/.test(process.env.DB_NAME||'')||/claude/.test(process.env.DB_NAME))throw new Error('Use an owned disposable clinical-final database.');
const args=process.argv.slice(2),index=args.indexOf('--suites');
const suites=index<0?[]:args[index+1].split(',');if(!suites.length||suites.some(s=>!/^[A-Za-z0-9]+$/.test(s)||!fs.existsSync(path.join(root,'e2e',s+'.e2e.js'))))throw new Error('Supply existing --suites names separated by commas.');
const apiPort=Number(process.env.PORT||5064),vitePort=Number(process.env.HMS_VERIFY_VITE_PORT||5236),scanPort=Number(process.env.CLAMAV_PORT||13364);
if(apiPort===5001||vitePort===4999)throw new Error('Shared application ports are prohibited.');
fs.mkdirSync(state,{recursive:true,mode:0o700});
const env={...process.env,HOST:'127.0.0.1',PORT:String(apiPort),HMS_PROCESS_ROLE:'api',INTERFACE_WORKER:'off',DEVICE_MLLP:suites.includes('devices')?'on':'off',DOWNTIME_KIT:'off',HMS_EXTERNAL_EFFECTS:'blocked',E2E_API:`http://127.0.0.1:${apiPort}/api`,E2E_BASE:`http://127.0.0.1:${vitePort}`,VITE_BACKEND_TARGET:`http://127.0.0.1:${apiPort}`,CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:String(scanPort)};
const mockGateway=suites.some(s=>['abdm','abdmUse'].includes(s));
const children=new Set();
function start(name,command,argv,cwd,extra={}){
 const args=mockGateway&&command===process.execPath?['--require',path.join(root,'e2e/fixtures/verificationNetwork.cjs'),...argv]:argv;
 const log=fs.openSync(path.join(state,name+'.log'),'w',0o600),child=spawn(command,args,{cwd,env:{...env,...extra},stdio:['ignore',log,log]});fs.closeSync(log);children.add(child);child.once('exit',()=>children.delete(child));return child;
}
const stop=async()=>{for(const child of children)child.kill('SIGTERM');await Promise.all([...children].map(child=>new Promise(r=>{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();})));};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop().finally(()=>process.exit(130)));
async function ready(url,child){for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('A private verification service stopped; see its protected log.');try{if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Private service readiness was not demonstrated: '+url);}
(async()=>{
 const results=[],candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),diff=execFileSync('git',['diff','HEAD','--binary'],{cwd:root,maxBuffer:32*1024*1024});
 try{
  if(mockGateway){
   const {Client}=require(path.join(root,'backend/node_modules/pg')),db=new Client({host:env.DB_HOST,port:Number(env.DB_PORT),user:env.DB_USER,password:env.DB_PASSWORD,database:env.DB_NAME});
   let binding;try{await db.connect();binding=(await db.query("SELECT u.id,hms_initial_facility() facility_id FROM hms_users u JOIN hms_facility_memberships m ON m.user_id=u.id AND m.facility_id=hms_initial_facility() WHERE u.username='admin' AND u.is_active=1 AND m.revoked_at IS NULL AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()) LIMIT 1")).rows[0];}finally{await db.end();}
   if(!binding)throw new Error('The synthetic gateway harness needs the existing test administrator membership.');
   const mockPort=19364,mockUrl=`http://127.0.0.1:${mockPort}`;
   Object.assign(env,{HMS_VERIFY_MOCK_GATEWAY:'true',HMS_VERIFY_HTTP_PORTS:[apiPort,vitePort,mockPort].join(','),HMS_EXTERNAL_EFFECTS:'enabled',HMS_ABDM_IDEMPOTENCY_SUPPORTED:'true',HMS_ABDM_SERVICE_USER_ID:String(binding.id),HMS_ABDM_FACILITY_ID:binding.facility_id,HMS_WORKER_USER_ID:String(binding.id),ABDM_MOCK_URL:mockUrl,ABDM_GATEWAY_URL:mockUrl,ABDM_ABHA_URL:mockUrl,ABDM_GATEWAY_JWKS_URL:mockUrl+'/certs',ABDM_BRIDGE_PUBLIC_URL:`http://127.0.0.1:${apiPort}/abdm`,ABDM_CLIENT_ID:'synthetic-closeout',ABDM_CLIENT_SECRET:crypto.randomBytes(32).toString('hex'),ABDM_CM_ID:'sbx',ABDM_HIP_ID:'HMS-HIP',ABDM_HIU_ID:'HMS-HIU',ABDM_WORKER:'off'});
   const mock=start('abdm-mock',process.execPath,['scripts/abdm-mock-gateway.js'],path.join(root,'backend'),{PORT:String(mockPort)});await ready(mockUrl+'/certs',mock);
  }
  const api=start('api',process.execPath,['server.js'],path.join(root,'backend'));
  start('scanner-protocol-fixture',process.execPath,['e2e/fixtures/clamavFixture.js'],root);
  const vite=start('frontend',process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(vitePort),'--strictPort'],path.join(root,'frontend'));
  await ready(env.E2E_API+'/ready',api);await ready(env.E2E_BASE,vite);
  if(mockGateway)start('synthetic-interface-worker',process.execPath,['e2e/fixtures/interfaceWorker.cjs'],root,{INTERFACE_WORKER:'on',INTERFACE_POLL_MS:'150'});
  for(const suite of suites){
   console.log('Running '+suite);const began=Date.now(),log=fs.openSync(path.join(state,suite+'.log'),'w',0o600);
   const argv=mockGateway?['--require',path.join(root,'e2e/fixtures/verificationNetwork.cjs'),suite+'.e2e.js']:[suite+'.e2e.js'];
   const child=spawn(process.execPath,argv,{cwd:path.join(root,'e2e'),env,stdio:['ignore','pipe','pipe']});children.add(child);
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{fs.writeSync(log,data);process.stdout.write(data);});
   const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});children.delete(child);fs.closeSync(log);results.push({suite,exit_code:code,seconds:(Date.now()-began)/1000});
  }
 }finally{
  await stop();const untracked=execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean).map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));fs.writeFileSync(path.join(state,'result.json'),JSON.stringify({candidate,tracked_diff_sha256:crypto.createHash('sha256').update(diff).digest('hex'),untracked_files:untracked,database:process.env.DB_NAME,api_port:apiPort,frontend_port:vitePort,scanner:'SYNTHETIC_PROTOCOL_FIXTURE_ONLY',gateway:mockGateway?'SYNTHETIC_LOOPBACK_ONLY':'DISABLED',results},null,2)+'\n',{mode:0o600});console.log('Verification evidence: '+state);
 }
 process.exitCode=results.length!==suites.length||results.some(r=>r.exit_code!==0)?1:0;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
