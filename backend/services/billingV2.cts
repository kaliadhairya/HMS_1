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

module.exports={startPayment};
