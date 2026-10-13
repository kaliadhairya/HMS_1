// Run against an already migrated, private Phase 4 backend/frontend stack.
// Store logs outside the repository; every suite must pass. Audit runs last
// because it deliberately rewrites history to prove checkpoint detection.
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const { spawnSync } = require("node:child_process");
assert.equal(
  process.env.HMS_TEST_DATABASE,
  "true",
  "Explicit test-database opt-in is required",
);
assert.match(
  process.env.DB_NAME || "",
  /^hms_p4_/,
  "Use a Phase 4 throwaway database",
);
assert.equal(
  new URL(process.env.E2E_API).port,
  "5022",
  "Use the isolated Phase 4 API",
);
assert.equal(
  new URL(process.env.E2E_BASE).port,
  "5194",
  "Use the isolated Phase 4 frontend",
);
const root = path.resolve(__dirname, "../..");
const evidence =
  process.env.PHASE4_EVIDENCE_DIR ||
  fs.mkdtempSync(path.join(os.tmpdir(), "hms-phase4-evidence-"));
fs.mkdirSync(evidence, { recursive: true, mode: 0o700 });
const suites = [
  ["backend-unit", "backend", "npm", ["test"], { HMS_TEST_DATABASE: "false" }],
  [
    "phase1-foundation",
    "backend",
    process.execPath,
    ["scripts/verify-phase4-foundation.js"],
  ],
  ...[
    "laboratory",
    "laboratoryGuards",
    "laboratoryWorker",
    "laboratoryFrontend",
    "medication",
    "medicationGuards",
    "medicationFrontend",
    "pharmacy",
    "opd",
    "lab",
    "ipd",
    "admin",
    "authorization",
    "sessions",
    "idempotency",
    "durability",
    "frontendReliability",
    "ipdDrafts",
    "patientIdentity",
    "patientMerge",
    "practitioners",
    "scheduling",
    "careTeam",
    "triage",
    "clinicalDocuments",
    "adt",
    "referrals",
    "audit",
  ].map((name) => [name, "e2e", process.execPath, [name + ".e2e.js"]]),
];
const summary = {
  started_at: new Date().toISOString(),
  database: process.env.DB_NAME,
  branch: "phase4/laboratory",
  suites: [],
};
for (const [name, folder, executable, args, extra] of suites) {
  const logPath = path.join(evidence, name + ".log"),
    fd = fs.openSync(logPath, "w", 0o600),
    start = Date.now();
  const result = spawnSync(executable, args, {
    cwd: path.join(root, folder),
    env: { ...process.env, ...extra },
    stdio: ["ignore", fd, fd],
  });
  fs.closeSync(fd);
  const entry = {
    name,
    exit_code: result.status ?? 1,
    duration_ms: Date.now() - start,
    log_file: name + ".log",
  };
  const output = fs.readFileSync(logPath, "utf8"),
    match = output.match(/(\d+)\/(\d+) steps passed/);
  if (match) {
    entry.passed = Number(match[1]);
    entry.total = Number(match[2]);
  }
  summary.suites.push(entry);
  console.log(
    `${name}: ${entry.exit_code === 0 ? "PASS" : "FAIL"}${match ? " " + match[1] + "/" + match[2] : ""}`,
  );
  if (result.error) console.error(result.error.message);
  fs.writeFileSync(
    path.join(evidence, "summary.json"),
    JSON.stringify(summary, null, 2) + "\n",
    { mode: 0o600 },
  );
}
summary.finished_at = new Date().toISOString();
summary.passed = summary.suites.every((s) => s.exit_code === 0);
fs.writeFileSync(
  path.join(evidence, "summary.json"),
  JSON.stringify(summary, null, 2) + "\n",
  { mode: 0o600 },
);
console.log("Evidence directory: " + evidence);
process.exitCode = summary.passed ? 0 : 1;
