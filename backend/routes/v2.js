const express=require('express'),router=express.Router();
const {protect,restrictTo}=require('../middleware/auth'),{idempotencyGuard}=require('../utils/idempotency');
const {sequelize}=require('../models/db'),V=require('../services/clinicalV2.cts');
const Medications=require('../services/medicationV2.cts');
router.use(protect);
router.use((req,res,next)=>V.authorizeRequest(req.path,req.method,req.body,req.user).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);}));
router.use((req,res,next)=>Medications.authorizeRequest(req.path,req.method,req.user).then(()=>next()).catch(error=>{const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);}));
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
module.exports=router;
