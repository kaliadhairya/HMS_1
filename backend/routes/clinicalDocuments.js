const express=require('express'),router=express.Router();
const {protect,restrictTo}=require('../middleware/auth'),{sequelize}=require('../models/db');
const D=require('../services/clinicalDocuments.cts');
router.use(protect,restrictTo('doctor','nurse'));
function id(raw){const n=Number(raw);if(!Number.isSafeInteger(n)||n<1)throw Object.assign(new Error('A valid document identifier is required.'),{status:422,code:'INVALID_ID'});return n;}
const handle=(fn,{command=false,status=200}={})=>async(req,res)=>{
 try{
  const result=command?await sequelize.transaction(t=>fn(req,t)):await fn(req,res);
  const row=result.row||result,data=Array.isArray(row)?row:D.view(row);
  if(data.version)res.set('ETag',`"${data.version}"`);
  res.set('Cache-Control','no-store').status(status).json({success:true,data,...(result.digest?{digest:result.digest}:{})});
 }catch(e){const failure=require('../services/clinicalApiErrors.cts').response(e,'current');res.status(failure.status).json(failure.body);
 }
};
router.post('/',handle((r,t)=>D.create(r.body,r.user,t),{command:true,status:201}));
router.get('/:id',handle(async(r,res)=>{const doc=await D.read(id(r.params.id),r.user);res.locals.auditPatientId=doc.patient_id;return doc;}));
for(const [method,action] of [['put','draft'],['post','sign'],['post','amend'],['post','sign-amendment']])
 router[method](`/:id/${action}`,handle((r,t)=>D.change(id(r.params.id),r.user,action,r.body||{},r.get('if-match'),t),{command:true}));
router.get('/:id/versions',handle(async(r,res)=>{const doc=await D.read(id(r.params.id),r.user);res.locals.auditPatientId=doc.patient_id;return D.versions(id(r.params.id),r.user);}));
module.exports=router;
