// Counts-only validation on the private PITR target. Clinical signature content
// stays inside this process; it never appears in command arguments or reports.
const {execFileSync}=require('node:child_process');
const V=require('../services/recoveryValidation.cts');
async function validate(container:string,user:string,database:string){
 if(!/^hms-clinical-drill-\d+$/.test(container)||!/^\w+$/.test(user)||!/^\w+$/.test(database))throw new Error('Invalid isolated restore binding');
 const client={query:async(sql:string)=>{
  const output=execFileSync('docker',['exec',container,'psql','-h','/drill','-U',user,'-d',database,'-v','ON_ERROR_STOP=1','-Atc',`SELECT coalesce(json_agg(r),'[]'::json) FROM (${sql}) r`],{encoding:'utf8',maxBuffer:32*1024*1024});
  return {rows:JSON.parse(output)};
 }};
 const checks=await V.invariants(client);return {checks,valid:Object.values(checks).every(n=>n===0)};
}
if(require.main===module)validate(...process.argv.slice(2) as [string,string,string]).then(r=>{console.log(JSON.stringify(r));process.exitCode=r.valid?0:1;}).catch((e:Error)=>{console.error(e.message);process.exitCode=1;});
module.exports={validate};
