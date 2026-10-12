// Verifies the audit hash chains (migration 0006) and, optionally, signed
// checkpoints written by the server. Exit code 1 when anything is wrong.
//
//   node scripts/audit-verify.js                         chains only
//   AUDIT_CHECKPOINT_KEY=... node scripts/audit-verify.js <checkpoint-dir>
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const { CHAINS, sealOnce } = require('../utils/auditSealer');

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

  const dir = process.argv[2];
  if (dir) {
    const key = process.env.AUDIT_CHECKPOINT_KEY;
    if (!key) throw new Error('AUDIT_CHECKPOINT_KEY is required to check checkpoints');
    const files = fs.readdirSync(dir).filter((f) => f.startsWith('audit-checkpoint-') && f.endsWith('.json')).sort();
    for (const file of files) {
      const { signature, ...body } = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      const expected = crypto.createHmac('sha256', key).update(JSON.stringify(body)).digest('hex');
      if (signature !== expected) { problems.push(`${file}: signature does not match`); continue; }
      for (const head of body.heads) {
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
