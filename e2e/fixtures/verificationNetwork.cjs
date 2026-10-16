// Only the harness's explicitly selected loopback HTTP services are reachable
// through fetch. This protects a restored test database with old delivery URLs.
function assertTarget(input,ports){
 const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
 const port=Number(url.port||(url.protocol==='https:'?443:80));
 if(url.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||url.username||url.password||!ports.has(port))throw Object.assign(new Error('Synthetic verification refuses a non-approved delivery target.'),{code:'VERIFICATION_EGRESS_DENIED',beforeSend:true,permanent:true});
}
function install(ports){const original=globalThis.fetch;globalThis.fetch=(input,options)=>{assertTarget(input,ports);return original(input,{...options,redirect:'error'});};return()=>{globalThis.fetch=original;};}
if(process.env.HMS_VERIFY_MOCK_GATEWAY==='true'){
 if(!/^(hms_p4_final_|hms_verify_final_)/.test(process.env.DB_NAME||''))throw new Error('Synthetic network policy requires an owned disposable database.');
 const ports=new Set(String(process.env.HMS_VERIFY_HTTP_PORTS||'').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0&&n<=65535));
 if(!ports.size)throw new Error('Synthetic network policy requires explicit ports.');
 install(ports);
}
module.exports={assertTarget,install};
