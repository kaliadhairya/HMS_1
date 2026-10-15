const express=require('express'),router=express.Router();
const {protect,restrictTo}=require('../middleware/auth'),{idempotencyGuard}=require('../utils/idempotency');
const {sequelize}=require('../models/db'),V=require('../services/clinicalV2.cts');
router.use(protect);
router.use((req,res,next)=>idempotencyGuard(req,res,next).catch(next));
const handle=(fn,{command=false,status=200}={})=>async(req,res)=>{
 try{
  const data=command?await sequelize.transaction(t=>fn(req,res,t)):await fn(req,res);
  if(data.version)res.set('ETag',`"${data.version}"`);
  res.status(status).json({success:true,data,...(command?{version:data.version,operation_id:req.id}:{})});
 }catch(error){const failure=require('../services/clinicalApiErrors.cts').response(error);res.status(failure.status).json(failure.body);
 }
};
router.get('/legacy-identities/:kind/:id',handle(r=>V.identity(r.params.kind,r.params.id,r.user)));
router.get('/patients/:id',restrictTo('doctor','nurse','pharmacist','lab_technician','receptionist','admin','super_admin'),handle(async(r,res)=>{
 const data=await V.patient(r.params.id,r.user);const {locate,legacyNumber}=require('../services/identities.cts');res.locals.auditPatientId=legacyNumber(await locate('patient',r.params.id,r.user));return data;
}));
router.get('/encounters/:id',restrictTo('doctor','nurse','admin','super_admin'),handle(async(r,res)=>{
 const data=await V.readEncounter(r.params.id,r.user);const {locate,legacyNumber}=require('../services/identities.cts');res.locals.auditPatientId=legacyNumber(await locate('patient',data.patient_id,r.user));return data;
}));
router.post('/encounters',restrictTo('doctor'),handle((r,res,t)=>V.create(r.body,r.user,t),{command:true,status:201}));
router.put('/encounters/:id/draft',restrictTo('doctor'),handle((r,res,t)=>V.note(r.params.id,r.user,r.body,r.get('if-match'),t),{command:true}));
router.post('/encounters/:id/sign',restrictTo('doctor'),handle((r,res,t)=>V.note(r.params.id,r.user,r.body||{},r.get('if-match'),t,true),{command:true}));
const Documents=require('../services/clinicalDocumentV2.cts');
router.get('/clinical-documents/:id',restrictTo('doctor','nurse'),handle(async(r,res)=>{const data=await Documents.read(r.params.id,r.user);const I=require('../services/identities.cts');res.locals.auditPatientId=I.legacyNumber(await I.locate('patient',data.patient_id,r.user));return data;}));
router.post('/clinical-documents',restrictTo('doctor','nurse'),handle((r,res,t)=>Documents.create(r.body,r.user,t),{command:true,status:201}));
for(const [method,action] of [['put','draft'],['post','sign'],['post','amend'],['post','sign-amendment']])
 router[method](`/clinical-documents/:id/${action}`,restrictTo('doctor','nurse'),handle((r,res,t)=>Documents.change(r.params.id,r.user,action,r.body||{},r.get('if-match'),t),{command:true}));
module.exports=router;
