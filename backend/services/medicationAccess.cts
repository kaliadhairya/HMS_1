import type {Transaction} from 'sequelize';
const F=require('./facilities.cts'),{storage}=require('../utils/auditContext'),{patientInCare}=require('../utils/careTeam');
type Actor={id:number;role:string;facilityId?:string};
type Action='PRESCRIBE'|'DISPENSE'|'NURSING_DOCUMENT'|'CLINICAL_SIGN'|'CHART_READ';
function fail(message:string,code:string):never{throw Object.assign(new Error(message),{status:403,code});}
function facility():string{const value=storage.getStore()?.facilityId;if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value))fail('A verified facility context is required.','FACILITY_CONTEXT_REQUIRED');return value;}
async function authorize(actor:Actor,action:Action,t?:Transaction,patient?:number){
 const ctx=storage.getStore();if(!ctx||Number(ctx.userId)!==actor.id||facility()!==actor.facilityId)fail('The clinical actor does not match the current request.','CLINICAL_ACTOR_MISMATCH');
 const allowed:Record<Action,string[]>={PRESCRIBE:['doctor'],DISPENSE:['pharmacist'],NURSING_DOCUMENT:['nurse'],CLINICAL_SIGN:['doctor'],CHART_READ:['doctor','nurse','pharmacist']};
 if(!allowed[action].includes(actor.role))fail('The active professional role cannot perform this action.','CLINICAL_ROLE_REQUIRED');
 await F.requirePrivilege(actor,'CHART_READ',t);if(action!=='CHART_READ')await F.requirePrivilege(actor,action,t);
 if(patient&&actor.role==='doctor'&&!(await patientInCare(actor.id,patient,t)))fail('The patient is not in your current care.','PATIENT_NOT_IN_CARE');
}
module.exports={authorize,facility};
