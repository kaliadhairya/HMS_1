// Load a terminology release file from the server's disk (large files such
// as SNOMED CT or LOINC). The release is recorded as loaded by the named
// administrator, with the file's checksum; an administrator then activates
// it in Settings → Terminology. Usage:
//   node scripts/terminology-load.js --system ICD10 --version "WHO 2019" \
//     --format tsv --file icd10.tsv --source "Where the file came from" \
//     --licence "Who accepted which licence, and when" --user admin [--released-on 2019-01-01]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sequelize } = require('../models/db');
const { storage, bindAuditActor } = require('../utils/auditContext');
const T = require('../services/terminology');

// Row changes are attributed to the administrator named below (audit log).
bindAuditActor(sequelize);

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const need = ['system', 'version', 'format', 'file', 'source', 'licence', 'user'];
const missing = need.filter((k) => !args[k]);
if (missing.length) { console.error(`Missing: ${missing.map((k) => `--${k}`).join(' ')}`); process.exit(2); }

(async () => {
  const [user] = await sequelize.query("SELECT id, role FROM hms_users WHERE username = :u AND is_active = 1", { replacements: { u: args.user }, type: 'SELECT' });
  if (!user || !['super_admin', 'admin'].includes(user.role)) throw new Error(`${args.user} is not an active administrator.`);
  const buffer = fs.readFileSync(args.file);
  const release = await storage.run({ requestId: crypto.randomUUID(), userId: user.id, sessionId: null }, () => sequelize.transaction((t) => T.loadRelease({
    system: args.system, version: args.version, releasedOn: args['released-on'] || null, source: args.source, licenceAck: args.licence,
    fileName: path.basename(args.file), format: args.format, buffer, user,
  }, t)));
  console.log(`Loaded ${args.system} ${release.version}: ${release.concept_count} concepts, sha256 ${release.file_sha256}. Status: ${release.status} (activate it in Settings → Terminology).`);
})().catch((err) => { console.error(err.message); process.exitCode = 1; }).finally(() => sequelize.close());
