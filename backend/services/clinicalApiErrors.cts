type Failure={status?:number;code?:string;message?:string;current?:number;original?:{code?:string};parent?:{code?:string};name?:string};
function response(error:unknown,currentField='current_version'){
 const e=(error||{}) as Failure,pgCode=e.original?.code||e.parent?.code;
 let status=e.status,code=e.code,message=e.message;
 if(!status){
  if(['55P03','40P01','40001'].includes(pgCode||'')){status=409;code='RETRYABLE_CONFLICT';message='Another operation is changing this record. Review the current state and retry.';}
  else if(['23514','23505','23503','23P01','23001'].includes(pgCode||'')){status=409;code='DOMAIN_STATE_CONFLICT';message='The record state or relationships changed. Review the current records before retrying.';}
  else if(pgCode==='22P02'){status=422;code='INVALID_FIELD_VALUE';message='A field does not match the documented clinical contract.';}
  else{status=500;code='CLINICAL_OPERATION_UNCONFIRMED';message='The operation could not be confirmed. Preserve your draft and reconcile the original request.';console.error('Clinical operation failed:',pgCode||e.code||e.name);}
 }
 return {status,body:{success:false,code:code||'CLINICAL_COMMAND_REFUSED',message:message||'The operation was refused.',...(e.current===undefined?{}:{[currentField]:e.current})}};
}
module.exports={response};
