// Read-only cutover rehearsal: report opaque IDs, never medicine names/patient text.
const assert = require("node:assert/strict");
const { Client } = require("pg");
assert.equal(
  process.env.HMS_TEST_DATABASE,
  "true",
  "Explicit rehearsal opt-in is required",
);
assert.match(
  process.env.DB_NAME || "",
  /^hms_p3_/,
  "Use a Phase 3 backup rehearsal database",
);
const db = new Client({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});
(async () => {
  await db.connect();
  try {
    const { rows } = await db.query(`SELECT id,
   nullif(trim(generic_name),'') IS NULL AS blank_identity,
   is_controlled IS NULL AS missing_control_classification,
   CASE WHEN strength ~ '^[0-9]+(\\.[0-9]+)?$' THEN
     strength::numeric>=1000000000000 OR strength::numeric<>round(strength::numeric,6)
     ELSE false END AS unsupported_numeric_strength
 FROM hms_medicines WHERE nullif(trim(generic_name),'') IS NULL OR is_controlled IS NULL
 OR CASE WHEN strength ~ '^[0-9]+(\\.[0-9]+)?$' THEN
   strength::numeric>=1000000000000 OR strength::numeric<>round(strength::numeric,6) ELSE false END
 ORDER BY id`);
    console.log(
      JSON.stringify(
        {
          database: process.env.DB_NAME,
          checked: "legacy identities before migration 0030",
          blocking_count: rows.length,
          opaque_reconciliation_items: rows,
        },
        null,
        2,
      ),
    );
    if (rows.length) process.exitCode = 1;
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.code || "PREFLIGHT_FAILED");
  process.exitCode = 1;
});
