const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net');
const {scan}=require('../services/documentScan.cts');
test('missing antivirus configuration keeps a document quarantined',async()=>{const old=process.env.CLAMAV_HOST;delete process.env.CLAMAV_HOST;try{assert.equal((await scan(Buffer.from('synthetic'))).result,'unavailable');}finally{if(old!==undefined)process.env.CLAMAV_HOST=old;}});
test('only a complete successful antivirus protocol response releases a document',async()=>{
 let answer='stream: OK\0';const server=net.createServer(socket=>{let data=Buffer.alloc(0);socket.on('data',b=>{data=Buffer.concat([data,b]);if(data.length>=15&&data.subarray(-4).equals(Buffer.alloc(4)))socket.end(answer);});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const before={host:process.env.CLAMAV_HOST,port:process.env.CLAMAV_PORT,timeout:process.env.CLAMAV_TIMEOUT_MS};
 process.env.CLAMAV_HOST='127.0.0.1';process.env.CLAMAV_PORT=String(server.address().port);process.env.CLAMAV_TIMEOUT_MS='200';
 try{assert.equal((await scan(Buffer.from('SYNTHETIC TEST'))).result,'clean');answer='stream: Test.Signature FOUND\0';assert.equal((await scan(Buffer.from('SYNTHETIC TEST'))).result,'rejected');answer='upstream error\0';assert.equal((await scan(Buffer.from('SYNTHETIC TEST'))).result,'unavailable');answer='stream: OK';assert.equal((await scan(Buffer.from('SYNTHETIC TEST'))).result,'unavailable');}
 finally{for(const[k,v]of Object.entries(before)){const name={host:'CLAMAV_HOST',port:'CLAMAV_PORT',timeout:'CLAMAV_TIMEOUT_MS'}[k];if(v===undefined)delete process.env[name];else process.env[name]=v;}await new Promise(r=>server.close(r));}
});
