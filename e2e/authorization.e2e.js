// Negative authorization: every endpoint that used to accept any signed-in
// user now refuses the roles that have no screen using it (403), and still
// admits the roles that do. Refusals happen before the handler runs, so
// write endpoints are safe to probe.
const { api, apiLogin, sql, runner, assert } = require('./helpers');

const SA = 'super_admin', A = 'admin', D = 'doctor', N = 'nurse', R = 'receptionist', P = 'pharmacist', L = 'lab_technician';
const ALL = [SA, A, D, N, R, P, L];
const DESK = [SA, A, D, N, R];
const CHART = [SA, A, D, N, R, L];

// [method, path template, roles allowed]
const RULES = [
  ['POST', '/patients', [SA, A, R, L]],
  ['GET', '/patients', CHART],
  ['POST', '/patients/hms', [SA, D, R]],
  ['GET', '/patients/hms/emp/E0', CHART],
  ['GET', '/patients/hms/search?q=a', DESK],
  ['GET', '/patients/hms/today-patients', DESK],
  ['GET', '/patients/hms/pending-consultation', DESK],
  ['GET', '/patients/hms/{patient}', DESK],
  ['GET', '/patients/hms/{patient}/visits', CHART],
  ['GET', '/patients/hms/{patient}/documents', CHART],
  ['GET', '/patients/hms/{patient}/allergies', ALL],
  ['GET', '/patients/hms/{patient}/chronic-conditions', CHART],
  ['POST', '/patients/hms/{patient}/allergies', DESK],
  ['POST', '/patients/hms/{patient}/chronic-conditions', DESK],
  ['PUT', '/patients/{patient}', [SA, A, R, L]],
  ['GET', '/patients/search?q=a', ALL],
  ['GET', '/patients/{patient}', ALL],
  ['GET', '/reports/ordered-queue', [SA, A, L]],
  ['GET', '/reports/999999', CHART],
  ['GET', '/medicines/search?q=para', [SA, A, D, N, P]],
  ['GET', '/hms/tokens', [SA, A, D]],
  ['GET', '/hms/tokens/today-all', [SA, A, D, N, R]],
  ['POST', '/hms/tokens', [SA, A, R]],
  ['GET', '/hms/tokens/queue', [SA, A, D, R]],
  ['PATCH', '/hms/tokens/999999/status', [SA, A, D, R]],
  ['POST', '/hms/appointments', [SA, A, D, R]],
  ['GET', '/hms/appointments', [SA, A, D, R]],
  ['PUT', '/hms/appointments/999999', [SA, A, D, R]],
  ['POST', '/hms/vitals', [SA, D, N]],
  ['GET', '/hms/vitals/latest/{patient}', [SA, A, D, N]],
  ['GET', '/hms/vitals/history/{patient}', DESK],
  ['GET', '/hms/departments', ALL],
  ['GET', '/hms/doctors', DESK],
  ['POST', '/hms/doctors', [SA, A]],
  ['GET', '/hms/doctors/{doctorUser}', DESK],
  ['GET', '/hms/rest-forms/doctor', [SA, A, D]],
  ['GET', '/hms/icd10/search?q=fever', [SA, A, D]],
  ['GET', '/pdf/prescription/999999', [SA, A, D, N, P]],
  ['GET', '/pdf/bill/999999', DESK],
  ['GET', '/doctor/prescriptions', [D, SA]],
  ['GET', '/doctor/schedule', [D, SA]],
  ['GET', '/doctor/referrals', [D, SA]],
  ['POST', '/doctor/referrals', [D]],
  ['PUT', '/doctor/referrals/999999', [D]],
  ['DELETE', '/doctor/referrals/999999', [D]],
  ['DELETE', '/doctor/prescriptions/999999', [D]],
  ['GET', '/doctor/clinical-notes', [D, SA]],
  ['GET', '/doctor/list-doctors', CHART],
  // Phase 6A terminology: reading for clinical roles, mapping for those who
  // own local codes, loading and activating releases for administrators.
  ['GET', '/terminology/systems', [SA, A, D, N, P, L]],
  ['GET', '/terminology/search?system=ICD10&q=ab', [SA, A, D, N, P, L]],
  ['GET', '/terminology/mappings', [SA, A, D, N, P, L]],
  ['POST', '/terminology/mappings', [SA, A, D, P, L]],
  ['POST', '/terminology/mappings/00000000-0000-0000-0000-000000000000/review', [SA, A, D, P, L]],
  ['POST', '/terminology/releases', [SA, A]],
  ['POST', '/terminology/releases/00000000-0000-0000-0000-000000000000/activate', [SA, A]],
  // Phase 6B FHIR reads: clinical roles only (patient scope in fhir.e2e.js).
  ['GET', '/fhir/Organization/hospital', [SA, A, D, N, L]],
  // Phase 6 accountable worklist: every staff role sees its own items.
  ['GET', '/worklist', ALL],
];

(async () => {
  const { step, done } = runner('Authorization');
  const tokens = Object.fromEntries(await Promise.all(ALL.map(async (r) => [r, await apiLogin(r)])));
  const [patient] = await sql('SELECT id FROM hms_patients ORDER BY id LIMIT 1');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE role = 'doctor' ORDER BY id LIMIT 1");
  const fill = (p) => p.replace('{patient}', patient.id).replace('{doctorUser}', doctorUser.id);

  await step('Every role outside an endpoint\'s list is refused with 403', async () => {
    const leaks = [];
    for (const [method, template, allowed] of RULES) {
      for (const role of ALL.filter((r) => !allowed.includes(r))) {
        const r = await api(method, fill(template), { token: tokens[role], body: method === 'GET' ? undefined : {} });
        if (r.status !== 403) leaks.push(`${role} ${method} ${template} -> ${r.status}`);
      }
    }
    assert(!leaks.length, `${leaks.length} refusals missing:\n${leaks.join('\n')}`);
  });

  await step('Every role in an endpoint\'s list gets past the role check (reads)', async () => {
    const blocked = [];
    for (const [method, template, allowed] of RULES.filter(([m]) => m === 'GET')) {
      for (const role of allowed) {
        const r = await api(method, fill(template), { token: tokens[role] });
        if (r.status === 401 || r.status === 403) blocked.push(`${role} ${method} ${template} -> ${r.status}`);
      }
    }
    assert(!blocked.length, `${blocked.length} allowed roles were blocked:\n${blocked.join('\n')}`);
  });

  await step('A lab technician can no longer read a patient\'s bills or add allergies', async () => {
    const [bill] = await sql('SELECT id FROM hms_bills ORDER BY id LIMIT 1');
    if (bill) assert((await api('GET', `/pdf/bill/${bill.id}`, { token: tokens[L] })).status === 403, 'lab technician read a bill');
    const before = (await sql('SELECT count(*)::int AS n FROM hms_allergies WHERE patient_id = $1', [patient.id]))[0].n;
    const r = await api('POST', `/patients/hms/${patient.id}/allergies`, { token: tokens[L], body: { allergen: 'Penicillin', severity: 'Severe' } });
    const after = (await sql('SELECT count(*)::int AS n FROM hms_allergies WHERE patient_id = $1', [patient.id]))[0].n;
    assert(r.status === 403 && after === before, `lab technician allergy write: ${r.status}, rows ${before} -> ${after}`);
  });

  await step('An administrator cannot act as a doctor (referral, prescription delete)', async () => {
    for (const role of [SA, A]) {
      assert((await api('POST', '/doctor/referrals', { token: tokens[role], body: {} })).status === 403, `${role} created a referral`);
      assert((await api('DELETE', '/doctor/prescriptions/1', { token: tokens[role] })).status === 403, `${role} deleted a prescription`);
    }
  });

  await step('Signed-out callers get 401, not data', async () => {
    for (const [method, template] of RULES.slice(0, 12)) {
      const r = await api(method, fill(template), { body: method === 'GET' ? undefined : {} });
      assert(r.status === 401, `${method} ${template} without sign-in -> ${r.status}`);
    }
  });

  done();
  process.exit();
})();
