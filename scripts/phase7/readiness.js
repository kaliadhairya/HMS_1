#!/usr/bin/env node
// Evidence completeness checker. This never authorizes or deploys hospital care.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const C = require('./catalogue');
const ROOT = path.resolve(__dirname, '../..');
const nonblank = s => typeof s === 'string' && s.trim().length > 0;
const named = s => nonblank(s) && !/^(tbd|pending|unknown|unassigned|placeholder|n\/a|demo|test)$/i.test(s.trim());
const timestamp = s => typeof s === 'string' && /(?:Z|[+-]\d\d:\d\d)$/.test(s) && Number.isFinite(Date.parse(s));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function template() {
  return {
    schema_version: 1,
    context: { release_commit: null, environment: null, site: null, scope_id: null },
    owner_names: Object.fromEntries(Object.keys(C.owners).map(id => [id, null])),
    gates: Object.fromEntries(C.gates.map(g => [g.id, { evidence: [] }])),
    hazards: Object.fromEntries(C.hazards.map(h => [h.id, { state: 'OPEN', evidence_ids: [] }])),
  };
}
function validate(record) {
  const errors = [];
  if (!object(record) || record.schema_version !== 1) return ['Unsupported assessment schema'];
  if (!['context','owner_names','gates','hazards'].every(key=>object(record[key]))) return ['Missing or invalid assessment sections'];
  for (const field of ['release_commit', 'environment', 'site', 'scope_id']) {
    const value = record.context[field];
    if (!(value === null || nonblank(value))) errors.push(`Invalid context.${field}`);
  }
  if (record.context.release_commit !== null && !/^[a-f0-9]{40}$/.test(record.context.release_commit || '')) errors.push('release_commit must be a full Git commit');
  for (const id of Object.keys(C.owners)) {
    if (!(record.owner_names[id] === null || named(record.owner_names[id]))) errors.push(`Invalid named owner ${id}`);
  }
  const ids = new Map();
  for (const g of C.gates) {
    const evidence = record.gates[g.id]?.evidence;
    if (!Array.isArray(evidence)) { errors.push(`Missing gate ${g.id}`); continue; }
    for (const e of evidence) {
      if (!e || !nonblank(e.id)) { errors.push(`Invalid evidence in ${g.id}`); continue; }
      if (ids.has(e.id)) errors.push(`Duplicate evidence ID ${e.id}`);
      ids.set(e.id, { gate: g, evidence: e });
      if (!g.kinds.includes(e.kind)) errors.push(`Unsupported evidence kind ${e.id}`);
      if (!['PASS', 'FAIL'].includes(e.outcome)) errors.push(`Invalid evidence outcome ${e.id}`);
      if (!C.stages.includes(e.stage)) errors.push(`Invalid stage ${e.id}`);
      for (const f of ['observed_at', 'reviewed_at', 'expires_at']) if (!timestamp(e[f])) errors.push(`Invalid ${f} ${e.id}`);
      if (!named(e.reviewed_by) || !nonblank(e.decision_ref)) errors.push(`Missing review ${e.id}`);
      if (!e.context || Object.keys(record.context).some(f => !nonblank(e.context[f]))) errors.push(`Missing evidence binding ${e.id}`);
      if (!e.artifact || !nonblank(e.artifact.path) || !/^[a-f0-9]{64}$/.test(e.artifact.sha256 || '')) errors.push(`Invalid artifact ${e.id}`);
      if (!Array.isArray(e.supersedes) || e.supersedes.some(id=>!nonblank(id))) errors.push(`Missing/invalid supersession list ${e.id}`);
    }
  }
  for (const [id, { gate, evidence: e }] of ids) {
    for (const priorId of Array.isArray(e.supersedes) ? e.supersedes : []) {
      const prior = ids.get(priorId);
      if (!prior || priorId === id || prior.gate.id !== gate.id || prior.evidence.kind !== e.kind || prior.evidence.stage !== e.stage ||
          Date.parse(prior.evidence.observed_at) >= Date.parse(e.observed_at) ||
          JSON.stringify(prior.evidence.context) !== JSON.stringify(e.context) || !nonblank(e.supersession_reason)) {
        errors.push(`Invalid supersession ${id} -> ${priorId}`);
      }
    }
  }
  for (const h of C.hazards) {
    const item = record.hazards[h.id];
    if (!item || !['OPEN', 'CLOSED'].includes(item.state) || !Array.isArray(item.evidence_ids)) { errors.push(`Missing/invalid hazard ${h.id}`); continue; }
    for (const id of item.evidence_ids) if (!ids.has(id)) errors.push(`Unknown hazard evidence ${h.id} -> ${id}`);
  }
  for (const id of Object.keys(record.gates)) if (!C.gates.some(g => g.id === id)) errors.push(`Unknown gate ${id}`);
  for (const id of Object.keys(record.hazards)) if (!C.hazards.some(h => h.id === id)) errors.push(`Unknown hazard ${id}`);
  return errors;
}
function artifactProblem(artifact, directory) {
  try {
    if (path.isAbsolute(artifact.path)) return 'artifact path must be relative to the assessment';
    const root = fs.realpathSync(directory);
    const candidate = fs.realpathSync(path.resolve(root, artifact.path));
    if (!candidate.startsWith(root + path.sep)) return 'artifact escapes assessment directory';
    if (!fs.statSync(candidate).isFile()) return 'artifact is not a file';
    if (sha(fs.readFileSync(candidate)) !== artifact.sha256) return 'artifact checksum mismatch';
    return null;
  } catch { return 'artifact missing or unreadable'; }
}
function evaluate(record, stage, directory, now = new Date()) {
  const errors = validate(record);
  if (!C.stages.includes(stage)) errors.push('Unsupported rollout stage');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) errors.push('Invalid assessment time');
  if (errors.length) return { status: 'INVALID', authorization: false, errors };
  const blockers = [];
  for (const [key, value] of Object.entries(record.context)) if (!nonblank(value)) blockers.push(`Missing candidate ${key}`);
  for (const id of Object.keys(C.owners)) if (!named(record.owner_names[id])) blockers.push(`Unnamed ${C.owners[id]}`);
  const results = [], accepted = new Map();
  for (const g of C.gates.filter(g => g.stages.includes(stage))) {
    const reasons = [], evidence = record.gates[g.id].evidence;
    const candidates = evidence.filter(e => e.stage === stage);
    const valid = candidates.filter(e => {
      const problems = [];
      for (const [f, value] of Object.entries(record.context)) if (e.context[f] !== value) problems.push(`wrong ${f}`);
      if (e.reviewed_by !== record.owner_names[g.owner]) problems.push('reviewer is not the named accountable owner');
      if (Date.parse(e.observed_at) > now || Date.parse(e.reviewed_at) > now) problems.push('future observation/review');
      if (Date.parse(e.reviewed_at) < Date.parse(e.observed_at)) problems.push('review predates observation');
      if (Date.parse(e.expires_at) <= now || Date.parse(e.expires_at) <= Date.parse(e.reviewed_at)) problems.push('expired/invalid evidence validity');
      const a = artifactProblem(e.artifact, directory); if (a) problems.push(a);
      if (problems.length) reasons.push(`${e.id}: ${problems.join(', ')}`);
      return !problems.length;
    });
    // Only fully valid reviewed evidence can supersede an earlier result.
    const replaced = new Set(valid.flatMap(e => e.supersedes));
    const live = valid.filter(e => !replaced.has(e.id));
    for (const kind of g.kinds) {
      const matching = live.filter(e => e.kind === kind);
      if (!matching.some(e => e.outcome === 'PASS')) reasons.push(`Missing ${kind}`);
      if (matching.some(e => e.outcome === 'FAIL')) reasons.push(`Unresolved ${kind} failure`);
    }
    if (!reasons.length) for (const e of live) if (e.outcome === 'PASS') accepted.set(e.id, { gate: g, evidence: e });
    results.push({ id: g.id, title: g.title, owner: C.owners[g.owner], status: reasons.length ? 'BLOCKED' : 'SATISFIED_FOR_REVIEW', reasons });
  }
  const hazards = C.hazards.filter(h => h.stages.includes(stage)).map(h => {
    const disposition = record.hazards[h.id];
    const reviewed = disposition.evidence_ids.some(id => {
      const item = accepted.get(id);
      return item && h.gates.includes(item.gate.id) && item.gate.owner === h.owner && item.evidence.kind === 'OWNER_REVIEW';
    });
    const closed = disposition.state === 'CLOSED' && reviewed;
    return { id: h.id, title: h.title, priority: h.priority, status: closed ? 'DISPOSITION_REVIEWED' : 'OPEN' };
  });
  blockers.push(...results.filter(g => g.status === 'BLOCKED').map(g => `${g.id}: ${g.reasons.join('; ')}`));
  blockers.push(...hazards.filter(h => h.status === 'OPEN').map(h => `${h.id}: unaccepted ${h.priority} hazard disposition`));
  return { status: blockers.length ? 'BLOCKED' : 'REVIEW_REQUIRED', authorization: false,
    stage, assessed_at: now.toISOString(), context: record.context, gates: results, hazards, blockers,
    meaning: 'Checks evidence completeness only. Human authority, clinical adequacy and authenticity must be independently reviewed. No deployment or clinical enablement is performed.' };
}
function catalogueMarkdown() {
  const rows = C.hazards.map(h => `| ${h.id} | ${h.priority} | ${h.title} | ${C.owners[h.owner]} | ${h.gates.join(', ')} |`);
  return `# Hazard register\n\nAll dispositions start OPEN in assessment.template.json. Original F01–F18 priorities come from the owner-provided clinical blueprint; H01–H18 classifications are conservative engineering proposals for hospital review. Existing code mitigations do not constitute clinical acceptance.\n\n| Hazard | Priority | Risk | Accountable hospital role | Controls/gates |\n|---|---|---|---|---|\n${rows.join('\n')}\n\n` + C.gates.map(g => `## ${g.id}: ${g.title}\n\nOwner: ${C.owners[g.owner]}. Stages: ${g.stages.join(', ')}.\n\nControl: ${g.control}\n\nAcceptance: ${g.acceptance}\n\nRequired evidence: ${g.kinds.join(', ')}.\n\nTests: ${g.tests.length ? g.tests.map(t => `[${t}](../../${t})`).join(', ') : 'Phase 6/new clinical or operational acceptance; evidence pending.'}\n\nProcedure: [${g.procedure}](../../${g.procedure}).\n`).join('\n');
}
function main(args) {
  if (args.length === 1 && args[0] === '--generate') {
    const folder = path.join(ROOT, 'docs/phase7');
    const target = path.join(folder, 'assessment.template.json');
    if (!fs.existsSync(target)) fs.writeFileSync(target, JSON.stringify(template(), null, 2) + '\n');
    fs.writeFileSync(path.join(folder, 'HAZARDS.md'), catalogueMarkdown());
    console.log('Generated catalogue and empty assessment template; no approvals recorded.'); return 0;
  }
  const options = { record: path.join(ROOT, 'docs/phase7/assessment.template.json'), stage: 'OPD', json: false, validate: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--record' && args[i + 1]) options.record = path.resolve(args[++i]);
    else if (args[i] === '--stage' && args[i + 1]) options.stage = args[++i];
    else if (args[i] === '--json') options.json = true;
    else if (args[i] === '--validate') options.validate = true;
    else throw new Error('Usage: readiness.js [--record file] [--stage OPD|WARD|EXPANSION] [--json] [--validate]');
  }
  const record = JSON.parse(fs.readFileSync(options.record, 'utf8'));
  if (options.validate) {
    const errors = validate(record);
    console.log(JSON.stringify({ valid: !errors.length, errors, clinical_authorization: false }, null, 2));
    return errors.length ? 1 : 0;
  }
  const result = evaluate(record, options.stage, path.dirname(options.record));
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else console.log(`${result.status}: ${options.stage}; clinical authorization: false\n${(result.blockers || result.errors || []).join('\n')}`);
  return result.status === 'INVALID' ? 1 : result.status === 'BLOCKED' ? 2 : 0;
}
if (require.main === module) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { template, validate, evaluate, catalogueMarkdown, sha };
