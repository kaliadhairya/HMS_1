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
      // Once per facility where this dedicated account is a current member,
      // with that facility bound (A2: workers need an explicit facility context).
      const facilities = await C.q(
        `SELECT f.id, f.timezone FROM hms_facility_memberships m JOIN hms_facilities f ON f.id = m.facility_id
          WHERE m.user_id = :id AND f.status = 'ACTIVE' AND m.revoked_at IS NULL AND m.valid_from <= now()
            AND (m.valid_until IS NULL OR m.valid_until > now()) ORDER BY f.id`,
        { id: userId },
      );
      C.check(facilities.length, "FACILITY_MEMBERSHIP_REQUIRED", "The worker account has no current facility membership.");
      for (const f of facilities) {
        const actor = { ...user, facilityId: f.id, facilityTimezone: f.timezone };
        await storage.run(
          { userId, requestId: crypto.randomUUID(), sessionId: null, facilityId: f.id, facilityTimezone: f.timezone },
          () =>
            C.sequelize.transaction(async (tx) => {
              await C.privilege(actor, "TECHNICAL_REVIEW", tx);
              await F.advance(actor, tx);
            }),
        );
      }
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
