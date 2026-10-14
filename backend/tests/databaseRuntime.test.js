const test=require('node:test'),assert=require('node:assert/strict');
const {problems}=require('../services/databaseRuntime.cts');
const safe={superuser:false,bypassRls:false,canAssumeOwner:false,ownsClinicalTables:false,missingPolicies:false,canCreateSchemas:false};
test('production database identity rejects every privilege that bypasses facility isolation',()=>{
 assert.deepEqual(problems(safe),[]);
 for(const key of Object.keys(safe))assert(problems({...safe,[key]:true}).length>0,key);
});
