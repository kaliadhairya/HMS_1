// Test-only: gives the synthetic doctor and laboratory accounts verified professional
// credentials and practitioner records, so suites that grant clinical privileges
// through the API can run on a throwaway database. Never used on a shared database.
const { sql, requireThrowawayDb, syntheticClinician } = require('../helpers');

(async () => {
  requireThrowawayDb();
  for (const [username, role] of [['doctor', 'doctor'], ['labtech', 'lab_technician'], ['nurse', 'nurse'], ['pharmacist', 'pharmacist']]) {
    const [u] = await sql('SELECT id FROM hms_users WHERE username = $1', [username]);
    if (u) await syntheticClinician(u.id, role);
  }
  console.log('clinician fixture applied');
  process.exit(0);
})().catch((err) => { console.error(`clinician fixture failed: ${err.message}`); process.exit(1); });
