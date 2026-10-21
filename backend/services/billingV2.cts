// Payments through the v2 API (completion A3). Invoices and billing accounts are already named
// by their public UUIDs; a patient is named by public identifier for deposits. The payment
// command (balance and overpayment checks, provider references, receipts, cash sessions) is the
// same one the legacy route calls. Retried requests use the command's idempotency key.
const I=require('./identities.cts');
const B=require('./billing');
type Actor={id:number;role:string;facilityId?:string;ip?:string};
const DESK=['super_admin','admin','receptionist'];
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}

async function startPayment(body:any,actor:Actor,t:any){
 if(!DESK.includes(actor.role))fail(403,'Your role cannot take payments.','ROLE_NOT_PERMITTED');
 if(!body)fail(422,'A payment needs an amount and a method.','VALIDATION_FAILED');
 if(!body.invoice_id&&!body.account_id&&!body.patient_id)fail(422,'Name an invoice, an account or a patient.','VALIDATION_FAILED');
 let patientId:number|undefined;
 if(body.patient_id){patientId=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));}
 const result=await B.startPayment({
  method:body.method,amount:body.amount,outcome:body.outcome,providerReference:body.provider_reference,
  invoiceId:body.invoice_id,accountId:body.account_id,patientId,
 },actor,t);
 const intent=result.intent??result;
 const receipt=result.receipt??null;
 return {
  id:intent.id,
  purpose:intent.purpose,
  state:intent.state,
  amount:Number(intent.amount),
  method:intent.method,
  invoice_id:intent.invoice_id??null,
  account_id:intent.account_id??null,
  version:Number(intent.api_version??1),
  receipt_number:receipt?.receipt_number??null,
 };
}

// Refunds (A3): request, decide, pay and confirm. Each step calls the legacy command, which
// enforces the separation of duties (the approver is not the requester) and the fund balance.
const ADMIN=['super_admin','admin'];
function refundView(result:any){
 const r=result?.refund??result;
 return {id:r.id,refund_number:r.refund_number,state:r.state,amount:Number(r.amount),method:r.method,version:Number(r.api_version??1)};
}
function requireRole(actor:Actor,roles:string[]){if(!roles.includes(actor.role))fail(403,'Your role cannot do this step of a refund.','ROLE_NOT_PERMITTED');}

async function requestRefund(body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 if(!body?.fund_id)fail(422,'fund_id is required.','VALIDATION_FAILED');
 const result=await B.requestRefund({fundId:body.fund_id,amount:body.amount,method:body.method,reason:body.reason},actor,t);
 return refundView(result);
}
async function decideRefund(id:string,approve:boolean,note:any,actor:Actor,t:any){
 requireRole(actor,ADMIN);
 return refundView(await B.decideRefund(id,{approve,note},actor,t));
}
async function payRefund(id:string,body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 return refundView(await B.payRefund(id,body||{},actor,t));
}
async function completeRefund(id:string,outcome:'confirmed'|'failed',body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 const args=outcome==='confirmed'?{outcome,providerReference:body?.provider_reference}:{outcome,reason:body?.reason};
 return refundView(await B.completeRefund(id,args,actor,t));
}

module.exports={startPayment,requestRefund,decideRefund,payRefund,completeRefund};
