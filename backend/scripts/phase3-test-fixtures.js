// Supply deterministic inpatient capacity in the isolated restored test copy.
// Never changes an existing patient/admission or an occupied bed.
const assert = require("node:assert/strict"),
  crypto = require("crypto");
const { Client } = require("pg");
assert.equal(process.env.HMS_TEST_DATABASE, "true");
assert.match(process.env.DB_NAME || "", /^hms_p3_/);
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
    const {
      rows: [ward],
    } = await db.query(
      "SELECT id FROM hms_wards WHERE type='Private' AND is_active=1 ORDER BY id LIMIT 1",
    );
    assert(
      ward,
      "The backup needs an existing private ward for the inpatient regression",
    );
    const tag = crypto.randomUUID().slice(0, 8);
    await db.query(
      "INSERT INTO hms_beds(ward_id,room_number,bed_number,status,is_active) VALUES($1,'P3-TEST','P3-'||$2||'-A','Available',1),($1,'P3-TEST','P3-'||$2||'-B','Available',1)",
      [ward.id, tag],
    );
    console.log(
      "Prepared two free synthetic inpatient beds in the Phase 3 throwaway database.",
    );
  } finally {
    await db.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
