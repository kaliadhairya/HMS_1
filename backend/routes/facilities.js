const express=require('express'),router=express.Router();
const {protect,restrictTo}=require('../middleware/auth');
const {sequelize}=require('../models/db');
const Admin=require('../services/facilityAdministration.cts');
router.use(protect,restrictTo('admin','super_admin'));
const command=fn=>async(req,res)=>{try{const data=await sequelize.transaction(t=>fn(req,t));res.json({success:true,data});}catch(e){if(!e.status)console.error('Facility administration failed:',e.code||e.name);res.status(e.status||500).json({success:false,code:e.status?e.code:'FACILITY_COMMAND_FAILED',message:e.status?e.message:'The facility change was not confirmed.'});}};
router.get('/current',async(req,res)=>{try{const [f]=await sequelize.query('SELECT * FROM hms_facilities WHERE id=:id',{replacements:{id:req.user.facilityId},type:'SELECT'});res.json({success:true,data:f});}catch(e){res.status(503).json({success:false,code:'FACILITY_OBSERVATION_UNAVAILABLE'});}});
router.get('/clinical-grants',async(req,res)=>{try{
 const data=await sequelize.query(`SELECT r.id,r.role,r.valid_from,r.valid_until,r.revoked_at,r.revision,p.public_id practitioner_id,p.display_name,
 coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'action',x.action,'validFrom',x.valid_from,'validUntil',x.valid_until,'revokedAt',x.revoked_at,'revision',x.revision)) FROM hms_clinical_privileges x WHERE x.practitioner_role_id=r.id),'[]') privileges
 FROM hms_practitioner_roles r JOIN hms_practitioners p ON p.id=r.practitioner_id WHERE r.facility_id=:facility ORDER BY p.display_name,r.valid_from DESC`,{replacements:{facility:req.user.facilityId},type:'SELECT'});
 res.json({success:true,data});
 }catch(e){res.status(503).json({success:false,code:'CLINICAL_GRANT_OBSERVATION_UNAVAILABLE'});}});
router.post('/professional-roles',command((r,t)=>Admin.grantRole(r.user,r.body,t)));
router.post('/professional-roles/:id/privileges',command((r,t)=>Admin.grantPrivilege(r.user,r.params.id,r.body,r.headers['if-match'],t)));
router.post('/professional-roles/:id/revoke',command((r,t)=>Admin.revoke(r.user,'role',r.params.id,r.body,r.headers['if-match'],t)));
router.post('/clinical-privileges/:id/revoke',command((r,t)=>Admin.revoke(r.user,'privilege',r.params.id,r.body,r.headers['if-match'],t)));
module.exports=router;
