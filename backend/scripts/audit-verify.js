// Verifies the audit hash chains (migration 0006) and, optionally, signed
// checkpoints written by the server. Exit code 1 when anything is wrong.
//
//   node scripts/audit-verify.js                         chains only
//   AUDIT_CHECKPOINT_KEY=... node scripts/audit-verify.js <checkpoint-dir>
//   AUDIT_CHECKPOINT_KEY=... AUDIT_WORM_BUCKET=... node scripts/audit-verify.js --remote
//       checks the write-once store (Phase 6H) and puts problems on the worklist
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { CHAINS, sealOnce } = require('../utils/auditSealer');
const { validateCheckpoint } = require('../utils/auditCheckpoint');

async function main() {
  const problems = [];
  await sealOnce(sequelize);
  for (const chain of CHAINS) {
    const rows = await sequelize.query('SELECT chain_seq, problem FROM audit.verify(CAST(:chain AS regclass))', { replacements: { chain }, type: QueryTypes.SELECT });
    const [{ sealed, unsealed }] = await sequelize.query(
      `SELECT count(*) FILTER (WHERE row_hash IS NOT NULL)::int AS sealed, count(*) FILTER (WHERE row_hash IS NULL)::int AS unsealed FROM ${chain}`,
      { type: QueryTypes.SELECT }
    );
    rows.forEach((r) => problems.push(`${chain} #${r.chain_seq ?? r.CHAIN_SEQ}: ${r.problem ?? r.PROBLEM}`));
    console.log(`${chain}: ${sealed} sealed, ${unsealed} awaiting seal, ${rows.length} problem(s)`);
  }

  if (process.argv[2] === '--remote') {
    const { checkAndReport } = require('../utils/auditShipper');
    const { problems: remote, checked } = await checkAndReport(sequelize);
    remote.forEach((p) => problems.push(`${p.kind}: ${p.title}`));
    console.log(`${checked} remote checkpoint(s) checked; problems are on the worklist`);
  }
  const dir = process.argv[2] === '--remote' ? null : process.argv[2];
  if (dir) {
    const key = process.env.AUDIT_CHECKPOINT_KEY;
    if (!key) throw new Error('AUDIT_CHECKPOINT_KEY is required to check checkpoints');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('audit-checkpoint-') && f.endsWith('.json')).sort();
    for (const file of files) {
      let parsed;
      try {
        parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      } catch (err) {
        // An empty or truncated file is a lost checkpoint (for example a crash
        // mid-write before writes were made atomic): report it, keep checking.
        problems.push(`${file}: unreadable checkpoint (${err.message})`);
        continue;
      }
      const { signature, ...body } = parsed;
      const expected = crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
      if (typeof signature !== 'string' || !/^[a-f0-9]{64}$/.test(signature) || !crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) { problems.push(`${file}: signature does not match`); continue; }
      const invalid = validateCheckpoint(parsed, key, CHAINS);
      if (invalid.length) { problems.push(`${file}: ${invalid.join('; ')}`); continue; }
      for (const head of body.heads) {
        if (!CHAINS.includes(head.chain) || !Number.isSafeInteger(head.seq) || head.seq < 0) { problems.push(`${file}: invalid chain reference`); continue; }
        if (!head.seq) continue;
        const [row] = await sequelize.query(`SELECT encode(row_hash, 'hex') AS hash FROM ${head.chain} WHERE chain_seq = :seq`, { replacements: { seq: head.seq }, type: QueryTypes.SELECT });
        const actual = row?.hash ?? row?.HASH;
        if (actual !== head.hash) problems.push(`${file}: ${head.chain} entry ${head.seq} ${actual ? 'differs from' : 'is missing since'} the checkpoint`);
      }
    }
    console.log(`${files.length} checkpoint(s) checked`);
  }

  problems.forEach((p) => console.error(`PROBLEM ${p}`));
  console.log(problems.length ? `FAIL: ${problems.length} problem(s)` : 'PASS: audit chains intact');
  process.exitCode = problems.length ? 1 : 0;
}

main().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => sequelize.close());
