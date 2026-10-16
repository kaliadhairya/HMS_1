// Only an explicit successful scanner response releases an uploaded document.
const net=require('node:net');
type Scan={engine:string;result:'clean'|'rejected'|'unavailable';detail:string;at:string};
function scan(bytes:Buffer):Promise<Scan>{
 const at=new Date().toISOString(),host=process.env.CLAMAV_HOST;
 if(!host)return Promise.resolve({engine:'clamav',result:'unavailable',detail:'Antivirus scanning is not configured. The document remains quarantined.',at});
 return new Promise(resolve=>{
  const socket=net.connect({host,port:Number(process.env.CLAMAV_PORT||3310)});let answer='',finished=false;
  const finish=(result:Scan['result'],detail:string)=>{if(finished)return;finished=true;socket.destroy();resolve({engine:'clamav',result,detail,at});};
  socket.setTimeout(Math.min(15000,Math.max(100,Number(process.env.CLAMAV_TIMEOUT_MS)||15000)),()=>finish('unavailable','The antivirus scan timed out.'));
  socket.on('error',()=>finish('unavailable','The antivirus scanner could not be reached.'));
  socket.on('close',()=>{if(!finished)finish('unavailable','The antivirus scanner closed without a complete result.');});
  socket.on('connect',()=>{
   socket.write('zINSTREAM\0');
   for(let i=0;i<bytes.length;i+=65536){const chunk=bytes.subarray(i,i+65536),size=Buffer.alloc(4);size.writeUInt32BE(chunk.length);socket.write(size);socket.write(chunk);}
   socket.write(Buffer.alloc(4));
  });
  socket.on('data',(b:Buffer)=>{answer+=b.toString('utf8');if(answer.length>4096)return finish('unavailable','The antivirus scanner returned an invalid response.');
   if(answer.includes('\0')||answer.includes('\n')){const response=answer.replace(/[\0\r\n]/g,'').trim();if(/^stream: OK$/.test(response))finish('clean','Antivirus scan completed successfully.');else if(/^stream: .+ FOUND$/.test(response))finish('rejected','The antivirus scanner detected unsafe content.');else finish('unavailable','The antivirus scanner could not confirm the file.');}
  });
 });
}
module.exports={scan};
