// Run the original Phase 1 failure suite without editing another phase's file.
// Only its database-name guard is narrowed to the Phase 3 throwaway namespace.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
assert.equal(
  process.env.HMS_TEST_DATABASE,
  "true",
  "Explicit test-database opt-in is required",
);
assert.match(
  process.env.DB_NAME || "",
  /^hms_p3_/,
  "Use a Phase 3 throwaway database",
);
const original = path.join(__dirname, "../tests/phase1.integration.test.js");
const source = fs.readFileSync(original, "utf8");
const guard = "/^hms_(phase1|test|ci|verify)/";
assert.equal(
  source.split(guard).length,
  2,
  "The original guard changed; review the harness before running",
);
const temporary = path.join(
  __dirname,
  `../tests/phase3-foundation-${process.pid}.cjs`,
);
try {
  fs.writeFileSync(temporary, source.replace(guard, "/^hms_p3_/"), {
    flag: "wx",
    mode: 0o600,
  });
  const result = spawnSync(process.execPath, ["--test", temporary], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
}
