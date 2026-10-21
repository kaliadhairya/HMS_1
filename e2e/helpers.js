// Shared helpers for the end-to-end workflow tests.
// Run against a local stack: frontend on E2E_BASE (default http://localhost:4999),
// backend API on E2E_API (default http://localhost:5001/api), PostgreSQL via DB_* env vars.
const path = require('path');
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require(path.join(process.env.NODE_PATH || '', 'playwright'))); }
let Client;
try { ({ Client } = require('pg')); } catch { ({ Client } = require(path.join(__dirname, '..', 'backend', 'node_modules', 'pg'))); }

const BASE = process.env.E2E_BASE || 'http://localhost:4999';
const API = process.env.E2E_API || 'http://localhost:5001/api';

// Default seeded staff accounts; override with E2E_<ROLE>_USER / E2E_<ROLE>_PASS.
const ACCOUNTS = {
  super_admin: ['superadmin', 'Superadmin@123'],
  admin: ['admin', 'Admin@123'],
  doctor: ['doctor', 'Doctor@123'],
  receptionist: ['receptionist', 'Receptionist@123'],
  pharmacist: ['pharmacist', 'Pharmacist@123'],
  nurse: ['nurse', 'Nurse@123'],
  lab_technician: ['labtech', 'Labtech@123'],
};
const creds = (role) => {
  const key = role.toUpperCase();
  const [u, p] = ACCOUNTS[role];
  return [process.env[`E2E_${key}_USER`] || u, process.env[`E2E_${key}_PASS`] || p];
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// API call with retry while the backend restarts (node --watch) — connection errors only.
async function api(method, url, { token, body, headers = {} } = {}) {
  // One key per call, reused by the connection retries below, as the app does.
  const idempotencyKey = require('crypto').randomUUID();
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(API + url, {
        method,
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(method !== 'GET' ? { 'idempotency-key': idempotencyKey } : {}),
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      let data; try { data = JSON.parse(text); } catch { data = text; }
      return { status: res.status, data };
    } catch (e) {
      if (attempt === 19) throw e;
      await sleep(500);
    }
  }
}

const tokens = {};
async function apiLogin(role) {
  if (tokens[role]) return tokens[role];
  const [username, password] = creds(role);
  const r = await api('POST', '/auth/login', { body: { username, password }, headers: { 'X-Auth-Transport': 'bearer' } });
  if (!r.data?.token) throw new Error(`API login failed for ${role}: ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
  tokens[role] = r.data.token;
  return r.data.token;
}

// One SQL query against the app database. Column names come back lower-case.
async function sql(text, params = []) {
  const c = new Client({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'hms', user: process.env.DB_USER || 'postgres', password: process.env.DB_PASSWORD || 'postgres',
  });
  await c.connect();
  try { return (await c.query(text, params)).rows; } finally { await c.end(); }
}

// Browser session signed in through the real login form.
async function browserAs(browser, role, { viewport = { width: 1440, height: 900 } } = {}) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|403|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
  const [username, password] = creds(role);
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  return { ctx, page, errors };
}

// Minimal test runner: named steps, pass/fail summary, non-zero exit on failure.
function runner(name) {
  const results = [];
  async function step(title, fn) {
    const t0 = Date.now();
    try { await fn(); results.push({ title, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${title}`); }
    catch (e) {
      results.push({ title, ok: false, err: e.message });
      // E2E_VERBOSE=1 prints the whole message (Playwright names the element it waited for).
      console.log(`  ✗ ${title}\n      ${process.env.E2E_VERBOSE ? String(e.message).split('\n').slice(0, 8).join('\n      ') : String(e.message).split('\n')[0]}`);
    }
  }
  function done() {
    const failed = results.filter((r) => !r.ok);
    console.log(`\n${name}: ${results.length - failed.length}/${results.length} steps passed`);
    process.exitCode = failed.length ? 1 : 0;
    return failed;
  }
  return { step, done };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
const stamp = () => String(Date.now()).slice(-7);


// Puts a doctor on a patient's care team, as the front desk does when a patient
// is queued or booked. Doctors can only open records of patients in their care.
async function inCare(patientId, username = 'doctor') {
  const rec = await apiLogin('receptionist');
  const [u] = await sql('SELECT id FROM hms_users WHERE username = $1', [username]);
  const r = await api('POST', `/patients/hms/${patientId}/care-team`, { token: rec, body: { practitionerUserId: u.id, role: 'consulting' } });
  if (r.status !== 201 && r.status !== 409) throw new Error(`care team for ${username}: ${r.status} ${JSON.stringify(r.data).slice(0, 160)}`);
}

// Suites that write synthetic fixtures straight into the database run only on the
// throwaway databases AGENTS.md allows (never the shared `hms`).
const THROWAWAY_DB = /^(hms_e2e|hms_p\d+_|hms_phase1|hms_test|hms_verify)/;
function requireThrowawayDb() {
  assert(THROWAWAY_DB.test(process.env.DB_NAME || ''), `Use a throwaway database (hms_e2e, hms_p<N>_*, hms_test*, hms_verify*), not "${process.env.DB_NAME || 'hms'}"`);
}

// Throwaway copies only: a clinician created by a test gets a synthetic,
// clearly labelled facility role and privileges (and, unless the test checks
// registrations itself, a synthetic independently verified registration), so
// suites written before the A2 privilege checks can still do clinical work.
// Never a real approval.
async function syntheticClinician(userId, role = 'doctor', { credential = true } = {}) {
  requireThrowawayDb();
  const kind = { doctor: 'medical_registration', nurse: 'nursing_registration', pharmacist: 'pharmacy_registration', lab_technician: 'laboratory_qualification' }[role];
  await sql(`DO $$ DECLARE pr bigint; r uuid; a text; sa int; ad int; BEGIN
    SELECT id INTO sa FROM hms_users WHERE username = 'superadmin'; SELECT id INTO ad FROM hms_users WHERE username = 'admin';
    INSERT INTO hms_practitioners (user_id, display_name) SELECT ${Number(userId)}, coalesce(nullif(btrim(name), ''), username) FROM hms_users WHERE id = ${Number(userId)} ON CONFLICT (user_id) DO NOTHING;
    SELECT id INTO pr FROM hms_practitioners WHERE user_id = ${Number(userId)};
    IF ${credential ? 'true' : 'false'} AND NOT hms_current_professional_credential(${Number(userId)}, '${role}') THEN
      INSERT INTO hms_practitioner_credentials (practitioner_id, kind, identifier, issuing_body, valid_from, verified_by, verified_at, created_by, verification_evidence)
      VALUES (pr, '${kind}', 'SYNTHETIC-E2E-' || ${Number(userId)}, 'Synthetic e2e fixture, not a real registration', current_date - 1, sa, now(), ad,
        jsonb_build_object('reference', 'E2E-SYNTHETIC', 'reason', 'Synthetic throwaway-test credential; not a real approval'));
    END IF;
    INSERT INTO hms_facility_memberships (facility_id, user_id, reason) SELECT hms_initial_facility(), ${Number(userId)}, 'Synthetic throwaway e2e fixture membership'
      WHERE NOT EXISTS (SELECT 1 FROM hms_facility_memberships WHERE user_id = ${Number(userId)} AND facility_id = hms_initial_facility() AND revoked_at IS NULL);
    INSERT INTO hms_practitioner_roles (practitioner_id, facility_id, role, valid_from, valid_until, granted_by_user_id, reason)
      VALUES (pr, hms_initial_facility(), '${role}', now() - interval '1 minute', now() + interval '30 days', sa, 'Synthetic throwaway e2e fixture role') RETURNING id INTO r;
    FOREACH a IN ARRAY ARRAY['CHART_READ', 'PRESCRIBE', 'CLINICAL_SIGN', 'NURSING_DOCUMENT', 'DISPENSE', 'LAB_PROCESS', 'LAB_RELEASE'] LOOP
      IF hms_role_permits_action('${role}', a) THEN
        INSERT INTO hms_clinical_privileges (practitioner_role_id, action, valid_from, valid_until, granted_by_user_id, reason)
        VALUES (r, a, now() - interval '1 minute', now() + interval '30 days', sa, 'Synthetic throwaway e2e fixture privilege');
      END IF;
    END LOOP;
  END $$`);
}

// Docker arguments that run a shell script with the PostgreSQL client tools against the test server
// (createdb, pg_dump, pg_restore, dropdb, psql; connection details from the PG* variables). By
// default the tools run inside the local database container (E2E_PG_CONTAINER, "hms-db"); with
// E2E_PG_TOOLS=network they run in a tools image of the server's version (E2E_PG_IMAGE) over the
// network, which is how CI and a separate PostgreSQL server are reached.
function pgDocker(script) {
  if (process.env.E2E_PG_TOOLS === 'network') {
    const e = process.env;
    return ['run', '--rm', '--network', 'host', '-e', `PGHOST=${e.DB_HOST || '127.0.0.1'}`, '-e', `PGPORT=${e.DB_PORT || 5432}`,
      '-e', `PGUSER=${e.DB_USER || 'postgres'}`, '-e', `PGPASSWORD=${e.DB_PASSWORD || ''}`, e.E2E_PG_IMAGE || 'postgres:18-alpine', 'sh', '-c', script];
  }
  return ['exec', process.env.E2E_PG_CONTAINER || 'hms-db', 'sh', '-c', script];
}

module.exports = { chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, sleep, stamp, creds, inCare, requireThrowawayDb, syntheticClinician, pgDocker };
