const test=require('node:test'),assert=require('node:assert/strict');
const {orderMigrations}=require('../utils/migrationOrder');
const migrations=['0100','0137','0138','0145','0150','0156'].map(version=>({version,checksum:'hash-'+version}));
test('cross-range prerequisites retain original ready order and never omit migrations',()=>{
 const rules={'0137':{after:['0156'],checksum:'hash-0137'},'0138':{after:['0137'],checksum:'hash-0138'}};
 assert.deepEqual(orderMigrations(migrations,rules).map(m=>m.version),['0100','0145','0150','0156','0137','0138']);
 assert.deepEqual(orderMigrations(migrations,{}),migrations);
});
test('unknown prerequisites, altered pins and cycles fail closed',()=>{
 for(const rule of [
  {'0137':{after:['missing'],checksum:'hash-0137'}},
  {'0137':{after:['0156'],checksum:'changed'}},
  {'0137':{after:['0138'],checksum:'hash-0137'},'0138':{after:['0137'],checksum:'hash-0138'}},
 ])assert.throws(()=>orderMigrations(migrations,rule));
});
