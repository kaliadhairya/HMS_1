// A protocol fixture, never antivirus protection or a clinical approval.
// The executable is restricted to local disposable verification environments.
const net=require('node:net');
if(!/^(hms_p\d+_|hms_verify|hms_test|hms_e2e)/.test(process.env.DB_NAME||''))throw new Error('Use a disposable database configuration for the scanner protocol fixture.');
const port=Number(process.env.CLAMAV_PORT||13364);
const server=net.createServer(socket=>{
 let data=Buffer.alloc(0),finished=false;
 socket.setTimeout(5000,()=>socket.destroy());
 socket.on('error',()=>{});
 socket.on('data',chunk=>{
  if(finished)return;data=Buffer.concat([data,chunk]);if(data.length>25*1024*1024)return socket.destroy();
  if(data.length<10)return;if(data.subarray(0,10).toString()!=='zINSTREAM\0')return socket.destroy();
  let pos=10;const parts=[];
  while(pos+4<=data.length){const n=data.readUInt32BE(pos);pos+=4;if(n===0){finished=true;const unsafe=Buffer.concat(parts).includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE'));socket.end(unsafe?'stream: Synthetic.EICAR FOUND\0':'stream: OK\0');return;}if(pos+n>data.length)return;parts.push(data.subarray(pos,pos+n));pos+=n;}
 });
});
server.listen(port,'127.0.0.1',()=>console.log('Synthetic antivirus protocol fixture listening on loopback '+port));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit()));
