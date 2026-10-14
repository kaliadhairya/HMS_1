// The hospital's calendar day (migration 0096, utils/serviceDate.js). Between
// 00:00 and 05:30 IST the UTC date is still yesterday; before the fix a token
// or appointment issued then was on a different "today" than the doctor's
// queue. To prove it at any hour, a second server runs with a facility time
// zone whose date differs from the UTC date right now.
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const { sql, runner, assert, sleep, creds, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const BACKEND = path.join(__dirname, '../backend');
const PORT = process.env.E2E_SECOND_PORT || '15103';
const BASE = `http://127.0.0.1:${PORT}/api`;
// A zone whose calendar date differs from UTC's at this moment.
const hour = new Date().getUTCHours();
const ZONE = hour >= 10 ? 'Pacific/Kiritimati' : 'Pacific/Pago_Pago';
const facilityDay = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const utcDay = new Date().toISOString().slice(0, 10);

async function call(method, url, token, body) {
  const res = await fetch(BASE + url, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
}
async function login(role) {
  const [username, password] = creds(role);
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Auth-Transport': 'bearer' }, body: JSON.stringify({ username, password }) });
  return (await r.json()).token;
}

(async () => {
  const { step, done } = runner('Hospital date');
  let child;
  try {
    await step('SQL gives the hospital day of stored UTC times, changing at 18:30 UTC for India', async () => {
      const [r] = await sql(`SELECT hms_service_date('2026-10-13 18:29:59'::timestamp)::text AS before, hms_service_date('2026-10-13 18:30:00'::timestamp)::text AS after,
        hms_service_date('2026-10-13 23:59:00'::timestamp)::text AS early_morning`);
      assert(r.before === '2026-10-13' && r.after === '2026-10-14' && r.early_morning === '2026-10-14', JSON.stringify(r));
    });

    await step(`A token issued on the hospital's day (${ZONE}: ${facilityDay}, UTC: ${utcDay}) is the one the doctor's visit picks up`, async () => {
      assert(facilityDay !== utcDay, 'the chosen zone must differ from UTC now');
      child = spawn('node', ['server.js'], { cwd: BACKEND, stdio: 'ignore',
        env: { ...process.env, PORT, FACILITY_TZ: ZONE, AUDIT_SEALER: 'off', AUDIT_CHECKPOINT_DIR: '', AUDIT_WORM_BUCKET: '', DOWNTIME_KIT_DIR: '', DEVICE_MLLP: 'off', INTERFACE_WORKER: 'off', TZ: 'UTC' } });
      for (let i = 0; i < 60; i++) { try { if ((await fetch(`${BASE}/ready`)).ok) break; } catch { /* starting */ } await sleep(500); }
      const desk = await login('receptionist');
      const doctor = await login('doctor');
      const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
      const tag = crypto.randomUUID().slice(0, 6);
      const [p] = await sql("INSERT INTO hms_patients (name, uhid, patienttype, age, gender, opdindoor, testdate) VALUES ($1, $2, 'other', 30, 'Female', 'OPD', CURRENT_DATE) RETURNING id", [`Synthetic early morning ${tag}`, `EARLY-${tag}`]);
      const tok = await call('POST', '/hms/tokens', desk, { patient_id: p.id, doctor_id: doc.id });
      assert(tok.status === 200 || tok.status === 201, `token ${tok.status} ${JSON.stringify(tok.data)}`);
      const [t] = await sql("SELECT id, to_char(token_date, 'YYYY-MM-DD') AS d FROM hms_tokens WHERE patient_id = $1", [p.id]);
      assert(t.d === facilityDay, `token dated ${t.d}, hospital day ${facilityDay}`);
      const enc = await call('POST', '/hms/encounters', doctor, { patient_id: p.id });
      const encounterId = enc.data?.id ?? enc.data?.data?.id;
      assert(encounterId, `encounter ${enc.status} ${JSON.stringify(enc.data)}`);
      const [e] = await sql('SELECT token_id FROM hms_encounters WHERE id = $1', [encounterId]);
      assert(Number(e.token_id) === Number(t.id), `the visit did not pick up today's token (token_id ${e.token_id})`);
      const today = await call('GET', '/patients/hms/today-patients', desk);
      assert((today.data.data || today.data).some((x) => Number(x.id ?? x.ID) === p.id), "the patient is missing from today's patients");
    });
  } finally {
    if (child) child.kill();
  }
  done();
  process.exit();
})();
