// Downtime drills (completion C6): kit distribution to ward machines, use
// while HMS is unreachable, stale-kit recognition, and machines that fall
// behind or are revoked. Needs DOWNTIME_KIT_DIR/DOWNTIME_KIT_KEY on the API.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { chromium, BASE, API, api, apiLogin, sql, browserAs, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const ORIGIN = API.replace(/\/api$/, '');
const SCRIPTS = path.join(__dirname, '..', 'backend', 'scripts');
const KEY = process.env.DOWNTIME_KIT_KEY;
const tag = crypto.randomUUID().slice(0, 8);
const machineDir = fs.mkdtempSync(path.join(os.tmpdir(), `hms-ward-${tag}-`));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function sync(token, extra = {}) {
  return new Promise((resolve) => {
    const out = [];
    const child = spawn('node', [path.join(SCRIPTS, 'downtime-sync.js')], {
      env: { PATH: process.env.PATH, HMS_URL: ORIGIN, DOWNTIME_STATION_TOKEN: token, DOWNTIME_LOCAL_DIR: machineDir, DOWNTIME_KIT_KEY: KEY, ...extra },
    });
    child.stdout.on('data', (d) => out.push(String(d)));
    child.stderr.on('data', (d) => out.push(String(d)));
    child.on('exit', (code) => resolve({ code, text: out.join('') }));
  });
}
const latestLocal = () => fs.readFileSync(path.join(machineDir, 'downtime-latest.hmskit.json'), 'utf8');

(async () => {
  const { step, done } = runner('Downtime drills');
  assert(/^[0-9a-f]{64}$/i.test(KEY || '') && process.env.DOWNTIME_KIT_DIR, 'run with DOWNTIME_KIT_DIR and DOWNTIME_KIT_KEY set for the API');
  const admin = await apiLogin('admin');
  const nurse = await apiLogin('nurse');
  const station = {};
  let snapshot;
  const browser = await chromium.launch();

  try {
    await step('An administrator registers a ward machine; its token is shown once and only a fingerprint is kept', async () => {
      assert((await api('POST', '/downtime/stations', { token: nurse, body: { name: 'x', location: 'y' } })).status === 403, 'a nurse registered a machine');
      const r = await api('POST', '/downtime/stations', { token: admin, body: { name: `Ward 3 desk ${tag}`, location: 'Ward 3' } });
      assert(r.status === 201 && /^hdk_/.test(r.data.data.token), `register ${r.status} ${JSON.stringify(r.data)}`);
      Object.assign(station, r.data.data.station, { token: r.data.data.token });
      const [row] = await sql('SELECT token_sha256 FROM hms_downtime_stations WHERE id = $1', [station.id]);
      assert(row.token_sha256 === sha(station.token), 'the token is not stored as its fingerprint');
      const listed = await api('GET', '/downtime/stations', { token: admin });
      const mine = listed.data.data.find((s) => s.id === station.id);
      assert(mine && mine.state === 'Waiting' && !JSON.stringify(listed.data).includes(station.token), `listed ${JSON.stringify(mine)}`);
      const dup = await api('POST', '/downtime/stations', { token: admin, body: { name: `ward 3 DESK ${tag}`, location: 'Ward 3' } });
      assert(dup.status === 409, `duplicate machine name accepted: ${dup.status}`);
    });

    await step('The ward machine stores a kit it verified, with the offline opener, and shows as Current', async () => {
      const made = await api('POST', '/downtime/snapshots', { token: admin, body: {} });
      assert(made.status === 201, `refresh ${made.status}`);
      snapshot = made.data.data;
      const r = await sync(station.token);
      assert(r.code === 0 && r.text.includes('Stored the kit made'), `sync ${r.code}: ${r.text}`);
      assert(sha(latestLocal()) === snapshot.sha256, 'the stored kit is not the kit HMS made');
      assert(fs.existsSync(path.join(machineDir, path.basename(snapshot.file_name))) && fs.existsSync(path.join(machineDir, 'downtime-opener.html')), 'kit file or opener missing');
      const [receipt] = await sql('SELECT opened FROM hms_downtime_station_receipts WHERE station_id = $1 AND snapshot_id = $2', [station.id, snapshot.id]);
      assert(receipt && receipt.opened === true, 'no receipt for the stored kit');
      const mine = (await api('GET', '/downtime/stations', { token: admin })).data.data.find((s) => s.id === station.id);
      assert(mine.state === 'Current' && mine.last_opened === true, `state ${JSON.stringify(mine)}`);
      // A second run of the same kit adds no second receipt.
      assert((await sync(station.token)).code === 0, 'second sync');
      const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_downtime_station_receipts WHERE station_id = $1', [station.id]);
      assert(n === 1, `${n} receipts for one kit`);
    });

    await step('When HMS cannot be reached, or its kit file was altered, the machine keeps the kit it has and says how old it is', async () => {
      const before = latestLocal();
      const off = await sync(station.token, { HMS_URL: 'http://127.0.0.1:9' });
      assert(off.code === 1 && off.text.includes('Keeping the kit made') && off.text.includes('still current'), `offline: ${off.text}`);
      const file = path.join(process.env.DOWNTIME_KIT_DIR, snapshot.file_name);
      const original = fs.readFileSync(file, 'utf8');
      try {
        fs.writeFileSync(file, original.replace(/"ciphertext":"./, (m) => m.slice(0, -1) + (m.endsWith('A') ? 'B' : 'A')));
        const bad = await sync(station.token);
        assert(bad.code === 1 && bad.text.includes('HMS answered 503'), `altered kit was served: ${bad.text}`);
      } finally { fs.writeFileSync(file, original); }
      assert(latestLocal() === before, 'the stored kit changed');
    });

    await step('The kit opens in a browser with no server; a wrong key is named; STALE shows on screen and on the printout', async () => {
      const opener = `file://${path.join(machineDir, 'downtime-opener.html')}`;
      const kitFile = path.join(machineDir, 'downtime-latest.hmskit.json');
      const context = await browser.newContext({ offline: true });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(opener);
      await page.getByLabel('Kit file (.hmskit.json)').setInputFiles(kitFile);
      await page.getByLabel('Kit key (64 characters)').fill(crypto.randomBytes(32).toString('hex'));
      await page.getByRole('button', { name: 'Open summary' }).click();
      await page.getByRole('alert').filter({ hasText: 'does not match the kit' }).waitFor();
      await page.getByLabel('Kit key (64 characters)').fill(KEY);
      await page.getByRole('button', { name: 'Open summary' }).click();
      await page.getByRole('status').filter({ hasText: /^Current/ }).waitFor();
      const frame = page.frameLocator('iframe[title="Downtime summary"]');
      await frame.getByText('DOWNTIME SUMMARY — READ ONLY').waitFor();
      await frame.getByText(/^Current — made/).waitFor();
      await context.close();

      // The same kit opened two hours later.
      const later = await browser.newContext({ offline: true });
      const old = await later.newPage();
      await old.clock.install({ time: new Date(Date.now() + 2 * 3600 * 1000) });
      await old.goto(opener);
      await old.getByLabel('Kit file (.hmskit.json)').setInputFiles(kitFile);
      await old.getByLabel('Kit key (64 characters)').fill(KEY);
      await old.getByRole('button', { name: 'Open summary' }).click();
      await old.getByRole('alert').filter({ hasText: /^STALE/ }).waitFor();
      await old.frameLocator('iframe[title="Downtime summary"]').getByText(/^STALE — made/).waitFor();
      await later.close();
      assert(!errors.length, `page errors: ${errors.join('; ')}`);
    });

    await step('A machine that falls behind goes on the worklist; when it catches up the item says so, and an administrator closes it with a note', async () => {
      const r = await api('POST', '/downtime/stations', { token: admin, body: { name: `Pharmacy desk ${tag}`, location: 'Pharmacy' } });
      assert(r.status === 201, `register ${r.status}`);
      station.second = r.data.data;
      // Registered long enough ago to have stored a kit by now.
      await sql("UPDATE hms_downtime_stations SET registered_at = now() - interval '3 hours' WHERE id = $1", [station.second.station.id]);
      assert((await api('POST', '/downtime/snapshots', { token: admin, body: {} })).status === 201, 'refresh');
      const open = await sql("SELECT status, owner_role FROM hms_worklist_items WHERE kind = 'downtime.station_behind' AND dedupe_key = $1", [station.second.station.id]);
      assert(open.length === 1 && open[0].status === 'Open' && open[0].owner_role === 'admin', `worklist ${JSON.stringify(open)}`);
      const mine = (await api('GET', '/downtime/stations', { token: admin })).data.data.find((s) => s.id === station.second.station.id);
      assert(mine.state === 'Behind', `state ${mine.state}`);
      const caught = await sync(station.second.token);
      assert(caught.code === 0, `catch-up sync: ${caught.text}`);
      const [item] = await sql("SELECT id, status, detail FROM hms_worklist_items WHERE kind = 'downtime.station_behind' AND dedupe_key = $1", [station.second.station.id]);
      assert(item.status === 'Open' && item.detail.caught_up_at, `caught-up item ${JSON.stringify(item)}`);
      const caughtUp = (await api('GET', '/downtime/stations', { token: admin })).data.data.find((s) => s.id === station.second.station.id);
      assert(caughtUp.state === 'Current', `state after catching up ${caughtUp.state}`);
      const closed = await api('POST', `/worklist/${item.id}/resolve`, { token: admin, body: { resolution: 'Sync job restarted on the pharmacy desk machine (drill).' } });
      assert(closed.status === 200, `resolve ${closed.status} ${JSON.stringify(closed.data)}`);
    });

    await step('A revoked machine is refused at once and keeps nothing new', async () => {
      const noReason = await api('POST', `/downtime/stations/${station.second.station.id}/revoke`, { token: admin, body: {} });
      assert(noReason.status === 400, `revoked without a reason: ${noReason.status}`);
      const r = await api('POST', `/downtime/stations/${station.second.station.id}/revoke`, { token: admin, body: { reason: 'Machine replaced (drill)' } });
      assert(r.status === 200, `revoke ${r.status}`);
      const refused = await sync(station.second.token);
      assert(refused.code === 1 && refused.text.includes('refused this machine'), `revoked token: ${refused.text}`);
      const raw = await fetch(`${API}/downtime/station/kit`, { headers: { authorization: 'Station hdk_' + 'A'.repeat(43) } });
      assert(raw.status === 401, `unknown token ${raw.status}`);
      let blocked = false;
      try { await sql('DELETE FROM hms_downtime_station_receipts WHERE station_id = $1', [station.id]); } catch { blocked = true; }
      assert(blocked, 'kit receipts could be deleted');
    });

    await step('On the Downtime screen an administrator sees each machine\'s state and registers one; its token is shown once', async () => {
      const { ctx, page, errors } = await browserAs(browser, 'admin');
      try {
        await page.goto(`${BASE}/downtime`, { waitUntil: 'networkidle' });
        const panel = page.getByRole('region', { name: 'Ward machines' });
        const row = panel.locator('tbody tr', { hasText: `Ward 3 desk ${tag}` });
        await row.getByText('Current').waitFor();
        await panel.locator('tbody tr', { hasText: `Pharmacy desk ${tag}` }).getByText('Revoked').waitFor();
        await panel.getByRole('button', { name: 'Register machine' }).click();
        await page.getByLabel('Machine name').fill(`Emergency desk ${tag}`);
        await page.getByLabel('Ward or department').fill('Emergency');
        await page.getByRole('button', { name: 'Register', exact: true }).click();
        const token = await page.getByLabel('Machine token').inputValue();
        assert(/^hdk_/.test(token), `token ${token}`);
        const [row2] = await sql('SELECT token_sha256 FROM hms_downtime_stations WHERE name = $1', [`Emergency desk ${tag}`]);
        assert(row2.token_sha256 === sha(token), 'the shown token is not the registered one');
        await page.getByRole('button', { name: 'Done' }).click();
        await panel.locator('tbody tr', { hasText: `Emergency desk ${tag}` }).getByText('Waiting').waitFor();
        assert(!(await page.content()).includes(token), 'the token is still on the page');
        assert(!errors.length, `page errors: ${errors.join('; ')}`);
      } finally { await ctx.close(); }
    });
  } finally {
    await browser.close();
    fs.rmSync(machineDir, { recursive: true, force: true });
  }
  done();
  process.exit();
})();
