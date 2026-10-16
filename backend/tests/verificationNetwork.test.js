const test=require('node:test'),assert=require('node:assert/strict');
const {assertTarget,install}=require('../../e2e/fixtures/verificationNetwork.cjs');
test('synthetic delivery rejects external, alternate-port, credential and redirect targets',async()=>{
 const ports=new Set([19364]);
 for(const input of ['https://127.0.0.1:19364','http://127.0.0.1:9320','http://127.0.0.1:5001','http://example.com:19364','http://user:password@127.0.0.1:19364'])assert.throws(()=>assertTarget(input,ports),e=>e.code==='VERIFICATION_EGRESS_DENIED');
 assert.doesNotThrow(()=>assertTarget('http://127.0.0.1:19364/mock',ports));
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async(input,options)=>{calls++;assert.equal(options.redirect,'error');return {ok:true};};
 const restore=install(ports);
 try{assert.throws(()=>fetch('https://example.com/clinical'),e=>e.code==='VERIFICATION_EGRESS_DENIED');assert.equal(calls,0);await fetch('http://127.0.0.1:19364/mock',{redirect:'follow'});assert.equal(calls,1);}finally{restore();globalThis.fetch=original;}
});
