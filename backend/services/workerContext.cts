// Facility context for background work (A2 rule: workers need an explicit,
// approved facility context; an empty context sees no facility-owned rows
// through the runtime identity's row policies).
//
// HMS_WORKER_USER_ID names the service account the hospital approved for
// background work; it needs a current membership of each facility it works
// for. forEachFacility() runs only for its current approved memberships.
// Missing identity or membership fails closed, including development with
// an owner connection; it never silently substitutes the initial facility.
const { sequelize } = require('../models/db');
const { storage } = require('../utils/auditContext');

const workerUser = (): number | null => {
  const id = Number(process.env.HMS_WORKER_USER_ID || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

async function facilities(): Promise<Array<{ id: string; timezone: string }>> {
  const user = workerUser();
  if (!user) throw new Error('HMS_WORKER_USER_ID must identify an approved active worker account');
  const rows = await sequelize.query(`SELECT f.id, f.timezone FROM hms_facilities f
    JOIN hms_facility_memberships m ON m.facility_id=f.id JOIN hms_users u ON u.id=m.user_id
    WHERE m.user_id=:user AND u.is_active=1 AND f.status='ACTIVE' AND m.revoked_at IS NULL
      AND m.valid_from<=now() AND (m.valid_until IS NULL OR m.valid_until>now()) ORDER BY f.id`,
    { type: 'SELECT', replacements: { user } });
  if (!rows.length) throw new Error('The worker account has no current approved facility memberships');
  return rows;
}

// Runs fn(facilityId) once per active facility, each in that facility's context.
async function forEachFacility(label: string, fn: (facilityId: string) => Promise<unknown>): Promise<void> {
  const user = workerUser();
  for (const f of await facilities()) {
    const context = { requestId: `worker-${label}-${Date.now()}`, userId: user, sessionId: null, facilityId: f.id, facilityTimezone: f.timezone };
    await storage.run(context, () => fn(f.id));
  }
}

module.exports = { forEachFacility, workerUser, facilities };
