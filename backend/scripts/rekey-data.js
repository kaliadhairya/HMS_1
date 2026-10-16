#!/usr/bin/env node
// Re-encrypts stored personal data with the active data key (completion A4).
//
//   node scripts/rekey-data.js            # re-encrypt
//   node scripts/rekey-data.js --dry-run  # only count what would change
//
// Converts values written by the earlier AES-CBC code and values under any
// key other than the active one in HMS_DATA_KEYS. It is safe to stop and run
// again: each value is changed in its own transaction and only values that
// still need it are touched. Rotation: put the new key first in
// HMS_DATA_KEYS, keep the old one listed, run this, check that it reports
// nothing left, then remove the old key.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { QueryTypes } = require('sequelize');
const { sequelize } = require('../models/db');
const keys = require('../services/dataKeys.cts');

const DRY = process.argv.includes('--dry-run');
const BATCH = 200;
const q = (sql, replacements = {}, transaction) => sequelize.query(sql, { replacements, transaction, type: QueryTypes.SELECT });

// Text columns: [table, key column, value column, purpose].
const COLUMNS = [
  ['hms_patients', 'id', 'aadhaar', 'patient.aadhaar'],
  ['hms_abdm_hiu_keys', 'transaction_id', 'private_key_enc', 'abdm.hiu-private-key'],
];

async function rekeyColumn([table, idCol, col, purpose], report) {
  const r = report[`${table}.${col}`] = { checked: 0, rekeyed: 0, unreadable: 0 };
  let after = null;
  for (;;) {
    const rows = await q(`SELECT ${idCol}::text AS id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL ${after === null ? '' : `AND ${idCol}::text > :after`} ORDER BY ${idCol}::text LIMIT ${BATCH}`, { after });
    if (!rows.length) break;
    for (const row of rows) {
      r.checked++;
      if (!keys.needsRekey(row.v)) continue;
      let plain;
      try { plain = keys.decryptText(row.v, purpose); } catch (err) { r.unreadable++; console.error(`${table} ${row.id}: ${err.message}`); continue; }
      if (!DRY) {
        await sequelize.transaction(async (t) => {
          await q(`UPDATE ${table} SET ${col} = :v WHERE ${idCol}::text = :id AND ${col} = :old RETURNING 1`, { v: keys.encryptText(plain, purpose), id: row.id, old: row.v }, t);
        });
      }
      r.rekeyed++;
    }
    after = rows[rows.length - 1].id;
  }
}

async function rekeyDocuments(report) {
  const r = report['hms_patient_documents (files)'] = { checked: 0, rekeyed: 0, unreadable: 0 };
  const dir = process.env.HMS_DOCUMENT_DIR;
  const active = keys.activeKeyId();
  const docs = await q("SELECT id, sha256, storage_key, key_id FROM hms_patient_documents WHERE storage_key IS NOT NULL ORDER BY id");
  for (const d of docs) {
    r.checked++;
    if (d.key_id === active) continue;
    if (!dir) { r.unreadable++; console.error('HMS_DOCUMENT_DIR is not set; documents cannot be re-encrypted'); break; }
    const file = path.join(dir, d.storage_key);
    const purpose = `patient-document:${d.id}:${d.sha256}`;
    let plain;
    try { plain = keys.decryptBlob(fs.readFileSync(file), purpose).plain; } catch (err) { r.unreadable++; console.error(`document ${d.id}: ${err.message}`); continue; }
    if (!DRY) {
      const tmp = `${file}.rekey.${process.pid}`;
      fs.writeFileSync(tmp, keys.encryptBlob(plain, purpose), { mode: 0o600 });
      fs.renameSync(tmp, file); // the new file is complete before it replaces the old one
      await sequelize.transaction((t) => q('UPDATE hms_patient_documents SET key_id = :k WHERE id = :id RETURNING 1', { k: active, id: d.id }, t));
    }
    r.rekeyed++;
  }
}

(async () => {
  keys.assertDataKeys();
  const report = {};
  for (const c of COLUMNS) await rekeyColumn(c, report);
  await rekeyDocuments(report);
  // Outbound messages are never rewritten; their keys are needed until they finish.
  const [pending] = await q(`SELECT count(*)::int AS n FROM hms_interface_messages
    WHERE direction = 'out' AND finished_at IS NULL AND payload->>'text_enc' IS NOT NULL AND payload->>'text_enc' NOT LIKE :prefix`, { prefix: `hk2:${keys.activeKeyId()}:%` });
  report['pending outbound messages under an older key (keep that key until they finish)'] = pending.n;
  console.log(JSON.stringify({ active_key: keys.activeKeyId(), dry_run: DRY, report }, null, 2));
  const left = Object.values(report).some((v) => (typeof v === 'object' ? v.unreadable > 0 : v > 0));
  await sequelize.close();
  process.exit(left ? 1 : 0);
})().catch(async (err) => { console.error(`Re-encryption stopped: ${err.message}`); await sequelize.close().catch(() => {}); process.exit(2); });
