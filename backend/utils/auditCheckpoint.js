const crypto = require('crypto');

// Validate the whole manifest before interpreting individual chain heads.
// Existing checkpoints retain their original signature and immutable hashes.
function validateCheckpoint(parsed, key, chains, now = new Date()) {
  const problems = [];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['Checkpoint must be an object'];
  const { signature, ...body } = parsed;
  if (!key) return ['Checkpoint verification key is unavailable'];
  const expected = crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
  if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature) ||
      !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) problems.push('Checkpoint signature does not match');
  const at = new Date(body.created_at);
  if (typeof body.created_at !== 'string' || !Number.isFinite(at.getTime()) || at > now) problems.push('Checkpoint time is invalid or in the future');
  if (!Array.isArray(body.heads)) return [...problems, 'Chain manifest is missing'];
  const seen = new Set();
  for (const head of body.heads) {
    if (!head || !chains.includes(head.chain) || seen.has(head.chain)) { problems.push('Unknown or duplicate chain'); continue; }
    seen.add(head.chain);
    if (!Number.isSafeInteger(head.seq) || head.seq < 0) problems.push(`Invalid sequence for ${head.chain}`);
    if (head.seq === 0) {
      if (head.hash !== null && head.hash !== '0'.repeat(64)) problems.push(`Invalid empty-chain hash for ${head.chain}`);
    } else if (typeof head.hash !== 'string' || !/^[a-f0-9]{64}$/i.test(head.hash)) problems.push(`Invalid hash for ${head.chain}`);
  }
  for (const chain of chains) if (!seen.has(chain)) problems.push(`Missing chain ${chain}`);
  return problems;
}

function lockProblems(object, now = new Date()) {
  const mode = process.env.AUDIT_WORM_LOCK_MODE || 'COMPLIANCE';
  const until = new Date(object.ObjectLockRetainUntilDate);
  if (object.ObjectLockMode !== mode || !Number.isFinite(until.getTime()) || until <= now)
    return ['Object retention is missing, expired, or uses an unapproved lock mode'];
  return [];
}
module.exports = { validateCheckpoint, lockProblems };
