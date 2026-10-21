// Shared row helpers for inpatient commands (used by the legacy routes and the discharge command).
const { sequelize } = require('../models');

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const posInt = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const refusal = (status, message, code) => Object.assign(new Error(message), { status, code });

async function nextId(seq, table, transaction) {
  const [[row]] = await sequelize.query(
    `SELECT nextval('${seq}') AS "SEQ", (SELECT COALESCE(MAX(ID), 0) FROM ${table}) AS "MAX_ID"`,
    { transaction },
  );
  const seqVal = Number(row.SEQ ?? row.seq);
  const maxId = Number(row.MAX_ID ?? row.max_id);
  if (seqVal > maxId) return seqVal;
  const [[fixed]] = await sequelize.query(`SELECT setval('${seq}', :next) AS "ID"`, { replacements: { next: maxId + 1 }, transaction });
  return Number(fixed.ID ?? fixed.id);
}

// Admission row (raw, both key cases), optionally locked for the rest of the transaction.
async function findAdmission(id, transaction, lock = false) {
  if (!posInt(id)) return null;
  const [rows] = await sequelize.query(
    `SELECT * FROM HMS_ADMISSIONS WHERE ID = :id${lock ? ' FOR UPDATE' : ''}`,
    { replacements: { id: Number(id) }, transaction },
  );
  return rows[0] || null;
}

module.exports = { text, posInt, refusal, nextId, findAdmission };
