// Blueprint 5.3: fifty real HTTP contenders and PostgreSQL transactions.
const crypto = require('node:crypto');
const { api, apiLogin, sql, runner, assert, requireThrowawayDb } = require('./helpers');
requireThrowawayDb();
const { step, done } = runner('Clinical bed concurrency');
const tag = crypto.randomUUID().slice(0, 8);
(async () => {
  const admin = await apiLogin('admin');
  let bed, patients, doctor;
  await step('Prepare one ready bed and fifty distinct synthetic patients', async () => {
    const [ward] = await sql("SELECT id FROM hms_wards WHERE type='General' AND is_active=1 ORDER BY id LIMIT 1");
    assert(ward, 'No general ward fixture');
    const response = await api('POST', '/ipd/beds', { token: admin, body: { wardId: ward.id, roomNumber: `RACE-${tag}`, bedPrefix: `RACE-${tag}`, count: 1 } });
    assert(response.status === 201 || response.status === 200, `bed creation ${response.status}`);
    bed = response.data.data[0].ID ?? response.data.data[0].id;
    [doctor] = await sql("SELECT id FROM hms_users WHERE username='doctor'");
    patients = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) SELECT 'Synthetic bed race ' || $1 || '-' || n, 'RACE-' || $1 || '-' || n, 'other',30,'Other','OPD',hms_service_today() FROM generate_series(1,50) n RETURNING id", [tag]);
    assert(patients.length === 50 && bed, 'race fixture incomplete');
  });
  await step('Exactly one of fifty simultaneous admissions may allocate the bed', async () => {
    const responses = await Promise.all(patients.map((patient) => api('POST', '/ipd/admissions', {
      token: admin, body: { patientId: patient.id, bedId: bed, admittingDoctorId: doctor.id, department: 'General', admissionType: 'Routine' },
    })));
    const winners = responses.filter((r) => r.status === 201);
    assert(winners.length === 1, `winning admissions ${winners.length}; statuses ${responses.map((r) => r.status)}`);
    assert(responses.every((r) => r.status === 201 || r.status === 409), `unexpected race response ${responses.filter((r) => ![201,409].includes(r.status)).map((r) => JSON.stringify(r.data)).join('; ')}`);
    const [occupancy] = await sql('SELECT count(*)::int AS n FROM hms_bed_occupancies WHERE bed_id=$1 AND ends_at IS NULL', [bed]);
    const [admission] = await sql("SELECT count(*)::int AS n FROM hms_admissions WHERE bed_id=$1 AND status='Active'", [bed]);
    const [physical] = await sql('SELECT status FROM hms_beds WHERE id=$1', [bed]);
    assert(occupancy.n === 1 && admission.n === 1 && physical.status === 'Occupied', 'physical bed, admission and occupancy projections diverged');
  });
  done(); process.exit();
})().catch((error) => { console.error(error.message); process.exit(1); });
