// Administration, front desk and reports workflows, end to end, as the real roles:
// users & access (create, edit, deactivate/activate, sign-in history, change password) -> permission matrix ->
// staff (add/edit/delete, delete blocked by clinical records) -> security centre (failed sign-ins, lockout + unlock,
// end session, IP block list) -> notices, attendance -> settings (hospital profile + letterhead, tariffs,
// departments) -> front desk (visitor pass, notifications, appointments) -> reports (every tab vs SQL, Excel)
// -> admin / super admin / pharmacist dashboard figures vs SQL.
// Only accounts and records created here are changed; seeded accounts are never locked, deactivated or re-passworded.
// Run: cd e2e && NODE_PATH=$(npm root -g) node admin.e2e.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, sleep, stamp, inCare} = require('./helpers');

const { step: runStep, done } = runner('Administration, front desk and reports');
// E2E_ONLY=<regex> runs just the matching steps (for debugging); by default every step runs.
const only = process.env.E2E_ONLY ? new RegExp(process.env.E2E_ONLY) : null;
const step = (title, fn) => (!only || only.test(title) ? runStep(title, fn) : Promise.resolve());

// ── helpers ──────────────────────────────────────────────────────────────────
function noErrors(session, label) {
  const errs = session.errors.splice(0);
  assert(errs.length === 0, `${label}: page errors: ${errs.join(' | ')}`);
}

// Browser session for an account that is not one of the seeded roles (signs in through the real form).
async function loginAs(browser, username, password) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|401|403|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`); });
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' });
  await page.fill('#login-username', username);
  await page.fill('#login-password', password);
  await page.click('button[type=submit]');
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 20000 });
  return { ctx, page, errors };
}

// Login call with an optional client address (the API trusts one proxy hop, as behind nginx).
async function rawLogin(username, password, forwardedFor) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(API + '/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-auth-transport': 'bearer', ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}) },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } catch (e) {
      if (attempt === 19) throw e;
      await sleep(500);
    }
  }
}

async function fetchBinary(url, token) {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const res = await fetch(API + url, { headers: { authorization: `Bearer ${token}` } });
      return { status: res.status, type: res.headers.get('content-type') || '', buf: Buffer.from(await res.arrayBuffer()) };
    } catch (e) {
      if (attempt === 19) throw e;
      await sleep(500);
    }
  }
}

const kpiValue = (page, label) => page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: new RegExp(`^${label}$`) }) }).locator('.kpi-value').first();
async function readKpi(page, label) {
  const loc = kpiValue(page, label);
  await loc.waitFor({ timeout: 15000 });
  for (let i = 0; i < 40; i++) {
    const t = (await loc.innerText()).trim();
    if (t && t !== '—') return t;
    await sleep(250);
  }
  return (await loc.innerText()).trim();
}
const num = (text) => Number(String(text).replace(/[^\d.-]/g, '')) || 0;
const inr = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`;
const money = (v) => Math.round(Number(v || 0) * 100) / 100;

// Toasts render outside an open dialog, where Radix marks the page aria-hidden, so match by attribute, not by role.
async function toast(page, text) {
  await page.locator('[role="status"]', { hasText: text }).first().waitFor({ timeout: 15000 });
}
async function rowMenu(page, label, item) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}
const dialog = (page) => page.getByRole('dialog');

// Compare a figure on screen with the database, re-reading both if another engineer's work moved it meanwhile.
async function settle(label, readUi, readDb, { tries = 4, reload } = {}) {
  let ui; let db;
  for (let i = 0; i < tries; i++) {
    ui = await readUi();
    db = await readDb();
    if (String(ui) === String(db)) return;
    if (reload) await reload();
    else await sleep(500);
  }
  throw new Error(`${label}: screen shows ${ui}, database says ${db}`);
}

const ymd = (d) => d.toISOString().slice(0, 10);

// ── test ─────────────────────────────────────────────────────────────────────
(async () => {
  const S = stamp();
  const PW1 = `E2e#${S}a`;
  const PW2 = `New#${S}b`;
  const ctx = {
    user: { username: `e2e_adm_${S}`, first: 'E2E', last: `Admin ${S}`, name: `E2E Admin ${S}` },
    staff: { username: `e2e_stf_${S}`, name: `E2E Staff ${S}` },
    clin: { username: `e2e_doc_${S}`, name: `E2E Doctor ${S}` },
    patientName: `E2E Admin Patient ${S}`,
  };
  ctx.user.full = `${ctx.user.first} ${ctx.user.last}`;
  const browser = await chromium.launch();
  const restore = {}; // things to put back even if a step fails
  let sa; let ad; let rec;

  try {
    const saTok = await apiLogin('super_admin');
    const adTok = await apiLogin('admin');
    const recTok = await apiLogin('receptionist');
    sa = await browserAs(browser, 'super_admin');
    ad = await browserAs(browser, 'admin');
    rec = await browserAs(browser, 'receptionist');

    // ── 1. Users & access ──────────────────────────────────────────────────
    await step('Users & access: super admin creates a user with a role through the UI', async () => {
      const { page } = sa;
      if (process.env.E2E_DEBUG) page.on('response', async (r) => { if (r.url().includes('/api/') && r.request().method() !== 'GET') console.log('    ', r.request().method(), r.url().replace(API, ''), r.status(), (await r.text().catch(() => '')).slice(0, 160)); });
      await page.goto(`${BASE}/hms/admin/users`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Add user' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#u-username').fill(ctx.user.username);
      await dlg.locator('#u-role').selectOption('receptionist');
      await dlg.locator('#u-name').fill(ctx.user.name);
      await dlg.locator('#u-first').fill(ctx.user.first);
      await dlg.locator('#u-last').fill(ctx.user.last);
      await dlg.locator('#u-phone').fill(`98${S}0`);
      await dlg.locator('#u-password').fill('weakpass');
      await dlg.getByRole('button', { name: 'Create user' }).click();
      await toast(page, 'Password must be min 8 chars');
      await dlg.locator('#u-password').fill(PW1);
      await dlg.getByRole('button', { name: 'Create user' }).click();
      await toast(page, 'User created');
      const [u] = await sql('SELECT id, role, is_active, first_login, password, phone FROM hms_users WHERE username = $1', [ctx.user.username]);
      assert(u, 'user row not created');
      assert(u.role === 'receptionist' && Number(u.is_active) === 1 && u.first_login === 'Y', `row: ${JSON.stringify({ ...u, password: undefined })}`);
      assert(u.password !== PW1 && /^\$2[aby]\$/.test(u.password), 'password is not stored as a bcrypt hash');
      ctx.user.id = u.id;
      // Admins cannot create super admins (privilege escalation).
      const esc = await api('POST', '/users', { token: adTok, body: { username: `e2e_esc_${S}`, password: PW1, name: 'x', role: 'super_admin' } });
      assert(esc.status === 403, `admin created a super admin: ${esc.status}`);
      assert((await sql('SELECT 1 FROM hms_users WHERE username = $1', [`e2e_esc_${S}`])).length === 0, 'escalation user exists');
      noErrors(sa, 'users page');
    });

    await step('Users & access: edit the user (phone and role)', async () => {
      const { page } = sa;
      await page.getByPlaceholder('Search name, username or phone').fill(ctx.user.username);
      await rowMenu(page, `Actions for ${ctx.user.full}`, 'Edit user');
      const dlg = dialog(page);
      await dlg.locator('#u-phone').fill(`97${S}1`);
      await dlg.locator('#u-role').selectOption('pharmacist');
      await dlg.getByRole('button', { name: 'Save changes' }).click();
      await toast(page, 'User updated');
      const [u] = await sql('SELECT role, phone FROM hms_users WHERE id = $1', [ctx.user.id]);
      assert(u.role === 'pharmacist' && u.phone === `97${S}1`, `after edit: ${JSON.stringify(u)}`);
      await page.locator('tbody tr', { hasText: ctx.user.username }).getByText('Pharmacist').waitFor();
      noErrors(sa, 'edit user');
    });

    await step('Users & access: a deactivated user cannot sign in (clear message), a reactivated one can; sign-in history shows the events', async () => {
      const { page } = sa;
      const first = await rawLogin(ctx.user.username, PW1);
      assert(first.status === 200, `first sign-in: ${first.status} ${JSON.stringify(first.data)}`);
      const oldToken = first.data.token;
      await rowMenu(page, `Actions for ${ctx.user.full}`, 'Deactivate');
      await dialog(page).getByRole('button', { name: 'Deactivate' }).click();
      await toast(page, 'User deactivated.');
      assert(Number((await sql('SELECT is_active FROM hms_users WHERE id = $1', [ctx.user.id]))[0].is_active) === 0, 'still active in DB');
      const blocked = await rawLogin(ctx.user.username, PW1);
      assert(blocked.status === 403 && /deactivated/i.test(blocked.data.message), `deactivated sign-in: ${blocked.status} ${blocked.data.message}`);
      const me = await api('GET', '/auth/me', { token: oldToken });
      assert(me.status === 401, `existing token of a deactivated user still works: ${me.status}`);
      const wrong = await rawLogin(ctx.user.username, 'Wrong#Pass1');
      assert(wrong.status === 401 && wrong.data.message === 'Invalid credentials.', `wrong password on deactivated account: ${wrong.status} ${wrong.data.message}`);
      await rowMenu(page, `Actions for ${ctx.user.full}`, 'Activate');
      await toast(page, 'User activated.');
      const back = await rawLogin(ctx.user.username, PW1);
      assert(back.status === 200, `sign-in after reactivation: ${back.status} ${JSON.stringify(back.data)}`);
      await rowMenu(page, `Actions for ${ctx.user.full}`, 'Sign-in history');
      const dlg = dialog(page);
      await dlg.getByText('Signed in').first().waitFor();
      await dlg.getByText('Failed sign-in').first().waitFor();
      await dlg.getByText('account inactive').first().waitFor();
      await page.keyboard.press('Escape');
      const events = await sql(`SELECT action, COUNT(*)::int AS n FROM hms_audit_logs WHERE user_id = $1 AND action IN ('LOGIN','LOGIN_FAILED') GROUP BY action`, [ctx.user.id]);
      const n = Object.fromEntries(events.map((e) => [e.action, e.n]));
      assert(n.LOGIN >= 2 && n.LOGIN_FAILED >= 2, `audit events: ${JSON.stringify(n)}`);
      // Super admins cannot be changed by an admin, and nobody can switch off their own account.
      const self = await api('PATCH', '/users/' + (await sql(`SELECT id FROM hms_users WHERE username = 'admin'`))[0].id + '/toggle-active', { token: adTok });
      assert(self.status === 400, `admin deactivating own account: ${self.status}`);
      noErrors(sa, 'activate / history');
    });

    await step('Change password: the new user changes their password in the UI; the old one stops working', async () => {
      const u = await loginAs(browser, ctx.user.username, PW1);
      try {
        const { page } = u;
        await page.goto(`${BASE}/hms/change-password`, { waitUntil: 'networkidle' });
        await page.locator('#cp-currentPassword').fill('Not#Mine123');
        await page.locator('#cp-newPassword').fill(PW2);
        await page.locator('#cp-confirmPassword').fill(PW2);
        await page.locator('button[type=submit]').click();
        await page.getByText('Current password is incorrect.').waitFor({ timeout: 10000 });
        assert(page.url().includes('/hms/change-password'), `a wrong current password signed the user out: ${page.url()}`);
        await page.locator('#cp-currentPassword').fill(PW1);
        await page.locator('button[type=submit]').click();
        await toast(page, 'Password changed successfully.');
        await page.waitForURL((url) => !url.pathname.includes('change-password'), { timeout: 15000 });
        noErrors(u, 'change password');
      } finally { await u.ctx.close(); }
      const old = await rawLogin(ctx.user.username, PW1);
      assert(old.status === 401, `old password still works: ${old.status}`);
      const fresh = await rawLogin(ctx.user.username, PW2);
      assert(fresh.status === 200, `new password rejected: ${fresh.status} ${JSON.stringify(fresh.data)}`);
      const [row] = await sql('SELECT first_login, failed_attempts FROM hms_users WHERE id = $1', [ctx.user.id]);
      assert(row.first_login === 'N' && Number(row.failed_attempts) === 0, `after change: ${JSON.stringify(row)}`);
    });

    // ── 2. Permission matrix ───────────────────────────────────────────────
    await step('Permission matrix: granting nurse read access to pharmacy takes effect on the API, then it is restored', async () => {
      const nurseTok = await apiLogin('nurse');
      const before = await sql('SELECT role, module, can_read, can_write, can_edit, can_delete FROM hms_permissions ORDER BY role, module');
      const nursePharm = before.find((p) => p.role === 'nurse' && p.module === 'pharmacy');
      assert(!nursePharm || nursePharm.can_read === 'N', `precondition: nurse already reads pharmacy (${JSON.stringify(nursePharm)})`);
      restore.permission = true;
      const pre = await api('GET', '/medicines?limit=1', { token: nurseTok });
      assert(pre.status === 403, `nurse could read medicines before the change: ${pre.status}`);
      const { page } = sa;
      await page.goto(`${BASE}/hms/admin/permissions`, { waitUntil: 'networkidle' });
      const box = page.getByRole('checkbox', { name: 'Nurse: Read Pharmacy' });
      await box.check();
      const save = async () => {
        const [res] = await Promise.all([
          page.waitForResponse((r) => r.url().endsWith('/api/users/permissions') && r.request().method() === 'PUT'),
          page.getByRole('button', { name: 'Save changes' }).click(),
        ]);
        assert(res.status() === 200, `save permissions: HTTP ${res.status()} ${await res.text()}`);
        await toast(page, 'Permissions saved');
      };
      await save();
      const [granted] = await sql(`SELECT can_read FROM hms_permissions WHERE role = 'nurse' AND module = 'pharmacy'`);
      assert(granted?.can_read === 'Y', `DB after grant: ${JSON.stringify(granted)}`);
      const during = await api('GET', '/medicines?limit=1', { token: nurseTok });
      assert(during.status === 200, `nurse still refused after grant: ${during.status}`);
      await box.uncheck();
      await save();
      const after = await api('GET', '/medicines?limit=1', { token: nurseTok });
      assert(after.status === 403, `nurse still allowed after restore: ${after.status}`);
      // Nothing else changed, and no empty rows were added.
      const now = await sql('SELECT role, module, can_read, can_write, can_edit, can_delete FROM hms_permissions ORDER BY role, module');
      const key = (p) => `${p.role}/${p.module}:${p.can_read}${p.can_write}${p.can_edit}${p.can_delete}`;
      const was = new Set(before.map(key));
      const changed = now.map(key).filter((k) => !was.has(k) && !/:NNNN$/.test(k) && !k.startsWith('nurse/pharmacy:'));
      assert(changed.length === 0, `other permissions changed: ${changed.join(', ')}`);
      assert(now.length <= before.length + 1, `matrix save added ${now.length - before.length} rows`);
      restore.permission = false;
      noErrors(sa, 'permission matrix');
    });

    // ── 3. Staff ───────────────────────────────────────────────────────────
    await step('Staff: admin adds, edits and deletes a staff account', async () => {
      const { page } = ad;
      await page.goto(`${BASE}/hms/admin/staff`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Add staff member' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#s-name').fill(ctx.staff.name);
      await dlg.locator('#s-role').selectOption('nurse');
      await dlg.locator('#s-phone').fill(`96${S}2`);
      await dlg.locator('#s-username').fill(ctx.staff.username);
      await dlg.locator('#s-password').fill(PW1);
      await dlg.getByRole('button', { name: 'Add staff member' }).click();
      await toast(page, 'Staff member added');
      const [row] = await sql('SELECT id, role, phone, is_active FROM hms_users WHERE username = $1', [ctx.staff.username]);
      assert(row && row.role === 'nurse' && Number(row.is_active) === 1, `staff row: ${JSON.stringify(row)}`);
      ctx.staff.id = row.id;
      await page.getByPlaceholder('Search name, username or phone').fill(ctx.staff.username);
      await rowMenu(page, `Actions for ${ctx.staff.name}`, 'Edit');
      await dlg.locator('#s-phone').fill(`95${S}3`);
      await dlg.getByRole('button', { name: 'Save changes' }).click();
      await toast(page, 'Staff member updated');
      const [edited] = await sql('SELECT phone, is_active FROM hms_users WHERE id = $1', [ctx.staff.id]);
      assert(edited.phone === `95${S}3` && Number(edited.is_active) === 1, `after edit: ${JSON.stringify(edited)}`);
      await rowMenu(page, `Actions for ${ctx.staff.name}`, 'Delete account');
      await dialog(page).filter({ hasText: 'Delete this account?' }).getByRole('button', { name: 'Delete account' }).click();
      await toast(page, `${ctx.staff.name} removed`);
      assert((await sql('SELECT 1 FROM hms_users WHERE id = $1', [ctx.staff.id])).length === 0, 'staff account still in DB');
      noErrors(ad, 'staff add/edit/delete');
    });

    await step('Staff: deleting an account that has clinical records is blocked with a clear message', async () => {
      const c = await api('POST', '/users', { token: adTok, body: { username: ctx.clin.username, password: PW1, name: ctx.clin.name, role: 'doctor' } });
      assert(c.status === 201, `create doctor: ${c.status} ${JSON.stringify(c.data)}`);
      ctx.clin.id = c.data.data.id;
      const docTok = (await rawLogin(ctx.clin.username, PW1)).data.token;
      const pt = await api('POST', '/patients/hms', { token: recTok, body: { patientType: 'other', name: ctx.patientName, age: 41, gender: 'Female', opdIndoor: 'OPD', testDate: ymd(new Date()), phoneNumber: `7${S.padStart(9, '0')}` } });
      assert(pt.status === 201 || pt.status === 200, `create patient: ${pt.status} ${JSON.stringify(pt.data).slice(0, 200)}`);
      ctx.patientId = pt.data.data.id;
      await inCare(ctx.patientId, ctx.clin.username);
      const enc = await api('POST', '/hms/encounters', { token: docTok, body: { patient_id: ctx.patientId, chief_complaint: 'E2E admin test visit' } });
      assert(enc.status === 201 || enc.status === 200, `create encounter: ${enc.status} ${JSON.stringify(enc.data).slice(0, 200)}`);
      const { page } = ad;
      await page.goto(`${BASE}/hms/admin/staff`, { waitUntil: 'networkidle' });
      await page.getByPlaceholder('Search name, username or phone').fill(ctx.clin.username);
      await rowMenu(page, `Actions for ${ctx.clin.name}`, 'Delete account');
      await dialog(page).filter({ hasText: 'Delete this account?' }).getByRole('button', { name: 'Delete account' }).click();
      await toast(page, 'cannot be deleted because the account is linked to existing records (1 consultations');
      assert((await sql('SELECT 1 FROM hms_users WHERE id = $1', [ctx.clin.id])).length === 1, 'doctor with a consultation was deleted');
      assert((await sql('SELECT 1 FROM hms_doctors WHERE user_id = $1', [ctx.clin.id])).length === 1, 'doctor profile was removed');
      await dialog(page).filter({ hasText: 'Delete this account?' }).getByRole('button', { name: 'Cancel' }).click();
      // Deactivate instead, through the edit form.
      await rowMenu(page, `Actions for ${ctx.clin.name}`, 'Edit');
      await dialog(page).getByRole('checkbox').uncheck();
      await dialog(page).getByRole('button', { name: 'Save changes' }).click();
      await toast(page, 'Staff member updated');
      assert(Number((await sql('SELECT is_active FROM hms_users WHERE id = $1', [ctx.clin.id]))[0].is_active) === 0, 'doctor not deactivated');
      noErrors(ad, 'blocked delete');
    });

    // ── 4. Security centre ─────────────────────────────────────────────────
    await step('Security centre: failed sign-in attempts are recorded and listed', async () => {
      for (let i = 0; i < 2; i++) {
        const r = await rawLogin(ctx.user.username, `Wrong#${i}xyz`);
        assert(r.status === 401, `failed attempt ${i + 1}: ${r.status}`);
      }
      const [u] = await sql('SELECT failed_attempts FROM hms_users WHERE id = $1', [ctx.user.id]);
      assert(Number(u.failed_attempts) === 2, `failed_attempts = ${u.failed_attempts}`);
      const { page } = sa;
      await page.goto(`${BASE}/hms/admin/security`, { waitUntil: 'networkidle' });
      await page.locator('#sec-tab-center').click();
      await settle('Failed sign-ins today',
        async () => num(await readKpi(page, 'Failed sign-ins today')),
        async () => (await sql(`SELECT COUNT(*)::int AS n FROM hms_audit_logs WHERE action = 'LOGIN_FAILED' AND created_at >= CURRENT_DATE`))[0].n,
        { reload: async () => { await page.reload({ waitUntil: 'networkidle' }); await page.locator('#sec-tab-center').click(); } });
      const row = page.locator('tbody tr', { hasText: ctx.user.username }).first();
      await row.waitFor();
      await row.getByText('Wrong password (attempt 2)').waitFor();
      noErrors(sa, 'security centre');
    });

    await step('Security centre: five failures lock the account; unlock from the sessions list restores sign-in', async () => {
      const results = [];
      for (let i = 0; i < 3; i++) results.push((await rawLogin(ctx.user.username, `Wrong#${i}abc`)).status);
      assert(results.join(',') === '401,401,423', `attempts 3-5 returned ${results}`);
      const locked = await rawLogin(ctx.user.username, PW2);
      assert(locked.status === 423 && /locked/i.test(locked.data.message), `correct password while locked: ${locked.status}`);
      const [u] = await sql('SELECT failed_attempts, locked_until > NOW() AS locked FROM hms_users WHERE id = $1', [ctx.user.id]);
      assert(Number(u.failed_attempts) === 5 && u.locked, `lock state: ${JSON.stringify(u)}`);
      const { page } = sa;
      await page.locator('#sec-tab-sessions').click();
      const row = page.locator('tbody tr', { hasText: ctx.user.username });
      await row.getByText('Locked').waitFor();
      await row.getByRole('button', { name: `Unlock ${ctx.user.username}` }).click();
      await toast(page, 'Account unlocked');
      const [after] = await sql('SELECT failed_attempts, locked_until FROM hms_users WHERE id = $1', [ctx.user.id]);
      assert(Number(after.failed_attempts) === 0 && after.locked_until === null, `after unlock: ${JSON.stringify(after)}`);
      const ok = await rawLogin(ctx.user.username, PW2);
      assert(ok.status === 200, `sign-in after unlock: ${ok.status}`);
      ctx.userToken = ok.data.token;
      // A seeded account's own row never offers "End session" for itself.
      const saName = (await sql(`SELECT username FROM hms_users WHERE username = 'superadmin'`))[0].username;
      assert(await page.getByRole('button', { name: `End session for ${saName}` }).count() === 0, 'super admin can end their own session');
      noErrors(sa, 'lockout / unlock');
    });

    await step('Security centre: ending a session refuses the user\'s token straight away', async () => {
      const me = await api('GET', '/auth/me', { token: ctx.userToken });
      assert(me.status === 200, `token before: ${me.status}`);
      const { page } = sa;
      await page.locator('#sec-tab-sessions').click();
      await page.getByRole('button', { name: 'Refresh' }).click();
      await page.getByRole('button', { name: `End session for ${ctx.user.username}` }).click();
      await dialog(page).getByRole('button', { name: 'End session' }).click();
      await toast(page, 'Session ended');
      const cut = await api('GET', '/auth/me', { token: ctx.userToken });
      assert(cut.status === 401, `token still accepted after ending the session: ${cut.status}`);
      // The session is revoked; the account itself is not locked, so the user can sign in again.
      const again = await rawLogin(ctx.user.username, PW2);
      assert(again.status === 200, `sign-in after the session was ended: ${again.status} ${JSON.stringify(again.data)}`);
      ctx.userToken = again.data.token;
      noErrors(sa, 'end session');
    });

    await step('Security centre: an IP block list entry is saved, enforced at sign-in and removed; unsafe rules are refused', async () => {
      const saveRules = () => Promise.all([page.waitForResponse((response) => response.url().includes('/api/security/ip-rules') && response.request().method() === 'PUT'), page.getByRole('button', { name: 'Save IP rules', exact: true }).click()]);
      const before = (await api('GET', '/security/ip-rules', { token: saTok })).data.data;
      restore.ipRules = before;
      const { page } = sa;
      await page.locator('#sec-tab-ip-rules').click();
      await page.locator('#ip-block').fill('203.0.113.0/24');
      await page.getByRole('button', { name: 'Block', exact: true }).click();
      await saveRules();
      await toast(page, 'IP rules saved');
      const saved = (await api('GET', '/security/ip-rules', { token: saTok })).data.data;
      assert(saved.blacklist.includes('203.0.113.0/24'), `block list: ${JSON.stringify(saved)}`);
      const fromBlocked = await rawLogin(ctx.user.username, PW2, '203.0.113.50');
      assert(fromBlocked.status === 403 && /not allowed/i.test(fromBlocked.data.message), `sign-in from a blocked address: ${fromBlocked.status} ${fromBlocked.data.message}`);
      const fromLocal = await rawLogin(ctx.user.username, PW2);
      assert(fromLocal.status === 200, `sign-in from an allowed address: ${fromLocal.status}`);
      // Blocking loopback, or an allow list that leaves out the admin's own address, is refused.
      await page.locator('#ip-block').fill('127.0.0.0/8');
      await page.getByRole('button', { name: 'Block', exact: true }).click();
      await saveRules();
      await toast(page, 'would block this server or your own address');
      await page.getByRole('button', { name: 'Remove 127.0.0.0/8 from the block list' }).click();
      await page.locator('#ip-allow').fill('10.0.0.0/8');
      await page.locator('#ip-allow').press('Enter');
      await saveRules();
      await toast(page, 'does not include your own address');
      await page.getByRole('button', { name: 'Remove 10.0.0.0/8 from the allow list' }).click();
      const mid = (await api('GET', '/security/ip-rules', { token: saTok })).data.data;
      assert(mid.whitelist.length === before.whitelist.length && !mid.blacklist.includes('127.0.0.0/8'), `unsafe rule was saved: ${JSON.stringify(mid)}`);
      await page.getByRole('button', { name: 'Remove 203.0.113.0/24 from the block list' }).click();
      await saveRules();
      await toast(page, 'IP rules saved');
      const after = (await api('GET', '/security/ip-rules', { token: saTok })).data.data;
      assert(!after.blacklist.includes('203.0.113.0/24'), `rule not removed: ${JSON.stringify(after)}`);
      const unblocked = await rawLogin(ctx.user.username, PW2, '203.0.113.50');
      assert(unblocked.status === 200, `sign-in after removing the rule: ${unblocked.status}`);
      const bad = await api('PUT', '/security/ip-rules', { token: saTok, body: { blacklist: ['not-an-ip'] } });
      assert(bad.status === 400, `invalid rule accepted: ${bad.status}`);
      restore.ipRules = null;
      noErrors(sa, 'ip rules');
    });

    // ── 5. Notices, attendance ─────────────────────────────────────────────
    await step('Notices: create, filter by priority, search and delete with confirmation', async () => {
      const { page } = ad;
      const title = `E2E notice ${S}`;
      await page.goto(`${BASE}/hms/admin/notices`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'New notice' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#notice-title').fill(title);
      await dlg.locator('#notice-message').fill('Automated test notice. Safe to ignore.');
      await dlg.locator('#notice-priority').selectOption('urgent');
      await dlg.getByRole('button', { name: 'Publish notice' }).click();
      await page.locator('tbody tr', { hasText: title }).waitFor();
      const list = (await api('GET', '/admin/notices', { token: adTok })).data.data;
      const n = list.find((x) => x.title === title);
      assert(n && n.priority === 'urgent', `API notice: ${JSON.stringify(n)}`);
      await page.getByRole('tab', { name: /^Info/ }).click();
      assert(await page.locator('tbody tr', { hasText: title }).count() === 0, 'urgent notice shown under Info');
      await page.getByRole('tab', { name: /^Urgent/ }).click();
      await page.locator('tbody tr', { hasText: title }).waitFor();
      await page.getByRole('tab', { name: /^All/ }).click();
      await page.getByPlaceholder('Search title, message or department').fill(`notice ${S}`);
      assert(await page.locator('tbody tr', { hasText: 'E2E notice' }).count() === 1, 'search did not narrow to the notice');
      await page.getByRole('button', { name: `Delete notice ${title}` }).click();
      await dialog(page).getByRole('button', { name: 'Delete notice' }).click();
      await page.locator('tbody tr', { hasText: title }).waitFor({ state: 'detached' });
      const gone = (await api('GET', '/admin/notices', { token: adTok })).data.data;
      assert(!gone.some((x) => x.title === title), 'notice still returned by the API');
      noErrors(ad, 'notices');
    });

    await step('Attendance & leave: presence matches sign-ins today; an invalid leave decision is refused', async () => {
      const { page } = ad;
      await page.goto(`${BASE}/hms/admin/attendance`, { waitUntil: 'networkidle' });
      await settle('Present today',
        async () => num(await readKpi(page, 'Present today')),
        async () => (await sql(`SELECT COUNT(*)::int AS n FROM hms_users WHERE role NOT IN ('super_admin','admin') AND is_active = 1 AND last_login >= CURRENT_DATE`))[0].n,
        { reload: () => page.reload({ waitUntil: 'networkidle' }) });
      const bad = await api('PUT', '/admin/attendance/leave/1', { token: adTok, body: { status: 'Maybe' } });
      assert(bad.status === 400, `invalid leave status: ${bad.status}`);
      const empty = await api('PUT', '/admin/attendance/leave/1', { token: adTok, body: {} });
      assert(empty.status === 400, `missing leave status: ${empty.status}`);
      noErrors(ad, 'attendance');
    });

    // ── 6. Settings ────────────────────────────────────────────────────────
    await step('Settings: hospital profile edit is saved, shown on the letterhead preview, then restored', async () => {
      const [orig] = await sql('SELECT name, tagline, phone FROM hms_hospital_profile WHERE id = 1');
      restore.profile = orig;
      const { page } = ad;
      await page.goto(`${BASE}/admin/settings`, { waitUntil: 'networkidle' });
      const tagline = `E2E tagline ${S}`;
      const phone = `011-${S}`;
      await page.locator('#hp-TAGLINE').fill(tagline);
      await page.locator('#hp-PHONE').fill(phone);
      await page.getByRole('button', { name: 'Save profile' }).click();
      await toast(page, 'Hospital profile updated');
      const [saved] = await sql('SELECT name, tagline, phone FROM hms_hospital_profile WHERE id = 1');
      assert(saved.tagline === tagline && saved.phone === phone && saved.name === orig.name, `saved profile: ${JSON.stringify(saved)}`);
      const preview = page.locator('.print-area');
      await preview.getByText(tagline).waitFor();
      await preview.getByText(`Ph: ${phone}`).waitFor();
      await page.reload({ waitUntil: 'networkidle' });
      assert(await page.locator('#hp-TAGLINE').inputValue() === tagline, 'tagline not persisted after reload');
      await page.locator('.print-area').getByText(tagline).waitFor();
      await page.locator('#hp-TAGLINE').fill(orig.tagline || '');
      await page.locator('#hp-PHONE').fill(orig.phone || '');
      await page.getByRole('button', { name: 'Save profile' }).click();
      await toast(page, 'Hospital profile updated');
      const [back] = await sql('SELECT name, tagline, phone FROM hms_hospital_profile WHERE id = 1');
      assert(JSON.stringify(back) === JSON.stringify(orig), `profile not restored: ${JSON.stringify(back)} vs ${JSON.stringify(orig)}`);
      restore.profile = null;
      noErrors(ad, 'hospital profile');
    });

    await step('Settings: a tariff is added, edited and disabled', async () => {
      const { page } = ad;
      const name = `E2E tariff ${S}`;
      await page.getByRole('tab', { name: 'Tariff and rate card' }).click();
      await page.getByRole('button', { name: 'Add tariff' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#tf-category').selectOption('Procedure');
      await dlg.locator('#tf-name').fill(name);
      await dlg.locator('#tf-rate').fill('123');
      await dlg.getByRole('button', { name: 'Create tariff' }).click();
      await toast(page, 'Tariff created');
      const [t] = await sql('SELECT id, rate, is_active, category FROM hms_tariffs WHERE name = $1', [name]);
      assert(t && Number(t.rate) === 123 && Number(t.is_active) === 1 && t.category === 'Procedure', `tariff row: ${JSON.stringify(t)}`);
      ctx.tariffId = t.id;
      await page.getByPlaceholder('Search name, category or ward type').fill(name);
      await rowMenu(page, `Actions for ${name}`, 'Edit tariff');
      await dlg.locator('#tf-rate').fill('150');
      await dlg.getByRole('button', { name: 'Save changes' }).click();
      await toast(page, 'Tariff updated');
      assert(Number((await sql('SELECT rate FROM hms_tariffs WHERE id = $1', [t.id]))[0].rate) === 150, 'rate not updated');
      await rowMenu(page, `Actions for ${name}`, 'Disable');
      await toast(page, 'Tariff status changed');
      assert(Number((await sql('SELECT is_active FROM hms_tariffs WHERE id = $1', [t.id]))[0].is_active) === 0, 'tariff still active');
      noErrors(ad, 'tariffs');
    });

    await step('Settings: a department is added and edited (then switched off); holidays are flagged as not saved', async () => {
      const { page } = ad;
      const name = `E2E Dept ${S}`;
      await page.getByRole('tab', { name: 'Departments' }).click();
      await page.getByRole('button', { name: 'Add department' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#dept-name').fill(name);
      await dlg.locator('#dept-code').fill(`E${S.slice(-4)}`);
      await dlg.getByRole('button', { name: 'Add department' }).click();
      await toast(page, 'Department added');
      const [d] = await sql('SELECT id, short_code, is_active FROM hms_departments WHERE name = $1', [name]);
      assert(d && d.short_code === `E${S.slice(-4)}` && d.is_active === 'Y', `department row: ${JSON.stringify(d)}`);
      ctx.deptId = d.id;
      await page.locator('tbody tr', { hasText: name }).getByText(`E${S.slice(-4)}`).waitFor();
      await rowMenu(page, `Actions for ${name}`, 'Edit department');
      await dlg.locator('#dept-floor').fill('E2E floor');
      await dlg.getByRole('checkbox').uncheck();
      await dlg.getByRole('button', { name: 'Save changes' }).click();
      await toast(page, 'Department updated');
      const [e] = await sql('SELECT floor_location, is_active FROM hms_departments WHERE id = $1', [d.id]);
      assert(e.floor_location === 'E2E floor' && e.is_active === 'N', `after edit: ${JSON.stringify(e)}`);
      await page.locator('tbody tr', { hasText: name }).getByText('Inactive').waitFor();
      const dup = await api('POST', '/admin/departments', { token: adTok, body: { name } });
      assert(dup.status === 409, `duplicate department: ${dup.status}`);
      await page.getByRole('tab', { name: 'Holiday calendar' }).click();
      await page.getByText('The holiday calendar is not saved on the server yet.').waitFor();
      noErrors(ad, 'departments');
    });

    // ── 7. Front desk ──────────────────────────────────────────────────────
    await step('Front desk: a visitor pass is issued and checked out', async () => {
      const { page } = rec;
      const visitor = `E2E Visitor ${S}`;
      await page.goto(`${BASE}/receptionist/visitors`, { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Issue visitor pass' }).first().click();
      const dlg = dialog(page);
      await dlg.locator('#vp-patient').fill(ctx.patientName);
      await dlg.locator('#vp-ward').selectOption('General-A');
      await dlg.locator('#vp-bed').fill('G-1');
      await dlg.locator('#vp-visitor').fill(visitor);
      await dlg.locator('#vp-relation').selectOption('Sibling');
      await dlg.getByRole('button', { name: 'Issue pass and check in' }).click();
      await toast(page, 'Visitor pass issued.');
      const row = page.locator('tbody tr', { hasText: visitor });
      await row.getByText('Inside').waitFor();
      const [log] = await sql(`SELECT record_id FROM hms_audit_logs WHERE module = 'receptionist_visitor' AND new_value LIKE $1 ORDER BY id DESC LIMIT 1`, [`%${visitor}%`]);
      assert(log, 'visitor pass not stored');
      await page.getByRole('button', { name: `Check out ${visitor}` }).click();
      await toast(page, 'Visitor checked out.');
      await row.getByText('Checked out').waitFor();
      const [latest] = await sql(`SELECT new_value FROM hms_audit_logs WHERE module = 'receptionist_visitor' AND record_id = $1 ORDER BY id DESC LIMIT 1`, [log.record_id]);
      assert(JSON.parse(latest.new_value).status === 'Checked Out', `latest visitor state: ${latest.new_value}`);
      noErrors(rec, 'visitors');
    });

    await step('Front desk: a notification is marked read', async () => {
      const docId = (await sql(`SELECT id FROM hms_users WHERE username = 'doctor'`))[0].id;
      const appt = await api('POST', '/hms/appointments', { token: recTok, body: { patient_id: ctx.patientId, doctor_id: docId, appointment_date: ymd(new Date()) } });
      assert(appt.status === 201, `book appointment: ${appt.status} ${JSON.stringify(appt.data).slice(0, 200)}`);
      ctx.apptId = appt.data.data?.id ?? appt.data.data?.ID ?? appt.data.id;
      assert(ctx.apptId, `no appointment id in ${JSON.stringify(appt.data).slice(0, 200)}`);
      const { page } = rec;
      await page.goto(`${BASE}/receptionist/notifications`, { waitUntil: 'networkidle' });
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.first().waitFor({ timeout: 15000 });
      await row.getByRole('button', { name: 'Mark read' }).click();
      await row.getByRole('button', { name: 'Mark read' }).waitFor({ state: 'detached' });
      const read = await sql(`SELECT 1 FROM hms_audit_logs WHERE module = 'receptionist_notification' AND action = 'MARK_READ' AND record_id = $1`, [1000000 + Number(ctx.apptId)]);
      assert(read.length === 1, 'mark-read not stored');
      noErrors(rec, 'notifications');
    });

    await step('Front desk: today\'s appointment is listed and cancelled', async () => {
      const { page } = rec;
      await page.goto(`${BASE}/receptionist/appointments`, { waitUntil: 'networkidle' });
      const row = page.locator('tbody tr', { hasText: ctx.patientName });
      await row.getByText('Scheduled').waitFor();
      await rowMenu(page, `Actions for ${ctx.patientName}`, 'Cancel appointment');
      await dialog(page).getByRole('button', { name: 'Cancel appointment' }).click();
      await toast(page, 'Appointment marked cancelled');
      const [a] = await sql('SELECT status FROM hms_appointments WHERE id = $1', [ctx.apptId]);
      assert(a.status === 'Cancelled', `appointment status ${a.status}`);
      noErrors(rec, 'appointments');
    });

    // ── 8. Reports ─────────────────────────────────────────────────────────
    const to = ymd(new Date());
    const from = ymd(new Date(Date.now() - 30 * 86400000));
    const range = [from, to];
    async function generate(page, id) {
      await page.locator(`#${id}-from`).fill(from);
      await page.locator(`#${id}-to`).fill(to);
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes('/api/reports/') && r.request().method() === 'GET', { timeout: 20000 }),
        page.getByRole('button', { name: 'Generate' }).click(),
      ]);
      assert(res.status() === 200, `${id}: HTTP ${res.status()}`);
      return res.json();
    }

    await step('Reports: OPD register matches the database and exports to Excel', async () => {
      const { page } = ad;
      await page.goto(`${BASE}/reports`, { waitUntil: 'networkidle' });
      const body = await generate(page, 'opd');
      const [db] = await sql(`SELECT COUNT(*)::int AS n FROM hms_encounters e JOIN hms_patients p ON p.id = e.patient_id JOIN hms_users u ON u.id = e.doctor_id
                              WHERE e.status = 'Finalized' AND e.encounter_date::date BETWEEN $1 AND $2`, range);
      assert(body.data.length === db.n, `OPD register rows ${body.data.length}, database ${db.n}`);
      const shown = await page.locator('tbody tr').count();
      assert(db.n === 0 ? shown <= 1 : shown === Math.min(db.n, 50), `table shows ${shown} rows for ${db.n} visits`);
      const [feeDb] = await sql(`SELECT COALESCE(SUM(b.net_payable),0)::numeric AS s FROM hms_encounters e JOIN hms_users u ON u.id = e.doctor_id
                                 JOIN hms_patients p ON p.id = e.patient_id
                                 JOIN LATERAL (SELECT net_payable FROM hms_bills WHERE encounter_id = e.id AND bill_type = 'OPD' AND status <> 'Cancelled' ORDER BY id DESC LIMIT 1) b ON TRUE
                                 WHERE e.status = 'Finalized' AND e.encounter_date::date BETWEEN $1 AND $2`, range);
      const feeApi = body.data.reduce((s, r) => s + Number(r.FEE || 0), 0);
      assert(money(feeApi) === money(feeDb.s), `OPD fees ${feeApi} vs ${feeDb.s}`);
      const x = await fetchBinary(`/reports/opd-register?start_date=${from}&end_date=${to}&export=excel`, adTok);
      assert(x.status === 200 && x.type.includes('spreadsheetml') && x.buf.subarray(0, 2).toString() === 'PK', `excel export: ${x.status} ${x.type}`);
      const [download] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.getByRole('button', { name: 'Export Excel' }).click()]);
      const file = path.join(os.tmpdir(), `admin-e2e-${Date.now()}.xlsx`);
      await download.saveAs(file);
      const buf = fs.readFileSync(file);
      fs.unlinkSync(file);
      assert(buf.subarray(0, 2).toString() === 'PK' && buf.length > 1000, `downloaded export is not a spreadsheet (${buf.length} bytes)`);
      noErrors(ad, 'opd register');
    });

    await step('Reports: revenue totals match the database and the daily collection chart renders', async () => {
      const { page } = ad;
      await page.getByRole('tab', { name: 'Revenue' }).click();
      const body = await generate(page, 'rev');
      const [db] = await sql(`
        SELECT COALESCE(SUM(b.total_amount),0) AS billed, COALESCE(SUM(b.net_payable),0) AS payable,
               COALESCE(SUM(GREATEST(b.net_payable - COALESCE(p.paid,0), 0)),0) AS outstanding,
               (SELECT COALESCE(SUM(amount),0) FROM hms_payments WHERE payment_date::date BETWEEN $1 AND $2) AS collected
          FROM hms_bills b LEFT JOIN (SELECT bill_id, SUM(amount) AS paid FROM hms_payments GROUP BY bill_id) p ON p.bill_id = b.id
         WHERE b.created_at::date BETWEEN $1 AND $2 AND b.status <> 'Cancelled'`, range);
      const t = body.data.totals;
      for (const [k, v] of [['TOTAL_BILLED', db.billed], ['TOTAL_PAYABLE', db.payable], ['TOTAL_COLLECTED', db.collected], ['OUTSTANDING', db.outstanding]]) {
        assert(money(t[k]) === money(v), `${k}: report ${t[k]}, database ${v}`);
      }
      assert(await readKpi(page, 'Total billed') === inr(t.TOTAL_BILLED), `Total billed KPI ${await readKpi(page, 'Total billed')}`);
      assert(await readKpi(page, 'Total collected') === inr(t.TOTAL_COLLECTED), `Total collected KPI ${await readKpi(page, 'Total collected')}`);
      assert(await readKpi(page, 'Outstanding') === inr(t.OUTSTANDING), `Outstanding KPI ${await readKpi(page, 'Outstanding')}`);
      const modeSum = body.data.byMode.reduce((s, m) => s + Number(m.TOTAL), 0);
      const daySum = body.data.dailyCollection.reduce((s, d) => s + Number(d.DAILY_TOTAL), 0);
      const deptSum = body.data.byDepartment.reduce((s, d) => s + Number(d.REVENUE), 0);
      assert(money(modeSum) === money(db.collected) && money(daySum) === money(db.collected), `collections: by mode ${modeSum}, by day ${daySum}, database ${db.collected}`);
      assert(money(deptSum) === money(db.payable), `by department ${deptSum} vs payable ${db.payable}`);
      // Chart: one bar slot per day in the range, with the caption total equal to the collections.
      const chart = page.locator('section.panel', { has: page.getByRole('heading', { name: 'Daily collection' }) });
      await chart.locator('.recharts-surface').first().waitFor();
      await chart.getByText(`${inr(db.collected)} over 31 days`).waitFor();
      if (Number(db.collected) > 0) assert(await chart.locator('.recharts-bar-rectangle path').count() >= 1, 'no bars drawn');
      noErrors(ad, 'revenue');
    });

    await step('Reports: pharmacy sales include dispensing and counter sales and match the database', async () => {
      const { page } = ad;
      await page.getByRole('tab', { name: 'Pharmacy sales' }).click();
      const body = await generate(page, 'pharm');
      const [db] = await sql(`
        SELECT COALESCE(SUM(qty),0) AS qty, COALESCE(SUM(amount),0) AS amount FROM (
          SELECT di.quantity AS qty, di.amount FROM hms_dispensing_items di JOIN hms_dispensing_records dr ON dr.id = di.dispensing_record_id
           WHERE dr.dispensed_at::date BETWEEN $1 AND $2
          UNION ALL
          SELECT oi.quantity, oi.amount FROM hms_otc_items oi JOIN hms_otc_sales os ON os.id = oi.otc_sale_id
           WHERE os.sold_at::date BETWEEN $1 AND $2) x`, range);
      const qty = body.data.reduce((s, r) => s + Number(r.TOTAL_QTY), 0);
      const amount = body.data.reduce((s, r) => s + Number(r.TOTAL_VALUE), 0);
      assert(qty === Number(db.qty) && money(amount) === money(db.amount), `pharmacy sales: report ${qty} units / ${amount}, database ${db.qty} / ${db.amount}`);
      const shown = await page.locator('tbody tr').count();
      assert(body.data.length === 0 || shown === Math.min(body.data.length, 25), `table rows ${shown} for ${body.data.length} medicines`);
      noErrors(ad, 'pharmacy sales');
    });

    await step('Reports: lab workload leaves cancelled tests out of pending and lists STAT first', async () => {
      const { page } = ad;
      await page.getByRole('tab', { name: 'Lab workload' }).click();
      const body = await generate(page, 'lab');
      const [db] = await sql(`
        SELECT COUNT(*) FILTER (WHERE NOT cancelled)::int AS ordered,
               COUNT(*) FILTER (WHERE NOT cancelled AND i.status = 'Completed')::int AS completed,
               COUNT(*) FILTER (WHERE NOT cancelled AND i.status <> 'Completed')::int AS pending,
               COUNT(*) FILTER (WHERE cancelled)::int AS cancelled
          FROM (SELECT i.*, (i.status = 'Cancelled' OR o.status = 'Cancelled') AS cancelled
                  FROM hms_investigation_order_items i JOIN hms_investigation_orders o ON o.id = i.order_id
                  JOIN hms_patients p ON p.id = o.patient_id
                 WHERE o.created_at::date BETWEEN $1 AND $2) i`, range);
      const d = body.data;
      assert(d.total_ordered === db.ordered && d.total_completed === db.completed && d.pending_list.length === db.pending && d.total_cancelled === db.cancelled,
        `lab workload: report ${d.total_ordered}/${d.total_completed}/${d.pending_list.length}/${d.total_cancelled}, database ${db.ordered}/${db.completed}/${db.pending}/${db.cancelled}`);
      assert(!d.pending_list.some((r) => r.STATUS === 'Cancelled' || r.ORDER_STATUS === 'Cancelled'), 'cancelled test listed as pending');
      const rank = { STAT: 0, Urgent: 1, Routine: 2 };
      const ranks = d.pending_list.map((r) => rank[r.URGENCY] ?? 3);
      assert(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r), `pending list not in priority order: ${d.pending_list.map((r) => r.URGENCY).join(',')}`);
      assert(num(await readKpi(page, 'Total ordered')) === db.ordered && num(await readKpi(page, 'Pending')) === db.pending && num(await readKpi(page, 'Cancelled')) === db.cancelled, 'lab KPIs differ from the database');
      if (d.pending_list.some((r) => r.URGENCY === 'STAT')) {
        const firstUrgency = (await page.locator('tbody tr').first().locator('td').nth(3).innerText()).trim();
        assert(firstUrgency === 'STAT', `first pending row on screen is ${firstUrgency}`);
      }
      noErrors(ad, 'lab workload');
    });

    await step('Reports: audit trail and doctor performance generate and match the database', async () => {
      const { page } = ad;
      await page.getByRole('tab', { name: 'Audit trail' }).click();
      const audit = await generate(page, 'audit');
      const [adb] = await sql(`SELECT COUNT(*)::int AS n FROM hms_audit_logs WHERE created_at::date BETWEEN $1 AND $2`, range);
      assert(Math.abs(audit.total_count - adb.n) <= 20 && audit.data.length === Math.min(50, audit.total_count), `audit trail: ${audit.total_count} rows reported, database ${adb.n}`);
      await page.locator('tbody tr').first().waitFor();
      await page.getByRole('tab', { name: 'Doctor performance' }).click();
      const docId = (await sql(`SELECT id FROM hms_users WHERE username = 'doctor'`))[0].id;
      await page.locator('#docperf-doctor').selectOption(String(docId));
      const perf = await generate(page, 'docperf');
      const [pdb] = await sql(`SELECT
          (SELECT COUNT(*) FROM hms_encounters WHERE doctor_id = $3 AND status = 'Finalized' AND encounter_date::date BETWEEN $1 AND $2)::int AS enc,
          (SELECT COUNT(*) FROM hms_prescriptions WHERE doctor_id = $3 AND created_at::date BETWEEN $1 AND $2)::int AS rx,
          (SELECT COUNT(*) FROM hms_investigation_orders WHERE doctor_id = $3 AND status <> 'Cancelled' AND created_at::date BETWEEN $1 AND $2)::int AS lab,
          (SELECT COALESCE(SUM(b.net_payable),0) FROM hms_bills b JOIN hms_encounters e ON e.id = b.encounter_id
            WHERE e.doctor_id = $3 AND b.status <> 'Cancelled' AND b.created_at::date BETWEEN $1 AND $2) AS rev`, [...range, docId]);
      const p = perf.data;
      assert(p.encounters === pdb.enc && p.prescriptions === pdb.rx && p.labOrders === pdb.lab && money(p.revenue) === money(pdb.rev),
        `doctor performance: ${JSON.stringify(p)} vs ${JSON.stringify(pdb)}`);
      assert(num(await readKpi(page, 'Consultations')) === pdb.enc, 'consultations KPI differs');
      const denied = await api('GET', `/reports/revenue?start_date=${from}&end_date=${to}`, { token: recTok });
      const deniedAudit = await api('GET', '/reports/audit-trail', { token: await apiLogin('nurse') });
      assert(denied.status === 403 && deniedAudit.status === 403, `reports open to other roles: revenue ${denied.status}, audit ${deniedAudit.status}`);
      noErrors(ad, 'audit / doctor performance');
    });

    // ── 9. Dashboards ──────────────────────────────────────────────────────
    await step('Dashboards: super admin KPIs match the database', async () => {
      const { page } = sa;
      await page.goto(`${BASE}/super_admin/dashboard`, { waitUntil: 'networkidle' });
      const q = async () => (await sql(`SELECT
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today,
          COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - EXTRACT(DOW FROM CURRENT_DATE)::int)::int AS week,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE))::int AS month,
          (SELECT COUNT(*) FROM hms_users WHERE is_active = 1)::int AS active
        FROM hms_patients`))[0];
      const reload = () => page.reload({ waitUntil: 'networkidle' });
      await settle('New patients today', async () => num(await readKpi(page, 'New patients today')), async () => (await q()).today, { reload });
      await settle('New patients this week', async () => num(await readKpi(page, 'New patients this week')), async () => (await q()).week, { reload });
      await settle('New patients this month', async () => num(await readKpi(page, 'New patients this month')), async () => (await q()).month, { reload });
      await settle('Active users', async () => num(await readKpi(page, 'Active users')), async () => (await q()).active, { reload });
      const lowDb = async () => (await sql(`SELECT COUNT(*)::int AS n FROM (SELECT m.id FROM hms_medicines m LEFT JOIN hms_medicine_batches b ON b.medicine_id = m.id
                                           WHERE m.is_active = 1 GROUP BY m.id HAVING COALESCE(SUM(b.quantity),0) <= 10) x`))[0].n;
      const alertValue = async (label) => num(await page.locator('li', { hasText: label }).locator('strong').first().innerText());
      await settle('Low stock items', () => alertValue('Low stock items'), lowDb, { reload });
      // Analytics modal: each scope's total agrees with its KPI, and "Last 30 days" really is 30 days.
      await settle('Patient analytics scopes', async () => {
        const d = (await api('GET', '/dashboard/super-admin', { token: await apiLogin('super_admin') })).data.data;
        const sc = d.patient_analytics.scopes;
        return [sc.today.total === d.today_patients, sc.week.total === d.week_patients, sc.month.total === d.month_patients, sc.all.total].join('/');
      }, async () => `true/true/true/${(await sql(`SELECT COUNT(*)::int AS n FROM hms_patients WHERE created_at >= CURRENT_DATE - 29`))[0].n}`);
      await page.locator('.kpi', { has: page.locator('.kpi-label', { hasText: /^New patients this week$/ }) }).first().click();
      await dialog(page).getByText('Registrations per day').waitFor();
      await page.keyboard.press('Escape');
      const labWork = (await api('GET', '/lab/workload', { token: await apiLogin('lab_technician') })).data.data;
      await settle('Abnormal lab results today', () => alertValue('Abnormal lab results today'), async () => labWork.criticalFlagged, { reload });
      noErrors(sa, 'super admin dashboard');
    });

    await step('Dashboards: admin KPIs (revenue, beds, OPD/IPD, staff, discharges, low stock, appointments) match the database', async () => {
      const { page } = ad;
      await page.goto(`${BASE}/admin/dashboard`, { waitUntil: 'networkidle' });
      const reload = () => page.reload({ waitUntil: 'networkidle' });
      const q = async () => (await sql(`SELECT
          (SELECT COALESCE(SUM(amount),0) FROM hms_payments WHERE payment_date >= CURRENT_DATE) AS revenue,
          (SELECT COUNT(*) FROM hms_beds)::int AS beds,
          (SELECT COUNT(*) FROM hms_beds WHERE status = 'Occupied')::int AS occupied,
          (SELECT COUNT(*) FROM hms_tokens WHERE token_date::date = CURRENT_DATE)::int AS opd,
          (SELECT COUNT(*) FROM hms_admissions WHERE status = 'Active')::int AS ipd,
          (SELECT COUNT(*) FROM hms_users WHERE role NOT IN ('admin','super_admin') AND is_active = 1 AND last_login >= CURRENT_DATE)::int AS staff,
          (SELECT COUNT(*) FROM hms_admissions WHERE status IN ('Discharge Pending','Pending Discharge')
              OR (status = 'Active' AND expected_discharge_date IS NOT NULL AND expected_discharge_date::date <= CURRENT_DATE))::int AS discharges,
          (SELECT COUNT(*) FROM (SELECT m.id FROM hms_medicines m LEFT JOIN hms_medicine_batches b ON b.medicine_id = m.id
             WHERE m.is_active = 1 GROUP BY m.id HAVING COALESCE(SUM(b.quantity),0) <= 10) x)::int AS low,
          (SELECT COUNT(*) FROM hms_appointments WHERE appointment_date::date = CURRENT_DATE AND COALESCE(status,'') <> 'Cancelled')::int AS appts`))[0];
      await settle('Revenue today', async () => readKpi(page, 'Revenue today'), async () => inr(Number((await q()).revenue)), { reload });
      await settle('Bed occupancy', async () => readKpi(page, 'Bed occupancy'), async () => { const r = await q(); return `${r.beds ? Math.round((r.occupied / r.beds) * 100) : 0}%`; }, { reload });
      await settle('OPD / IPD', async () => readKpi(page, 'OPD / IPD'), async () => { const r = await q(); return `${r.opd} / ${r.ipd}`; }, { reload });
      await settle('Staff on duty', async () => num(await readKpi(page, 'Staff on duty')), async () => (await q()).staff, { reload });
      const attention = async (label) => num(await page.locator('li', { hasText: label }).locator('strong').first().innerText());
      await settle('Pending discharges', () => attention('Pending discharges'), async () => (await q()).discharges, { reload });
      await settle('Low stock medicines', () => attention('Low stock medicines'), async () => (await q()).low, { reload });
      await settle("Today's appointments", () => attention("Today's appointments"), async () => (await q()).appts, { reload });
      noErrors(ad, 'admin dashboard');
    });

    await step('Dashboards: pharmacist "sales today" is what was billed today (dispensing + counter sales)', async () => {
      const ph = await apiLogin('pharmacist');
      await settle('todays_sales',
        async () => money((await api('GET', '/dashboard/pharmacist', { token: ph })).data.data.todays_sales),
        async () => money((await sql(`SELECT (SELECT COALESCE(SUM(total_amount),0) FROM hms_dispensing_records WHERE dispensed_at >= CURRENT_DATE)
                                          + (SELECT COALESCE(SUM(total_amount),0) FROM hms_otc_sales WHERE sold_at >= CURRENT_DATE) AS s`))[0].s));
      const report = (await api('GET', '/pharmacist_lms/reports?days=1', { token: ph })).data.data;
      const dash = (await api('GET', '/dashboard/pharmacist', { token: ph })).data.data;
      assert(money(dash.todays_sales) === money(report.dailySales), `dashboard ${dash.todays_sales} vs pharmacy report ${report.dailySales}`);
    });
  } finally {
    // ── cleanup: leave only deactivated test accounts and switched-off test data ──
    await runStep('Cleanup: test accounts deactivated, settings restored', async () => {
      const saTok = await apiLogin('super_admin');
      const adTok = await apiLogin('admin');
      if (restore.permission) await api('PUT', '/users/permissions', { token: saTok, body: { permissions: [{ role: 'nurse', module: 'pharmacy', can_read: 'N', can_write: 'N', can_edit: 'N', can_delete: 'N' }] } });
      if (restore.ipRules) await api('PUT', '/security/ip-rules', { token: saTok, body: restore.ipRules });
      if (restore.profile) await api('PUT', '/admin/hospital-profile', { token: adTok, body: { name: restore.profile.name, tagline: restore.profile.tagline, phone: restore.profile.phone } });
      for (const id of [ctx.user.id, ctx.clin.id, ctx.staff.id].filter(Boolean)) {
        const [u] = await sql('SELECT is_active FROM hms_users WHERE id = $1', [id]);
        if (u && Number(u.is_active) === 1) await api('PATCH', `/users/${id}/toggle-active`, { token: saTok });
        if (u) await api('POST', `/security/users/${id}/unlock`, { token: saTok });
      }
      const active = await sql(`SELECT username FROM hms_users WHERE username LIKE $1 AND is_active = 1`, [`e2e_%_${S}`]);
      assert(active.length === 0, `test accounts still active: ${active.map((a) => a.username).join(', ')}`);
      const t = ctx.tariffId ? (await sql('SELECT is_active FROM hms_tariffs WHERE id = $1', [ctx.tariffId]))[0] : null;
      if (t && Number(t.is_active) === 1) await api('PATCH', `/admin/tariff/${ctx.tariffId}/toggle`, { token: adTok });
      if (ctx.deptId) {
        const [d] = await sql('SELECT name, short_code, floor_location, is_active FROM hms_departments WHERE id = $1', [ctx.deptId]);
        if (d && d.is_active !== 'N') await api('PUT', `/admin/departments/${ctx.deptId}`, { token: adTok, body: { name: d.name, shortCode: d.short_code, floorLocation: d.floor_location, isActive: 'N' } });
      }
      const perm = await sql(`SELECT can_read FROM hms_permissions WHERE role = 'nurse' AND module = 'pharmacy'`);
      assert(!perm.length || perm[0].can_read === 'N', 'nurse pharmacy permission not restored');
      const rules = (await api('GET', '/security/ip-rules', { token: saTok })).data.data;
      assert(!rules.blacklist.some((r) => r.startsWith('203.0.113.')), 'test IP rule left behind');
    });
    for (const s of [sa, ad, rec]) if (s) await s.ctx.close().catch(() => {});
    await browser.close();
    done();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
