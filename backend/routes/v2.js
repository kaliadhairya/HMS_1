const express=require('express'),router=express.Router();
const {protect,restrictTo}=require('../middleware/auth'),{idempotencyGuard}=require('../utils/idempotency');
const {sequelize}=require('../models/db'),V=require('../services/clinicalV2.cts');
const Medications=require('../services/medicationV2.cts');
const Observations=require('../services/clinicalObservations.cts');
router.use(protect);
router.use((req,res,next)=>V.authorizeRequest(req.path,req.method,req.body,req.user).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);}));
router.use((req,res,next)=>Medications.authorizeRequest(req.path,req.method,req.user).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);}));
router.use((req,res,next)=>Observations.authorizeRequest(req.path,req.method,req.body,req.user).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);}));
router.use((req,res,next)=>idempotencyGuard(req,res,next).catch(next));
const handle=(fn,{command=false,status=200}={})=>async(req,res)=>{
 try{
  const data=command?await sequelize.transaction(t=>fn(req,res,t)):await fn(req,res);
  if(data.version)res.set('ETag',`"${data.version}"`);
  res.status(status).json({success:true,data,...(command?{version:data.version,operation_id:req.id}:{})});
 }catch(error){const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);
 }
};
const clinicalRead=fn=>handle((r,res)=>sequelize.transaction({isolationLevel:'REPEATABLE READ'},t=>fn(r,res,t)));
router.get('/legacy-identities/:kind/:id',clinicalRead((r,res,t)=>V.identity(r.params.kind,r.params.id,r.user,t)));
router.get('/patients/:id',restrictTo('doctor','nurse','pharmacist','lab_technician','receptionist','admin','super_admin'),clinicalRead(async(r,res,t)=>{
 const data=await V.patient(r.params.id,r.user,t);const {locate,legacyNumber}=require('../services/identities.cts');res.locals.auditPatientId=legacyNumber(await locate('patient',r.params.id,r.user,t));return data;
}));
router.get('/encounters/:id',restrictTo('doctor','nurse','admin','super_admin'),clinicalRead(async(r,res,t)=>{
 const data=await V.readEncounter(r.params.id,r.user,t);const {locate,legacyNumber}=require('../services/identities.cts');res.locals.auditPatientId=legacyNumber(await locate('patient',data.patient_id,r.user,t));return data;
}));
router.get('/observations/patient/:id',restrictTo('doctor','nurse'),clinicalRead(async(r,res,t)=>{
 const data=await Observations.byPatient(r.params.id,r.user,t);const I=require('../services/identities.cts');
 res.locals.auditPatientId=I.legacyNumber(await I.locate('patient',r.params.id,r.user,t));return data;
}));
router.get('/observations/:id',restrictTo('doctor','nurse'),clinicalRead(async(r,res,t)=>{
 const data=await Observations.view(r.params.id,r.user,t);const I=require('../services/identities.cts');
 res.locals.auditPatientId=I.legacyNumber(await I.locate('patient',data.patient_id,r.user,t));return data;
}));
router.post('/observations',restrictTo('doctor','nurse'),handle((r,res,t)=>Observations.create(r.body,r.user,t),{command:true,status:201}));
router.post('/encounters',restrictTo('doctor'),handle((r,res,t)=>V.create(r.body,r.user,t),{command:true,status:201}));
router.put('/encounters/:id/draft',restrictTo('doctor'),handle((r,res,t)=>V.note(r.params.id,r.user,r.body,r.get('if-match'),t),{command:true}));
router.post('/encounters/:id/sign',restrictTo('doctor'),handle((r,res,t)=>V.note(r.params.id,r.user,r.body||{},r.get('if-match'),t,true),{command:true}));
const Documents=require('../services/clinicalDocumentV2.cts');
router.get('/clinical-documents/:id',restrictTo('doctor','nurse'),clinicalRead(async(r,res,t)=>{const data=await Documents.read(r.params.id,r.user,t);const I=require('../services/identities.cts');res.locals.auditPatientId=I.legacyNumber(await I.locate('patient',data.patient_id,r.user,t));return data;}));
router.post('/clinical-documents',restrictTo('doctor','nurse'),handle((r,res,t)=>Documents.create(r.body,r.user,t),{command:true,status:201}));
for(const [method,action] of [['put','draft'],['post','sign'],['post','amend'],['post','sign-amendment']])
 router[method](`/clinical-documents/:id/${action}`,restrictTo('doctor','nurse'),handle((r,res,t)=>Documents.change(r.params.id,r.user,action,r.body||{},r.get('if-match'),t),{command:true}));
const medicationRead=(fn)=>handle((r,res)=>sequelize.transaction({isolationLevel:'REPEATABLE READ'},async t=>{
 const data=await fn(r,t);const I=require('../services/identities.cts');res.locals.auditPatientId=I.legacyNumber(await I.locate('patient',data.patient_id,r.user,t));return data;
}));
router.get('/medication-orders/:id',restrictTo('doctor','nurse','pharmacist'),medicationRead((r,t)=>Medications.read(r.params.id,r.user,t)));
router.post('/medication-orders',restrictTo('doctor'),handle((r,res,t)=>Medications.create(r.body,r.user,t),{command:true,status:201}));
for(const action of ['sign','hold','resume','discontinue','amend'])router.post(`/medication-orders/:id/${action}`,restrictTo('doctor'),handle((r,res,t)=>Medications.transition(r.params.id,action,r.body||{},r.user,r.get('if-match'),t),{command:true}));
router.post('/medication-orders/:id/verify',restrictTo('pharmacist'),handle((r,res,t)=>Medications.verify(r.params.id,r.body||{},r.user,r.get('if-match'),t),{command:true}));
router.post('/dispenses',restrictTo('pharmacist'),handle((r,res,t)=>Medications.dispense(r.body,r.user,r.get('if-match'),t),{command:true,status:201}));
router.get('/dispenses/:id',restrictTo('doctor','nurse','pharmacist'),medicationRead((r,t)=>Medications.readDispense(r.params.id,r.user,t)));
router.post('/medication-orders/:id/schedules',restrictTo('nurse','pharmacist'),handle((r,res,t)=>Medications.schedule(r.params.id,r.body,r.user,r.get('if-match'),t),{command:true,status:201}));
router.get('/medication-schedules/:id',restrictTo('doctor','nurse','pharmacist'),medicationRead((r,t)=>Medications.readSchedule(r.params.id,r.user,t)));
router.post('/medication-schedules/:id/prepare',restrictTo('nurse'),handle((r,res,t)=>Medications.prepare(r.params.id,r.body,r.user,r.get('if-match'),t),{command:true,status:201}));
router.post('/administrations',restrictTo('nurse'),handle((r,res,t)=>Medications.administer(r.body,r.user,r.get('if-match'),t),{command:true,status:201}));
router.get('/administrations/:id',restrictTo('doctor','nurse','pharmacist'),medicationRead((r,t)=>Medications.readAdministration(r.params.id,r.user,t)));
const Appointments=require('../services/appointmentV2.cts');
router.post('/appointments',restrictTo('super_admin','admin','doctor','receptionist'),handle((r,res,t)=>Appointments.book(r.body,r.user,t),{command:true,status:201}));
router.get('/appointments/:id',restrictTo('super_admin','admin','doctor','receptionist'),clinicalRead((r,res,t)=>Appointments.read(r.params.id,r.user,t)));
router.post('/appointments/:id/reschedule',restrictTo('super_admin','admin','doctor','receptionist'),handle((r,res,t)=>Appointments.change(r.params.id,'reschedule',r.body,r.user,r.get('if-match'),t),{command:true}));
router.post('/appointments/:id/cancel',restrictTo('super_admin','admin','doctor','receptionist'),handle((r,res,t)=>Appointments.change(r.params.id,'cancel',r.body,r.user,r.get('if-match'),t),{command:true}));
const Admissions=require('../services/admissionV2.cts');
router.get('/admissions/:id',restrictTo('super_admin','admin','nurse','doctor'),clinicalRead((r,res,t)=>Admissions.read(r.params.id,r.user,t)));
router.post('/admissions/:id/transfer',restrictTo('super_admin','admin','nurse','doctor'),handle((r,res,t)=>Admissions.transfer(r.params.id,r.body,r.user,r.get('if-match'),t),{command:true}));
router.post('/admissions/:id/discharge',restrictTo('doctor'),handle((r,res,t)=>Admissions.discharge(r.params.id,r.body,r.user,r.get('if-match'),t),{command:true}));
const Laboratory=require('../services/laboratoryV2.cts');
router.post('/lab-orders',restrictTo('doctor'),handle((r,res,t)=>Laboratory.create(r.body,r.user,t),{command:true,status:201}));
router.post('/lab-orders/:id/cancel',restrictTo('doctor','lab_technician'),handle((r,res,t)=>Laboratory.cancel(r.params.id,r.get('if-match'),r.user,t),{command:true}));
const Billing=require('../services/billingV2.cts');
router.post('/payments',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.startPayment(r.body,r.user,t),{command:true,status:201}));
router.post('/refunds',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.requestRefund(r.body,r.user,t),{command:true,status:201}));
router.post('/refunds/:id/approve',restrictTo('super_admin','admin'),handle((r,res,t)=>Billing.decideRefund(r.params.id,true,r.body?.note,r.user,t),{command:true}));
router.post('/refunds/:id/reject',restrictTo('super_admin','admin'),handle((r,res,t)=>Billing.decideRefund(r.params.id,false,r.body?.note,r.user,t),{command:true}));
router.post('/refunds/:id/pay',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.payRefund(r.params.id,r.body,r.user,t),{command:true}));
router.post('/refunds/:id/confirm',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.completeRefund(r.params.id,'confirmed',r.body,r.user,t),{command:true}));
router.post('/admissions',restrictTo('super_admin','admin','doctor','nurse'),handle((r,res,t)=>Admissions.admit(r.body,r.user,t),{command:true,status:201}));
router.get('/billing-accounts/:id',restrictTo('super_admin','admin','receptionist','nurse'),clinicalRead((r,res,t)=>Billing.readAccount(r.params.id,r.user,t)));
router.post('/billing-accounts/:id/charges',restrictTo('super_admin','admin','receptionist','nurse'),handle((r,res,t)=>Billing.addCharge(r.params.id,r.body,r.user,t),{command:true,status:201}));
router.post('/charges/:id/reverse',restrictTo('super_admin','admin','receptionist','nurse'),handle((r,res,t)=>Billing.reverseCharge(r.params.id,r.body,r.user,t),{command:true,status:201}));
router.post('/billing-accounts/:id/draft-invoice',restrictTo('super_admin','admin','receptionist','nurse'),handle((r,res,t)=>Billing.draftInvoice(r.params.id,r.user,t),{command:true}));
router.post('/billing-accounts/:id/invoices',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.issueInvoice(r.params.id,r.body,r.user,r.get('if-match'),t),{command:true,status:201}));
router.post('/deposit-allocations',restrictTo('super_admin','admin','receptionist'),handle((r,res,t)=>Billing.allocateDeposit(r.body,r.user,t),{command:true,status:201}));
router.post('/credit-notes',restrictTo('super_admin','admin'),handle((r,res,t)=>Billing.creditNote(r.body,r.user,t),{command:true,status:201}));
module.exports=router;
