// Opens a downtime kit without the application (Phase 6I). Run on the ward
// machine that holds the kit:
//   DOWNTIME_KIT_KEY=<64 hex> node scripts/downtime-open.js [kit-file] [out.html]
// Default kit: $DOWNTIME_KIT_DIR/downtime-latest.hmskit.json. Writes a
// printable HTML file (default: next to the kit) and stamps it STALE in large
// letters if it is older than its refresh window. The file is plain text once
// written: print it and delete it after use.
const fs = require('fs');
const path = require('path');
const { decryptKit } = require('../services/downtime');

const file = process.argv[2] || path.join(process.env.DOWNTIME_KIT_DIR || '.', 'downtime-latest.hmskit.json');
const key = process.env.DOWNTIME_KIT_KEY;
if (!/^[0-9a-f]{64}$/i.test(key || '')) { console.error('Set DOWNTIME_KIT_KEY (64 hex characters).'); process.exit(2); }
let kit;
try { kit = decryptKit(JSON.parse(fs.readFileSync(file, 'utf8')), key); } catch (err) { console.error(`Cannot open ${file}: ${err.message}`); process.exit(1); }
const now = process.env.DOWNTIME_OPEN_AT ? new Date(process.env.DOWNTIME_OPEN_AT) : new Date();
const stale = now > new Date(kit.meta.stale_after);
const banner = stale
  ? `<div style="font:bold 28px sans-serif;border:6px solid #000;padding:12px;margin-bottom:12px">STALE — made ${kit.meta.generated_at}, more than its refresh window ago. Confirm everything with the ward record.</div>`
  : '';
const html = kit.html.replace('<body>', `<body>${banner}`);
const out = process.argv[3] || file.replace(/\.hmskit\.json$/, '.html');
fs.writeFileSync(out, html, { mode: 0o600 });
console.log(`${stale ? 'STALE' : 'CURRENT'}: summary made ${kit.meta.generated_at}; written to ${out}`);
