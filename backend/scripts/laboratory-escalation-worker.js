// Dedicated worker, deployed separately from API startup. No clinical deadline
// is invented here: tasks carry immutable approved timetable snapshots.
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const C = require("../services/laboratoryCommon"),
  F = require("../services/laboratoryFollowup");
const { storage, bindAuditActor } = require("../utils/auditContext");
const crypto = require("crypto");
const userId = C.integer(
    process.env.LAB_ESCALATION_WORKER_USER_ID,
    "Worker user",
  ),
  interval = Number(process.env.LAB_ESCALATION_POLL_MS);
C.check(
  Number.isSafeInteger(interval) && interval >= 100 && interval <= 60000,
  "INVALID_POLL_INTERVAL",
  "Set an explicit polling interval between 100 and 60000 ms.",
);
bindAuditActor(C.sequelize);
let stopped = false;
process.on("SIGTERM", () => {
  stopped = true;
});
process.on("SIGINT", () => {
  stopped = true;
});
(async () => {
  try {
    do {
      const user = await C.one(
        "SELECT id,role FROM hms_users WHERE id=:id AND role='lab_technician' AND is_active=1",
        { id: userId },
      );
      C.check(
        user,
        "INVALID_WORKER_IDENTITY",
        "An active dedicated laboratory account is required.",
      );
      await storage.run(
        { userId, requestId: crypto.randomUUID(), sessionId: null },
        () =>
          C.sequelize.transaction(async (tx) => {
            await C.privilege(user, "TECHNICAL_REVIEW", tx);
            await F.advance(user, tx);
          }),
      );
      if (process.env.LAB_ESCALATION_ONCE === "true") break;
      if (!stopped)
        await new Promise((resolve) => setTimeout(resolve, interval));
    } while (!stopped);
  } finally {
    await C.sequelize.close();
  }
})().catch((e) => {
  console.error("Laboratory escalation worker failed:", e.code || e.name);
  process.exitCode = 1;
});
