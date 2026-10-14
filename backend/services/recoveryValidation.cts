const crypto=require('node:crypto');
type DatabaseClient={query:(sql:string,values?:unknown[])=>Promise<{rows:any[]}>};
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const digest=(value:unknown):string=>crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
async function inventory(client:DatabaseClient){
 const {rows:tables}=await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('public','audit') ORDER BY schemaname,tablename");
 const counts:Record<string,string>={};
 for(const r of tables){const {rows:[n]}=await client.query(`SELECT count(*)::text AS n FROM ${quote(r.schemaname)}.${quote(r.tablename)}`);counts[r.schemaname+'.'+r.tablename]=n.n;}
 const {rows:migrations}=await client.query('SELECT version,file,checksum FROM schema_migrations ORDER BY version');
 const {rows:extensions}=await client.query('SELECT extname,extversion FROM pg_extension ORDER BY extname');
 return {counts,migrations,extensions};
}
async function invariants(client:DatabaseClient){
 const checks:Record<string,string>={
  audit:`SELECT (SELECT count(*) FROM audit.verify('audit.row_changes'::regclass))+(SELECT count(*) FROM audit.verify('audit.access_events'::regclass))+(SELECT count(*) FROM audit.verify('public.hms_audit_logs'::regclass)) AS n`,
  journal:`SELECT count(*) AS n FROM hms_journal_entries e LEFT JOIN hms_journal_lines l ON l.entry_id=e.id GROUP BY e.id HAVING count(l.id)=0 OR sum(l.debit)<>sum(l.credit)`,
  stock:`SELECT count(*) AS n FROM hms_med_balances b FULL JOIN (SELECT batch_id,location_id,sum(delta) AS quantity FROM hms_med_movements GROUP BY batch_id,location_id) m USING(batch_id,location_id) WHERE coalesce(b.quantity,0)<>coalesce(m.quantity,0)`,
  clinical:`SELECT count(*) AS n FROM hms_med_administrations a JOIN hms_med_order_versions v ON v.id=a.version_id JOIN hms_med_orders o ON o.id=v.order_id WHERE a.patient_id<>o.patient_id`,
  lab:`SELECT count(*) AS n FROM hms_lab_result_versions r JOIN hms_lab_specimens s ON s.id=r.specimen_id JOIN hms_investigation_order_items i ON i.id=r.item_id JOIN hms_investigation_orders o ON o.id=i.order_id WHERE s.patient_id<>o.patient_id`,
  constraints:`SELECT count(*) AS n FROM pg_constraint c JOIN pg_namespace ns ON ns.oid=c.connamespace WHERE ns.nspname IN ('public','audit') AND NOT c.convalidated`,
 };
 const result:Record<string,number>={};
 for(const [name,sql] of Object.entries(checks)){const {rows}=await client.query(sql);result[name]=name==='journal'?rows.length:Number(rows[0]?.n);if(!Number.isSafeInteger(result[name]))throw new Error(`Unmeasured ${name} validation`);}
 const {rows:signatures}=await client.query('SELECT content,digest FROM hms_document_signatures');
 result.signatures=signatures.filter(r=>digest(r.content)!==r.digest).length;
 return result;
}
module.exports={inventory,invariants,digest,canonical};
