const test=require('node:test'),assert=require('node:assert/strict');
const {requestHash}=require('../utils/idempotency');
const a='b5f90d98-18e4-4e89-9052-2f8458e4fc90',b='25e18cf6-3b7c-4f46-8b08-760cd28092a1';
const request=(facilityId=a,revision='1',body={a:1,b:2})=>({method:'POST',originalUrl:'/api/facilities/professional-roles/x/revoke',user:{facilityId},headers:{'if-match':revision},body});
test('receipt identity binds the verified facility and exact reviewed revision',()=>{
 const original=requestHash(request());
 assert.notEqual(original,requestHash(request(b)));
 assert.notEqual(original,requestHash(request(a,'2')));
 const missing=request();delete missing.headers['if-match'];assert.notEqual(original,requestHash(missing));
 assert.equal(original,requestHash(request(a,'1',{b:2,a:1})));
});
test('legacy hashes remain interpretable without inventing old scope or revision evidence',()=>{
 assert.equal(requestHash(request(a,'1'),1),requestHash(request(b,'2'),1));
 assert.notEqual(requestHash(request(a,'1'),1),requestHash(request(a,'1'),2));
});
