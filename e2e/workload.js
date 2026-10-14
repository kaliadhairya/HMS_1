// Repeatable workload for the stated envelope (completion C3): 200 beds,
// 1,000 OPD visits a day, 200 concurrent users. Runs against a throwaway
// copy only.
//
//   node workload.js --minutes 10 --scale 1 --out report.json [--api-pid N]
//
// Model (scale 1 = the busiest hour):
// - Visits arrive at 1,000/day x peak factor 2 over an 8-hour OPD day
//   (250/hour). Each visit is registration + token (front desk), vitals
//   (nurse), then a consultation opened, a note saved and signed (doctor).
// - Inpatient charting: 200 beds x 6 vital-sign sets a day, spread evenly.
// - 200 signed-in users, by role, each polling their main screen the way
//   the browser does, plus the 5-second event catch-up every page makes.
// - Live-event freshness is measured on listening sockets: time from the
//   committing transaction (occurred_at) to arrival.
// --scale N multiplies every rate to find headroom. Server time is measured
// at the client on the same host, so it includes only loopback overhead.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');
const { io } = require('../frontend/node_modules/socket.io-client');
const { API, sql, creds, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const MINUTES = Number(arg('minutes', 10));
const SCALE = Number(arg('scale', 1));
const OUT = arg('out', `workload-${Date.now()}.json`);
const API_PID = arg('api-pid', null);
const ORIGIN = API.replace(/\/api$/, '');
const USERS = { doctor: 50, nurse: 80, receptionist: 30, lab_technician: 15, pharmacist: 15, admin: 10 };
const ACCOUNTS = { doctor: 20, nurse: 30, receptionist: 8, lab_technician: 5, pharmacist: 5, admin: 4 };
// Seconds between polls of each role's main screen (scale 1).
const POLL = { doctor: 15, nurse: 15, receptionist: 20, lab_technician: 15, pharmacist: 30, admin: 30 };
const CATCH_UP = 5;
const VISITS_PER_HOUR = (1000 * 2) / 8;
const IPD_VITALS_PER_HOUR = (200 * 6) / 24;
const run = crypto.randomUUID().slice(0, 6);
const today = new Date().toISOString().slice(0, 10);

const samples = new Map(); // op -> { kind, ms: [], errors: {status: n} }
function record(op, kind, ms, status) {
  if (!samples.has(op)) samples.set(op, { kind, ms: [], errors: {} });
  const s = samples.get(op);
  if (status >= 200 && status < 300) s.ms.push(ms);
  else s.errors[status] = (s.errors[status] || 0) + 1;
}
async function call(op, kind, method, url, token, body, headers = {}) {
  const started = performance.now();
  let status = 0; let data = null;
  try {
    const res = await fetch(API + url, {
      method,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    status = res.status;
    data = await res.json().catch(() => null);
  } catch { status = 599; }
  record(op, kind, performance.now() - started, status);
  return { status, data };
}
const pct = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null);
const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (seconds) => seconds * 1000 * (0.5 + Math.random());
const exp = (meanSeconds) => -Math.log(1 - Math.random()) * meanSeconds * 1000;
// Waits never run past the end of the run.
let END = Infinity;
const until = (ms) => sleep(Math.max(0, Math.min(ms, END - Date.now())));

async function ensureAccounts() {
  const made = {};
  for (const [role, n] of Object.entries(ACCOUNTS)) {
    const seed = { doctor: 'doctor', nurse: 'nurse', receptionist: 'receptionist', lab_technician: 'lab_technician', pharmacist: 'pharmacist', admin: 'admin' }[role];
    const [username] = creds(seed);
    // Synthetic staff share the seeded account's password hash (throwaway copy only).
    await sql(`INSERT INTO hms_users (username, password, name, role, is_active, first_login, department_id)
      SELECT 'load_' || $2 || '_' || g, u.password, 'Load ' || $2 || ' ' || g, u.role, 1, u.first_login, u.department_id
        FROM hms_users u, generate_series(1, $3) g WHERE u.username = $1
      ON CONFLICT (username) DO NOTHING`, [username, role, n]);
    made[role] = (await sql("SELECT id, username FROM hms_users WHERE username LIKE $1 ORDER BY id", [`load\\_${role}\\_%`])).slice(0, n);
    // Doctors also need a doctor record (department, consulting slots) to take tokens.
    if (role === 'doctor') await sql(`INSERT INTO hms_doctors (user_id, department_id, speciality, consulting_days, slot_start_time, slot_end_time, slot_duration_mins, fee, is_active)
      SELECT u.id, d.department_id, d.speciality, d.consulting_days, d.slot_start_time, d.slot_end_time, d.slot_duration_mins, d.fee, 'Y'
        FROM hms_users u CROSS JOIN (SELECT * FROM hms_doctors WHERE user_id = (SELECT id FROM hms_users WHERE username = $1) ORDER BY id LIMIT 1) d
       WHERE u.username LIKE 'load\\_doctor\\_%' AND NOT EXISTS (SELECT 1 FROM hms_doctors x WHERE x.user_id = u.id)`, [username]);
  }
  return made;
}
async function login(username, password) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Auth-Transport': 'bearer' }, body: JSON.stringify({ username, password }) });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.token) return data.token;
    await sleep(500 * (attempt + 1));
  }
  throw new Error(`login failed for ${username}`);
}

(async () => {
  const accounts = await ensureAccounts();
  const users = [];
  for (const [role, n] of Object.entries(USERS)) {
    const [, password] = creds(role === 'admin' ? 'admin' : role);
    for (let i = 0; i < n; i++) {
      const acct = accounts[role][i % accounts[role].length];
      users.push({ role, id: acct.id, token: await login(acct.username, password), sequence: null });
    }
  }
  const byRole = (role) => users.filter((u) => u.role === role);
  const pick = (role) => { const list = byRole(role); return list[Math.floor(Math.random() * list.length)]; };
  const admissions = (await sql("SELECT id FROM hms_admissions WHERE status = 'Active' ORDER BY id LIMIT 200")).map((r) => r.id);

  // Listening sockets: one per doctor account (each signature notifies its
  // doctor) and one per other role. Event freshness = arrival - commit time.
  const freshness = [];
  const sockets = [];
  const listeners = [...new Map(byRole('doctor').map((u) => [u.id, u])).values(), ...Object.keys(USERS).filter((r) => r !== 'doctor').map(pick)];
  for (const u of listeners) {
    const s = io(ORIGIN, { auth: { token: u.token }, transports: ['websocket'], reconnection: true });
    s.onAny((type, data) => { if (data?.occurred_at) freshness.push(Date.now() - new Date(data.occurred_at).getTime()); });
    sockets.push(s);
  }

  const end = Date.now() + MINUTES * 60000;
  END = end;
  const tasks = [];
  // Screen polling and event catch-up for every signed-in user.
  const screens = {
    doctor: (u) => call('doctor: OPD queue', 'read', 'GET', '/hms/tokens', u.token),
    nurse: (u) => (Math.random() < 0.5 ? call('nurse: worklist', 'read', 'GET', '/worklist', u.token) : call('nurse: inpatients', 'read', 'GET', '/ipd/admissions', u.token)),
    receptionist: (u) => call('front desk: patient search', 'read', 'GET', `/patients/hms/search?q=LOAD`, u.token),
    lab_technician: (u) => call('lab: work queue', 'read', 'GET', '/lab/queue', u.token),
    pharmacist: (u) => call('pharmacy: dashboard', 'read', 'GET', '/dashboard/pharmacist', u.token),
    admin: (u) => call('admin: worklist', 'read', 'GET', '/worklist', u.token),
  };
  for (const u of users) {
    tasks.push((async () => {
      await sleep(Math.random() * POLL[u.role] * 1000 / SCALE);
      while (Date.now() < end) { await screens[u.role](u); await sleep(jitter(POLL[u.role] / SCALE)); }
    })());
    tasks.push((async () => {
      await sleep(Math.random() * CATCH_UP * 1000 / SCALE);
      while (Date.now() < end) {
        const r = await call('every page: event catch-up', 'read', 'GET', `/events${u.sequence == null ? '' : `?after_sequence=${u.sequence}`}`, u.token);
        if (r.status === 200) u.sequence = r.data.next_sequence ?? u.sequence;
        await sleep(jitter(CATCH_UP / SCALE));
      }
    })());
  }

  // One outpatient visit, start to signature.
  let visits = 0; let visitsSigned = 0;
  async function visit(n) {
    const desk = pick('receptionist'); const nurse = pick('nurse'); const doc = pick('doctor');
    const reg = await call('front desk: register patient', 'command', 'POST', '/patients/hms', desk.token, {
      patientType: 'other', name: `LOAD ${run} ${n}`, age: 20 + (n % 60), gender: n % 2 ? 'Male' : 'Female', opdIndoor: 'OPD', testDate: today,
      phoneNumber: String(9000000000 + Math.floor(Math.random() * 999999999)).slice(0, 10),
    });
    const patientId = reg.data?.data?.id ?? reg.data?.id;
    if (!patientId) return;
    const token = await call('front desk: issue token', 'command', 'POST', '/hms/tokens', desk.token, { patient_id: patientId, doctor_id: doc.id });
    if (token.status !== 201 && token.status !== 200) return;
    await sleep(jitter(2));
    await call('nurse: record vitals', 'command', 'POST', '/hms/vitals', nurse.token, { patient_id: patientId, bp_systolic: 120, bp_diastolic: 80, pulse: 76, temperature: 37, spo2: 98 });
    await call('doctor: patient chart', 'read', 'GET', `/patients/hms/${patientId}`, doc.token);
    await call('doctor: latest vitals', 'read', 'GET', `/hms/vitals/latest/${patientId}`, doc.token);
    const enc = await call('doctor: open consultation', 'command', 'POST', '/hms/encounters', doc.token, { patient_id: patientId });
    const encounterId = enc.data?.data?.id ?? enc.data?.id;
    if (!encounterId) return;
    const [{ record_revision: rev }] = await sql('SELECT record_revision FROM hms_encounters WHERE id = $1', [encounterId]);
    await sleep(jitter(3));
    const saved = await call('doctor: save note', 'command', 'PUT', `/hms/encounters/${encounterId}`, doc.token, { chief_complaint: 'Load test visit', hopi: 'Synthetic workload' }, { 'if-match': String(rev) });
    const next = saved.data?.data?.revision ?? Number(rev) + 1;
    const signed = await call('doctor: sign consultation', 'command', 'PATCH', `/hms/encounters/${encounterId}/finalize`, doc.token, {}, { 'if-match': String(next) });
    if (signed.status === 200) visitsSigned++;
    // About one visit in ten ends in an admission request, which alerts the nurses.
    if (signed.status === 200 && Math.random() < 0.1) {
      await call('doctor: request admission', 'command', 'POST', '/ipd/requests', doc.token, { patientId, reasonForAdmission: 'Load test observation', primaryDiagnosis: 'Synthetic', wardPreference: 'General Ward', urgencyLevel: 'Routine' });
    }
  }
  tasks.push((async () => {
    let n = 0;
    while (Date.now() < end) {
      await until(exp(3600 / (VISITS_PER_HOUR * SCALE)));
      if (Date.now() >= end) break;
      visits++; tasks.push(visit(++n).catch(() => {}));
    }
  })());
  if (admissions.length) tasks.push((async () => {
    while (Date.now() < end) {
      await until(exp(3600 / (IPD_VITALS_PER_HOUR * SCALE)));
      if (Date.now() >= end) break;
      await call('nurse: inpatient vitals', 'command', 'POST', '/ipd/vitals', pick('nurse').token, { admissionId: admissions[Math.floor(Math.random() * admissions.length)], pulse: 80 });
    }
  })());

  // Backlog and resource observations every 5 seconds.
  const observations = [];
  const cpuTicks = () => { try { const f = fs.readFileSync(`/proc/${API_PID}/stat`, 'utf8').split(') ')[1].split(' '); return Number(f[11]) + Number(f[12]); } catch { return null; } };
  const rssMb = () => { try { return Number(/VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${API_PID}/status`, 'utf8'))[1]) / 1024; } catch { return null; } };
  const hz = Number(execFileSync('getconf', ['CLK_TCK']).toString().trim()) || 100;
  let lastTicks = cpuTicks(); let lastAt = Date.now();
  const observer = setInterval(async () => {
    try {
      const [o] = await sql(`SELECT count(*) FILTER (WHERE delivery_sequence IS NULL)::int AS unsequenced, count(*) FILTER (WHERE delivered_at IS NULL)::int AS undelivered,
        COALESCE(EXTRACT(EPOCH FROM now() - min(created_at) FILTER (WHERE delivered_at IS NULL)), 0)::float AS oldest_undelivered_s FROM hms_outbox WHERE created_at > now() - interval '1 hour'`);
      const [db] = await sql("SELECT count(*) FILTER (WHERE state = 'active')::int AS active, count(*)::int AS connections FROM pg_stat_activity WHERE datname = current_database()");
      const ticks = cpuTicks(); const now = Date.now();
      const cpu = ticks != null && lastTicks != null ? ((ticks - lastTicks) / hz) / ((now - lastAt) / 1000) * 100 : null;
      lastTicks = ticks; lastAt = now;
      observations.push({ at: new Date().toISOString(), ...o, db_active: db.active, db_connections: db.connections, api_cpu_pct: round(cpu), api_rss_mb: round(rssMb()) });
    } catch { /* observation is best-effort */ }
  }, 5000);

  await Promise.all(tasks.slice());
  await sleep(3000);
  await Promise.allSettled(tasks);
  clearInterval(observer);
  sockets.forEach((s) => s.close());

  const ops = [...samples.entries()].map(([op, s]) => {
    const sorted = s.ms.slice().sort((a, b) => a - b);
    const errors = Object.values(s.errors).reduce((a, b) => a + b, 0);
    return { op, kind: s.kind, ok: sorted.length, errors, error_detail: s.errors, p50: round(pct(sorted, 50)), p90: round(pct(sorted, 90)), p95: round(pct(sorted, 95)), p99: round(pct(sorted, 99)), max: round(sorted[sorted.length - 1]) };
  }).sort((a, b) => a.kind.localeCompare(b.kind) || a.op.localeCompare(b.op));
  const fr = freshness.slice().sort((a, b) => a - b);
  const total = ops.reduce((a, o) => a + o.ok + o.errors, 0);
  const report = {
    run, started_minutes: MINUTES, scale: SCALE, users: users.length, visits_started: visits, visits_signed: visitsSigned,
    requests: total, requests_per_second: round(total / (MINUTES * 60)),
    targets: { read_p95_ms: 250, command_p95_ms: 500, event_p95_ms: 2000 },
    ops,
    event_freshness_ms: { n: fr.length, p50: pct(fr, 50), p95: pct(fr, 95), p99: pct(fr, 99), max: fr[fr.length - 1] ?? null },
    backlog: {
      max_undelivered: Math.max(0, ...observations.map((o) => o.undelivered)),
      max_oldest_undelivered_s: round(Math.max(0, ...observations.map((o) => o.oldest_undelivered_s))),
      max_db_active: Math.max(0, ...observations.map((o) => o.db_active)), max_db_connections: Math.max(0, ...observations.map((o) => o.db_connections)),
      api_cpu_pct_p95: pct(observations.map((o) => o.api_cpu_pct).filter((v) => v != null).sort((a, b) => a - b), 95),
      api_rss_mb_max: Math.max(0, ...observations.map((o) => o.api_rss_mb || 0)),
    },
    environment: {
      host_cpus: os.cpus().length, host_cpu_model: os.cpus()[0]?.model, host_mem_gb: round(os.totalmem() / 2 ** 30), node: process.version,
      postgres: (await sql('SHOW server_version'))[0].server_version, database: process.env.DB_NAME, api_processes: 1,
    },
    observations,
  };
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  const line = (o) => `${o.kind.padEnd(8)} ${o.op.padEnd(32)} n=${String(o.ok).padStart(5)} err=${String(o.errors).padStart(3)} p50=${o.p50} p95=${o.p95} p99=${o.p99} max=${o.max}`;
  console.log(`scale ${SCALE}, ${MINUTES} min, ${users.length} users, ${report.requests_per_second} req/s, visits ${visits} (${visitsSigned} signed)`);
  ops.forEach((o) => console.log(line(o)));
  console.log(`event freshness ms: ${JSON.stringify(report.event_freshness_ms)}`);
  console.log(`backlog: ${JSON.stringify(report.backlog)}`);
  process.exit();
})().catch((err) => { console.error(err); process.exit(1); });
