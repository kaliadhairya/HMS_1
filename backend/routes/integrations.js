const express = require('express');
const { protect, restrictTo } = require('../middleware/auth');
const R = require('../services/integrationReadiness.cts');
const {sequelize}=require('../models/db');
const Messages=require('../services/interfaces');

// Readiness of ABDM and terminology (completion B2), for administrators.
const router = express.Router();
router.use(protect,restrictTo('super_admin','admin'));
const publicMessage=(m)=>m&&Object.fromEntries(['id','direction','system','message_type','contract_version','external_id','status','attempts','max_attempts','delivery_hold','attempt_series','retry_of','delivery_key','lease_generation','created_at','finished_at'].map(k=>[k,m[k]]));
const reviewVersion=async(req,t)=>{
 const value=req.get('if-match');if(value===undefined)throw Object.assign(new Error('Reload the delivery and send its reviewed generation in If-Match.'),{status:428,code:'DELIVERY_PRECONDITION_REQUIRED'});
 const text=String(value).replace(/^"(\d+)"$/,'$1');if(!/^\d+$/.test(text)||!Number.isSafeInteger(Number(text)))throw Object.assign(new Error('The reviewed delivery generation is invalid.'),{status:422,code:'INVALID_PRECONDITION'});
 const [row]=await sequelize.query('SELECT lease_generation FROM hms_interface_messages WHERE id=:id AND facility_id=:facility FOR UPDATE',{replacements:{id:req.params.id,facility:req.user.facilityId},transaction:t,type:'SELECT'});
 if(!row)throw Object.assign(new Error('Message not found.'),{status:404,code:'MESSAGE_NOT_FOUND'});
 if(Number(row.lease_generation)!==Number(text))throw Object.assign(new Error('Another delivery attempt occurred. Reload and review the current outcome.'),{status:412,code:'STALE_DELIVERY_REVIEW'});
};
const command=(execute)=>async(req,res)=>{try{let data=await sequelize.transaction(t=>execute(req,t));if(req.method!=='GET')data=publicMessage(data);res.set('Cache-Control','no-store').json({success:true,data});}catch(error){if(error.status)return res.status(error.status).json({success:false,code:error.code,message:error.message});if(error.original?.code==='22P02')return res.status(404).json({success:false,message:'Message not found.'});console.error('Interface review failed:',error.code||error.name);res.status(500).json({success:false,message:'Could not complete delivery review.'});}};
router.get('/messages',command((req,t)=>Messages.list({system:req.query.system||null,status:req.query.status||null,direction:req.query.direction||null},t)));
router.post('/messages/:id/retry',command(async(req,t)=>{await reviewVersion(req,t);return Messages.retry(req.params.id,req.user,t,req.body||{});}));
router.post('/messages/:id/review',command(async(req,t)=>{await reviewVersion(req,t);return Messages.reviewDelivery(req.params.id,req.body||{},req.user,t);}));
router.get('/readiness', protect, restrictTo('super_admin', 'admin'), async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store');
    return res.json({ success: true, data: await R.readiness() });
  } catch (err) {
    console.error('Readiness check failed:', err.message);
    return res.status(500).json({ success: false, message: 'Could not check readiness.' });
  }
});

module.exports = router;
