const test = require('node:test');
const assert = require('node:assert/strict');
const load = () => import('../../frontend/src/utils/eventReplay.mjs');
test('live notifications cannot skip a paginated missing range and duplicates are suppressed', async () => {
 const {createEventReplay}=await load(); const delivered=[]; let calls=0;
 const replay=createEventReplay(async(cursor)=>{
  calls++;
  if(cursor===null)return {latest_sequence:0};
  if(cursor===0)return {data:[1,2].map(i=>({type:'test',data:{event_id:i,delivery_sequence:i}})),next_sequence:2,has_more:true};
  return {data:[{type:'test',data:{event_id:3,delivery_sequence:3}}],next_sequence:3,has_more:false};
 },(_type,data)=>delivered.push(data.event_id));
 await replay.catchUp();
 assert.equal(replay.accept({event_id:3,delivery_sequence:3}),true);delivered.push(3);
 assert.equal(replay.accept({event_id:3,delivery_sequence:3}),false);
 await replay.catchUp();assert.deepEqual(delivered,[3,1,2]);assert.equal(calls,3);
 assert.equal(replay.accept({event_id:1,delivery_sequence:1}),false);
});
test('an in-flight catch-up cannot deliver after logout',async()=>{
 const {createEventReplay}=await load();let resolve;const delivered=[];
 const replay=createEventReplay(async(cursor)=>cursor===null?{latest_sequence:0}:new Promise(r=>resolve=r),(_,data)=>delivered.push(data));
 await replay.catchUp();const pending=replay.catchUp();replay.stop();resolve({data:[{type:'test',data:{event_id:1,delivery_sequence:1}}],next_sequence:1,has_more:false});await pending;assert.equal(delivered.length,0);
});
