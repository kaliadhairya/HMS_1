// Parallel migration ranges can have explicit cross-range prerequisites.
// Preserve immutable SQL checksums and choose the first ready version in the
// original order. A missing dependency, changed pinned artifact or cycle fails.
function orderMigrations(migrations, constraints) {
  const known = new Map(migrations.map(m => [m.version,m]));
  for (const [version, rule] of Object.entries(constraints)) {
    if (!known.has(version) || !Array.isArray(rule.after) || rule.after.some(v => !known.has(v)) ||
        rule.checksum !== known.get(version).checksum) throw new Error(`Invalid pinned migration prerequisites for ${version}`);
  }
  const remaining=[...migrations],ordered=[],complete=new Set();
  while(remaining.length){
    const index=remaining.findIndex(m=>(constraints[m.version]?.after||[]).every(v=>complete.has(v)));
    if(index<0)throw new Error('Migration prerequisites contain a cycle');
    const [next]=remaining.splice(index,1);ordered.push(next);complete.add(next.version);
  }
  return ordered;
}
module.exports={orderMigrations};
