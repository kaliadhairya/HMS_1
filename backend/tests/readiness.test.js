const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const R=require('../../scripts/phase7/readiness'),C=require('../../scripts/phase7/catalogue');
const now=new Date('2026-10-17T12:00:00Z');
function fixture(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hms-readiness-')),record=R.template(),body=Buffer.from('Synthetic checker fixture only; not hospital evidence.');
 fs.writeFileSync(path.join(directory,'evidence.txt'),body);
 Object.assign(record.context,{release_commit:'a'.repeat(40),environment:'synthetic-checker',site:'synthetic-site',scope_id:'synthetic-scope'});
 for(const key of Object.keys(C.owners))record.owner_names[key]='Synthetic '+key+' reviewer';
 for(const gate of C.gates)for(const stage of gate.stages)for(const kind of gate.kinds)record.gates[gate.id].evidence.push({id:`${gate.id}-${stage}-${kind}`,kind,outcome:'PASS',stage,observed_at:'2026-10-17T09:00:00Z',reviewed_at:'2026-10-17T10:00:00Z',expires_at:'2026-10-18T10:00:00Z',reviewed_by:record.owner_names[gate.owner],decision_ref:'SYNTHETIC-CHECKER-FIXTURE',context:{...record.context},artifact:{path:'evidence.txt',sha256:R.sha(body)},supersedes:[]});
 for(const hazard of C.hazards)record.hazards[hazard.id]={state:'CLOSED',evidence_ids:hazard.gates.flatMap(id=>record.gates[id].evidence.filter(e=>e.kind==='OWNER_REVIEW').map(e=>e.id))};
 return {record,directory,cleanup:()=>fs.rmSync(directory,{recursive:true,force:true})};
}
test('unfilled assessments remain blocked and no successful checker authorizes clinical care',()=>{
 const f=fixture();try{assert.equal(R.evaluate(R.template(),'OPD',f.directory,now).status,'BLOCKED');for(const stage of C.stages){const result=R.evaluate(f.record,stage,f.directory,now);assert.equal(result.status,'REVIEW_REQUIRED',JSON.stringify(result.blockers));assert.equal(result.authorization,false);}}finally{f.cleanup();}
});
test('malformed section and supersession shapes return INVALID rather than crashing',()=>{
 const f=fixture();try{
  for(const field of ['context','owner_names','gates','hazards']){const record=structuredClone(f.record);record[field]=[];assert.equal(R.evaluate(record,'OPD',f.directory,now).status,'INVALID');}
  f.record.gates.G01.evidence[0].supersedes={id:'malformed'};assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'INVALID');
 }finally{f.cleanup();}
});
test('stale, wrong-release, unreviewed, missing, tampered and escaped evidence cannot close gates',()=>{
 for(const change of [
  e=>{e.expires_at='2026-10-17T11:00:00Z';},e=>{e.context.release_commit='b'.repeat(40);},e=>{e.reviewed_by='Another person';},e=>{e.artifact.path='missing.txt';},e=>{e.artifact.sha256='0'.repeat(64);},e=>{e.artifact.path='../evidence.txt';},e=>{e.observed_at='2026-10-18T09:00:00Z';},
 ]){const f=fixture();try{for(const e of f.record.gates.G01.evidence)change(e);assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'BLOCKED');}finally{f.cleanup();}}
});
test('a symlink outside the evidence directory and absolute artifacts fail closed',()=>{
 const f=fixture(),outside=fs.mkdtempSync(path.join(os.tmpdir(),'hms-other-evidence-'));try{
  const file=path.join(outside,'copied.txt');fs.copyFileSync(path.join(f.directory,'evidence.txt'),file);fs.symlinkSync(file,path.join(f.directory,'linked.txt'));
  for(const artifactPath of ['linked.txt',file]){for(const e of f.record.gates.G01.evidence)e.artifact.path=artifactPath;assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'BLOCKED');}
 }finally{f.cleanup();fs.rmSync(outside,{recursive:true,force:true});}
});
test('FAIL remains blocking until a newer valid same-scope reviewed result explicitly supersedes it',()=>{
 const f=fixture();try{
  const pass=f.record.gates.G01.evidence.find(e=>e.stage==='OPD'&&e.kind==='CLINICAL_POLICY'),failed=structuredClone(pass);failed.id='prior-failure';failed.outcome='FAIL';failed.observed_at='2026-10-17T08:00:00Z';f.record.gates.G01.evidence.push(failed);
  assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'BLOCKED');pass.supersedes=[failed.id];pass.supersession_reason='Synthetic verified correction for checker test';assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'REVIEW_REQUIRED');
  pass.expires_at='2026-10-17T11:00:00Z';assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'BLOCKED');
 }finally{f.cleanup();}
});
test('hazard closure requires accepted linked owner review, and every catalogue artifact exists',()=>{
 const f=fixture();try{
  f.record.hazards.H01.evidence_ids=[];assert.equal(R.evaluate(f.record,'OPD',f.directory,now).status,'BLOCKED');
  for(const hazard of C.hazards){assert(hazard.gates.length);assert(C.owners[hazard.owner]);}
  const root=path.resolve(__dirname,'../..');for(const gate of C.gates){
   for(const file of gate.tests)assert(fs.existsSync(path.join(root,file)),`${gate.id}: ${file}`);
   const [file,anchor]=gate.procedure.split('#'),target=path.join(root,file);assert(fs.existsSync(target),`${gate.id}: missing procedure`);
   if(anchor){const headings=[...fs.readFileSync(target,'utf8').matchAll(/^#{1,6}\s+(.+)$/gm)].map(m=>m[1].toLowerCase().replace(/[^a-z0-9 -]/g,'').replace(/\s+/g,'-'));assert(headings.includes(anchor),`${gate.id}: missing procedure anchor ${anchor}`);}
  }
 }finally{f.cleanup();}
});
