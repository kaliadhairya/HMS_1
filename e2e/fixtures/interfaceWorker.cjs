// Synthetic integration harness only; never a production worker entrypoint.
const path=require('node:path');
if(!/^(hms_p4_final_|hms_verify_final_)/.test(process.env.DB_NAME||'')||process.env.HMS_VERIFY_MOCK_GATEWAY!=='true')throw new Error('An owned disposable database and explicit mock gateway are required');
const backend=path.resolve(__dirname,'../../backend');
const {sequelize}=require(path.join(backend,'models/db'));
require(path.join(backend,'utils/auditContext')).bindAuditActor(sequelize);
require(path.join(backend,'services/abdm'));
const stop=require(path.join(backend,'services/interfaces')).startInterfaceWorker();
const alive=setInterval(()=>{},3600000);
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;clearInterval(alive);await stop();await sequelize.close();}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>shutdown().catch(()=>{process.exitCode=1;}));
