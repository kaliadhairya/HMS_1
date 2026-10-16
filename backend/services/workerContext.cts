// Facility context for background work (A2 rule: workers need an explicit,
// approved facility context; an empty context sees no facility-owned rows
// through the runtime identity's row policies).
//
// HMS_WORKER_USER_ID names the service account the hospital approved for
// background work; it needs a current membership of each facility it works
// for. forEachFacility() runs the work once per active facility with that
// account and facility bound to the database connection, exactly as a
// request would be. Without the setting (development with the owner
// identity) the work runs as before and a warning says production row
// policies will hide the rows.
const { sequelize } = require('../models/db');
const { storage } = require('../utils/auditContext');

let warned = false;
const workerUser = (): number | null => {
  const id = Number(process.env.HMS_WORKER_USER_ID || 0);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};

async function facilities(): Promise<Array<{ id: string; timezone: string }>> {
  return sequelize.query("SELECT id, timezone FROM hms_facilities WHERE status = 'ACTIVE' ORDER BY id", { type: 'SELECT' });
}

// Runs fn(facilityId) once per active facility, each in that facility's context.
async function forEachFacility(label: string, fn: (facilityId: string) => Promise<unknown>): Promise<void> {
  const user = workerUser();
  if (!user && !warned) {
    warned = true;
    console.warn(`⚠️  HMS_WORKER_USER_ID is not set: background work (${label}) runs without a facility context. With the production (non-owner) database identity, row policies will hide facility records from it.`);
  }
  for (const f of await facilities()) {
    const context = { requestId: `worker-${label}-${Date.now()}`, userId: user, sessionId: null, facilityId: f.id, facilityTimezone: f.timezone };
    await storage.run(context, () => fn(f.id));
  }
}

module.exports = { forEachFacility, workerUser };
