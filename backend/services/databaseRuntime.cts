type Capability={superuser:boolean;bypassRls:boolean;canAssumeOwner:boolean;ownsClinicalTables:boolean;missingPolicies:boolean;canCreateSchemas:boolean};
function problems(c:Capability):string[]{
 const errors:string[]=[];
 if(c.superuser||c.bypassRls)errors.push('Application database identity must not bypass row-level security.');
 if(c.ownsClinicalTables||c.canAssumeOwner)errors.push('Application database identity must not own clinical tables or assume their owner.');
 if(c.canCreateSchemas)errors.push('Application database identity must not create database schemas.');
 if(c.missingPolicies)errors.push('Every facility-owned clinical table requires an enabled facility row policy.');
 return errors;
}
async function verifyRuntime(sequelize:any):Promise<void>{
 const [c]=await sequelize.query(`SELECT r.rolsuper AS "superuser",r.rolbypassrls AS "bypassRls",
  EXISTS(SELECT 1 FROM hms_facility_backfills b JOIN pg_class c ON c.oid=to_regclass('public.'||b.table_name)
   WHERE c.relowner=r.oid) AS "ownsClinicalTables",
  EXISTS(SELECT 1 FROM hms_facility_backfills b JOIN pg_class c ON c.oid=to_regclass('public.'||b.table_name)
   WHERE pg_has_role(r.oid,c.relowner,'MEMBER')) AS "canAssumeOwner",
  (has_database_privilege(current_user,current_database(),'CREATE') OR has_schema_privilege(current_user,'public','CREATE')) AS "canCreateSchemas",
  EXISTS(SELECT 1 FROM hms_facility_backfills b LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||b.table_name)
   WHERE c.oid IS NULL OR NOT c.relrowsecurity OR NOT EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='facility_scope')) AS "missingPolicies"
 FROM pg_roles r WHERE r.rolname=current_user`,{type:'SELECT'});
 const errors=problems(c);if(errors.length)throw new Error(errors.join(' '));
}
module.exports={problems,verifyRuntime};
