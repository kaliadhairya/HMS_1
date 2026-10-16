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
const env={...process.env,HOST:'127.0.0.1',PORT:String(apiPort),HMS_PROCESS_ROLE:'api',INTERFACE_WORKER:'off',DEVICE_MLLP:suites.includes('devices')?'on':'off',DOWNTIME_KIT:'off',E2E_API:`http://127.0.0.1:${apiPort}/api`,E2E_BASE:`http://127.0.0.1:${vitePort}`,VITE_BACKEND_TARGET:`http://127.0.0.1:${apiPort}`,CLAMAV_HOST:'127.0.0.1',CLAMAV_PORT:String(scanPort)};
const children=new Set();
function start(name,command,argv,cwd){
 const log=fs.openSync(path.join(state,name+'.log'),'w',0o600),child=spawn(command,argv,{cwd,env,stdio:['ignore',log,log]});fs.closeSync(log);children.add(child);child.once('exit',()=>children.delete(child));return child;
}
const stop=async()=>{for(const child of children)child.kill('SIGTERM');await Promise.all([...children].map(child=>new Promise(r=>{child.once('exit',r);setTimeout(()=>{child.kill('SIGKILL');r();},3000).unref();})));};
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop().finally(()=>process.exit(130)));
async function ready(url,child){for(let i=0;i<150;i++){if(child.exitCode!==null)throw new Error('A private verification service stopped; see its protected log.');try{if((await fetch(url,{signal:AbortSignal.timeout(500)})).ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw new Error('Private service readiness was not demonstrated: '+url);}
(async()=>{
 const results=[],candidate=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),diff=execFileSync('git',['diff','HEAD','--binary'],{cwd:root,maxBuffer:32*1024*1024});
 try{
  const api=start('api',process.execPath,['server.js'],path.join(root,'backend'));
  start('scanner-protocol-fixture',process.execPath,['e2e/fixtures/clamavFixture.js'],root);
  const vite=start('frontend',process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port',String(vitePort),'--strictPort'],path.join(root,'frontend'));
  await ready(env.E2E_API+'/ready',api);await ready(env.E2E_BASE,vite);
  for(const suite of suites){
   console.log('Running '+suite);const began=Date.now(),log=fs.openSync(path.join(state,suite+'.log'),'w',0o600);
   const child=spawn(process.execPath,[suite+'.e2e.js'],{cwd:path.join(root,'e2e'),env,stdio:['ignore','pipe','pipe']});children.add(child);
   for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{fs.writeSync(log,data);process.stdout.write(data);});
   const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});children.delete(child);fs.closeSync(log);results.push({suite,exit_code:code,seconds:(Date.now()-began)/1000});
  }
 }finally{
  await stop();fs.writeFileSync(path.join(state,'result.json'),JSON.stringify({candidate,tracked_diff_sha256:crypto.createHash('sha256').update(diff).digest('hex'),untracked_files:execFileSync('git',['ls-files','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),database:process.env.DB_NAME,api_port:apiPort,frontend_port:vitePort,scanner:'SYNTHETIC_PROTOCOL_FIXTURE_ONLY',results},null,2)+'\n',{mode:0o600});console.log('Verification evidence: '+state);
 }
 process.exitCode=results.length!==suites.length||results.some(r=>r.exit_code!==0)?1:0;
})().catch(error=>{console.error(error.message);process.exitCode=1;});
