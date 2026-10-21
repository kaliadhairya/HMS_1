// Payments through the v2 API (completion A3). Invoices and billing accounts are already named
// by their public UUIDs; a patient is named by public identifier for deposits. The payment
// command (balance and overpayment checks, provider references, receipts, cash sessions) is the
// same one the legacy route calls. Retried requests use the command's idempotency key.
const I=require('./identities.cts');
const B=require('./billing');
type Actor={id:number;role:string;facilityId?:string;ip?:string};
const DESK=['super_admin','admin','receptionist'];
function fail(status:number,message:string,code:string):never{throw Object.assign(new Error(message),{status,code});}
// The legacy commands answer a bad field with 400; v2 answers field validation with 422 (blueprint 3.10).
async function domain(work:Promise<any>):Promise<any>{
 try{return await work;}
 catch(e:any){if(e?.status===400)throw Object.assign(e,{status:422,code:e.code||'VALIDATION_FAILED'});throw e;}
}

async function startPayment(body:any,actor:Actor,t:any){
 if(!DESK.includes(actor.role))fail(403,'Your role cannot take payments.','ROLE_NOT_PERMITTED');
 if(!body)fail(422,'A payment needs an amount and a method.','VALIDATION_FAILED');
 if(!body.invoice_id&&!body.account_id&&!body.patient_id)fail(422,'Name an invoice, an account or a patient.','VALIDATION_FAILED');
 let patientId:number|undefined;
 if(body.patient_id){patientId=I.legacyNumber(await I.locate('patient',body.patient_id,actor,t));}
 const result=await domain(B.startPayment({
  method:body.method,amount:body.amount,outcome:body.outcome,providerReference:body.provider_reference,
  invoiceId:body.invoice_id,accountId:body.account_id,patientId,
 },actor,t));
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
 const result=await domain(B.requestRefund({fundId:body.fund_id,amount:body.amount,method:body.method,reason:body.reason},actor,t));
 return refundView(result);
}
async function decideRefund(id:string,approve:boolean,note:any,actor:Actor,t:any){
 requireRole(actor,ADMIN);
 return refundView(await domain(B.decideRefund(id,{approve,note},actor,t)));
}
async function payRefund(id:string,body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 return refundView(await domain(B.payRefund(id,body||{},actor,t)));
}
async function completeRefund(id:string,outcome:'confirmed'|'failed',body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 const args=outcome==='confirmed'?{outcome,providerReference:body?.provider_reference}:{outcome,reason:body?.reason};
 return refundView(await domain(B.completeRefund(id,args,actor,t)));
}


// Billing accounts, charges, invoices, deposit allocations and credit notes (A3). Accounts,
// charges, invoices, deposits and notes are named by their own UUIDs; a patient and a medicine by
// their public identifiers. Each command is the legacy one, so account locks, the price list, the
// journal and the integrity rules in the database are the same for both APIs.
const {sequelize}=require('../models/db');
const {QueryTypes}=require('sequelize');
const WARD=[...DESK,'nurse'];
const rows=(sql:string,replacements:any,t:any):Promise<any[]>=>sequelize.query(sql,{replacements,type:QueryTypes.SELECT,transaction:t});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value:any,name:string):string{if(!UUID.test(String(value??'')))fail(422,`${name} must be an identifier.`,'VALIDATION_FAILED');return String(value);}
const num=(v:any)=>v===null||v===undefined?null:Number(v);

// A nurse works with inpatient accounts only, as on the legacy routes.
async function account(id:string,actor:Actor,t:any,lock=false){
 if(!WARD.includes(actor.role))fail(403,'Your role cannot work with billing accounts.','ROLE_NOT_PERMITTED');
 const [acc]=await rows(`SELECT id,episode_type,status,api_version FROM hms_billing_accounts WHERE id=CAST(:id AS uuid)${lock?' FOR UPDATE':''}`,{id:uuid(id,'The account')},t);
 if(!acc)fail(404,'Billing account not found.','RESOURCE_NOT_FOUND');
 if(actor.role==='nurse'&&acc.episode_type!=='admission')fail(403,'Nurses work with inpatient accounts.','ROLE_NOT_PERMITTED');
 return acc;
}
function chargeView(c:any){
 return {id:c.id,account_id:c.account_id,source_type:c.source_type,category:c.category,code:c.code,description:c.description,
  quantity:String(c.quantity),unit_price:String(c.unit_price),amount:String(c.amount),gst_amount:String(c.gst_amount),
  service_at:c.service_at,reverses_id:c.reverses_id??null,reason:c.reason??null,version:1};
}
async function invoiceView(id:string,t:any){
 const inv=await B.invoiceView(id,t);
 return {id:inv.id,invoice_number:inv.invoice_number,account_id:inv.account_id,status:inv.status,kind:inv.kind,
  subtotal:String(inv.subtotal),gst_amount:String(inv.gst_amount),discount_amount:String(inv.discount_amount),total:String(inv.total),
  payer_amount:String(inv.payer_amount),patient_amount:String(inv.patient_amount),patient_due:String(inv.patient_due),
  revision:Number(inv.revision),version:Number(inv.api_version),
  lines:inv.lines.map((l:any)=>({id:l.id,line_no:l.line_no,charge_id:l.charge_event_id,category:l.category,code:l.code,description:l.description,amount:String(l.amount),gst_amount:String(l.gst_amount)}))};
}

async function readAccount(id:string,actor:Actor,t:any){
 await account(id,actor,t);
 const a=await B.accountView(id,t);
 const [p]=await rows('SELECT public_id FROM hms_patients WHERE id=:id',{id:a.patient_id},t);
 const draft=a.invoices.find((i:any)=>i.status==='Draft');
 return {id:a.id,account_number:a.account_number,status:a.status,episode_type:a.episode_type,patient_id:p.public_id,version:Number(a.api_version),
  charges:a.charges.map((c:any)=>({...chargeView(c),reversed:c.reversed===true,invoice_number:c.invoice_number??null})),
  draft_invoice:draft?{id:draft.id,version:Number(draft.api_version),revision:Number(draft.revision),total:String(draft.total)}:null,
  invoices:a.invoices.filter((i:any)=>i.status!=='Draft').map((i:any)=>({id:i.id,invoice_number:i.invoice_number,status:i.status,total:String(i.total),patient_due:String(i.patient_due),version:Number(i.api_version)})),
  funds:a.funds.map((f:any)=>({id:f.id,kind:f.kind,amount:String(f.amount),balance:String(f.balance),version:Number(f.api_version)})),
  totals:a.totals};
}

async function addCharge(id:string,body:any,actor:Actor,t:any){
 await account(id,actor,t);
 if(!body||(!body.code&&!body.medicine_id&&!body.category))fail(422,'Name a price-list code, a medicine, or a hand-priced category.','VALIDATION_FAILED');
 let medicineId:number|undefined;
 if(body.medicine_id)medicineId=I.legacyNumber(await I.locate('medicine_legacy',body.medicine_id,actor,t));
 const c=await domain(B.addCharge(id,{code:body.code,medicineId,category:body.category,description:body.description,
  unitPrice:num(body.unit_price),gstRate:num(body.gst_rate),quantity:body.quantity,reason:body.reason},actor,t));
 return chargeView(c);
}

async function reverseCharge(id:string,body:any,actor:Actor,t:any){
 const [c]=await rows('SELECT account_id FROM hms_charge_events WHERE id=CAST(:id AS uuid)',{id:uuid(id,'The charge')},t);
 if(!c)fail(404,'Charge not found.','RESOURCE_NOT_FOUND');
 await account(c.account_id,actor,t);
 return chargeView(await domain(B.reverseCharge(id,body?.reason,actor,t)));
}

// Prepare (or refresh) the account's draft invoice from its current charges, for review.
async function draftInvoice(id:string,actor:Actor,t:any){
 await account(id,actor,t);
 const draft:any=await domain(B.draftInvoice(id,actor,t));
 return invoiceView(draft.id,t);
}

// Issuing states the draft version the desk reviewed (If-Match). A draft changed by a later
// charge is refused with 412, never issued with lines nobody reviewed.
async function issueInvoice(id:string,body:any,actor:Actor,ifMatch:any,t:any){
 if(!DESK.includes(actor.role))fail(403,'Your role cannot issue invoices.','ROLE_NOT_PERMITTED');
 if(ifMatch===undefined||ifMatch===null||ifMatch==='')fail(428,'If-Match with the draft invoice version is required.','PRECONDITION_REQUIRED');
 const expected=Number(String(ifMatch).replace(/"/g,''));
 if(!Number.isSafeInteger(expected)||expected<1)fail(422,'If-Match must be the draft invoice version.','INVALID_PRECONDITION');
 await account(id,actor,t,true);
 const [draft]=await rows("SELECT id,revision,api_version FROM hms_invoices WHERE account_id=CAST(:id AS uuid) AND status='Draft' FOR UPDATE",{id},t);
 if(!draft)fail(409,'There is nothing new to bill on this account.','NOTHING_TO_BILL');
 const stale=(current?:number):never=>{throw Object.assign(new Error('The bill changed since it was reviewed. Review it again before issuing.'),{status:412,code:'VERSION_CONFLICT',...(current===undefined?{}:{current})});};
 if(Number(draft.api_version)!==expected)stale(Number(draft.api_version));
 try{await domain(B.issueInvoice(draft.id,{revision:draft.revision,applyDeposits:body?.apply_deposits===true},actor,t));}
 catch(e:any){if(e?.code==='STALE_DRAFT')stale();throw e;}
 return invoiceView(draft.id,t);
}

async function allocateDeposit(body:any,actor:Actor,t:any){
 requireRole(actor,DESK);
 const fundId=uuid(body?.fund_id,'fund_id'),invoiceId=uuid(body?.invoice_id,'invoice_id');
 const a=await domain(B.allocateFund({fundId,invoiceId,amount:body.amount??null},actor,t));
 return {id:a.id,fund_id:a.fund_id,invoice_id:a.invoice_id,amount:String(a.amount),allocated_at:a.allocated_at,version:1};
}

// A credit note against an issued invoice (administrators). Either explicit lines, or the
// cancelled charge it credits (reversal_id), which links the note to that reversal.
async function creditNote(body:any,actor:Actor,t:any){
 requireRole(actor,ADMIN);
 let note:any;
 if(body?.reversal_id){note=await domain(B.creditReversal(uuid(body.reversal_id,'reversal_id'),actor,t));}
 else{
  const invoiceId=uuid(body?.invoice_id,'invoice_id');
  if(!Array.isArray(body?.lines))fail(422,'A credit note needs lines.','VALIDATION_FAILED');
  note=await domain(B.createNote(invoiceId,{kind:'credit',reason:body.reason,payerAmount:body.payer_amount,
   lines:body.lines.map((l:any)=>({invoiceLineId:l.invoice_line_id,category:l.category,description:l.description,amount:l.amount,gstAmount:l.gst_amount}))},actor,t));
 }
 const n=note?.note??note;
 return {id:n.id,note_number:n.note_number,invoice_id:n.invoice_id,kind:n.kind,amount:String(n.amount),gst_amount:String(n.gst_amount),
  patient_amount:String(n.patient_amount),payer_amount:String(n.payer_amount),version:Number(n.api_version??1)};
}

module.exports={startPayment,requestRefund,decideRefund,payRefund,completeRefund,readAccount,addCharge,reverseCharge,draftInvoice,issueInvoice,allocateDeposit,creditNote};
