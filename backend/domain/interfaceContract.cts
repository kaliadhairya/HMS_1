type Json = null | boolean | number | string | Json[] | {[key: string]: Json};
type Input = {system:string;type:string;version:string|number;externalId?:string;correlationId?:string|null;endpoint?:string|null;payload?:Json;patientId?:number|null;maxAttempts?:number;sentByCaller?:boolean;raw?:string};
type Contract = {ownerRole:string;versions:readonly string[];messageTypes:readonly string[];idempotency:'PROVIDER_KEY'|'RECONCILE'};
function fail(message:string):never {throw Object.assign(new Error(message),{status:422,code:'INVALID_INTERFACE_CONTRACT'});}
function validate(input:Input):void {
 if(!input||!/^[a-z][a-z0-9:._-]{1,80}$/.test(input.system)||typeof input.type!=='string'||!input.type.trim()||input.type.length>120||!['string','number'].includes(typeof input.version)||!String(input.version).trim()||String(input.version).length>80)fail('A known system, message type and contract version are required.');
 if(input.externalId!==undefined&&(typeof input.externalId!=='string'||!input.externalId.trim()||input.externalId.length>200))fail('The external message identity is invalid.');
 if(input.patientId!=null&&(!Number.isSafeInteger(input.patientId)||input.patientId<1))fail('The patient identity must be explicit.');
 if(input.maxAttempts!==undefined&&(!Number.isSafeInteger(input.maxAttempts)||input.maxAttempts<1||input.maxAttempts>20))fail('The retry budget must be 1–20 attempts.');
 if(input.endpoint!=null&&(typeof input.endpoint!=='string'||input.endpoint.length>2000))fail('The endpoint is invalid.');
 if(Buffer.byteLength(JSON.stringify(input.payload??null))>2*1024*1024||Buffer.byteLength(input.raw||'')>2*1024*1024)fail('The message exceeds its declared size limit.');
}
function supports(contract:Contract|undefined,type:string,version:string):boolean {
 return !!contract&&contract.versions.includes(version)&&contract.messageTypes.includes(type);
}
module.exports={validate,supports};
