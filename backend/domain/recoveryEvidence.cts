type RecoveryMeasurement={
 rpoSeconds:unknown;rtoSeconds:unknown;rpoTargetSeconds:unknown;rtoTargetSeconds:unknown;
 auditProblems:unknown;unbalancedEntries:unknown;stockProblems:unknown;clinicalProblems:unknown;
 schemaMatches:boolean;artifactVerified:boolean;
};
function recoveryProblems(m:RecoveryMeasurement):string[]{
 const problems:string[]=[];
 for(const [name,value] of [['RPO',m.rpoSeconds],['RTO',m.rtoSeconds]])
  if(typeof value!=='number'||!Number.isFinite(value)||value<0)problems.push(`${name} is not a valid measured duration`);
 for(const [name,value] of [['RPO target',m.rpoTargetSeconds],['RTO target',m.rtoTargetSeconds]])
  if(typeof value!=='number'||!Number.isFinite(value)||value<=0)problems.push(`${name} is invalid`);
 if(typeof m.rpoSeconds==='number'&&typeof m.rpoTargetSeconds==='number'&&m.rpoSeconds>m.rpoTargetSeconds)problems.push('RPO target exceeded');
 if(typeof m.rtoSeconds==='number'&&typeof m.rtoTargetSeconds==='number'&&m.rtoSeconds>m.rtoTargetSeconds)problems.push('RTO target exceeded');
 for(const [name,value] of [['Audit',m.auditProblems],['Journal',m.unbalancedEntries],['Stock',m.stockProblems],['Clinical links',m.clinicalProblems]])
  if(typeof value!=='number'||!Number.isSafeInteger(value)||value!==0)problems.push(`${name} validation is missing or has failures`);
 if(!m.schemaMatches)problems.push('Schema checksums do not match');
 if(!m.artifactVerified)problems.push('Artifact integrity is unverified');
 return problems;
}
module.exports={recoveryProblems};
