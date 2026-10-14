const test=require('node:test'),assert=require('node:assert/strict');
const {recoveryProblems}=require('../domain/recoveryEvidence.cts');
const valid={rpoSeconds:0.2,rtoSeconds:5,rpoTargetSeconds:300,rtoTargetSeconds:3600,auditProblems:0,unbalancedEntries:0,stockProblems:0,clinicalProblems:0,schemaMatches:true,artifactVerified:true};
test('recovery accepts measured durations and complete clean invariants',()=>assert.deepEqual(recoveryProblems(valid),[]));
test('unknown RPO, unavailable journal and invalid numeric measurements fail closed',()=>{
 for(const rpo of [null,undefined,'0',NaN,-1,Infinity])assert(recoveryProblems({...valid,rpoSeconds:rpo}).some(p=>p.startsWith('RPO')));
 for(const journal of ['n/a',null,undefined,1])assert(recoveryProblems({...valid,unbalancedEntries:journal}).some(p=>p.startsWith('Journal')));
});
test('exceeded recovery targets, failed invariants or unverified artifacts cannot pass',()=>{
 for(const change of [{rpoSeconds:301},{rtoSeconds:3601},{stockProblems:1},{clinicalProblems:1},{schemaMatches:false},{artifactVerified:false}])assert(recoveryProblems({...valid,...change}).length);
});
