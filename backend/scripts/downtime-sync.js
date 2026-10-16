#!/usr/bin/env node
// Keeps a current downtime kit on a ward machine (completion C6). Run it
// every few minutes from the machine's scheduler (cron, Task Scheduler):
//
//   HMS_URL=https://hms.hospital.local DOWNTIME_STATION_TOKEN=<token> \
//   DOWNTIME_LOCAL_DIR=/var/lib/hms-downtime node downtime-sync.js
//
// It needs only Node 18 or later: copy this file and downtime-opener.html to
// the machine; nothing else from HMS. Each run fetches the newest kit with
// the machine's own token (an administrator registers the machine on the
// Downtime screen), checks it against the server's fingerprint, stores it
// without ever leaving a half-written file, tells the server it is stored,
// and keeps the last DOWNTIME_KEEP_LOCAL kits (default 8). If HMS cannot be
// reached, the kits already on the machine are kept and the run says how old
// the newest one is. With DOWNTIME_KIT_KEY set it also proves the kit opens.
// Exit status: 0 stored a current kit, 1 could not, 2 misconfigured.
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LATEST = 'downtime-latest.hmskit.json';
const base = String(process.env.HMS_URL || '').replace(/\/+$/, '');
const token = process.env.DOWNTIME_STATION_TOKEN || '';
const dir = process.env.DOWNTIME_LOCAL_DIR || '';
const keep = Math.max(2, Number(process.env.DOWNTIME_KEEP_LOCAL || 8));
const keyHex = process.env.DOWNTIME_KIT_KEY || '';
const timeoutMs = Number(process.env.DOWNTIME_SYNC_TIMEOUT_MS || 20000);

function exit(code, message) { (code ? console.error : console.log)(message); process.exit(code); }
if (!/^https?:\/\/[^/]+/.test(base) || !token || !dir) exit(2, 'Set HMS_URL, DOWNTIME_STATION_TOKEN and DOWNTIME_LOCAL_DIR.');
if (keyHex && !/^[0-9a-f]{64}$/i.test(keyHex)) exit(2, 'DOWNTIME_KIT_KEY must be 64 hex characters.');

// Same format as the server (services/downtime.js): AES-256-GCM with the
// kit's metadata as associated data.
function decrypt(kit, hex) {
  const { iv, tag, ciphertext, ...meta } = kit;
  const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(hex, 'hex'), Buffer.from(iv, 'base64'));
  d.setAAD(Buffer.from(JSON.stringify(meta)));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ciphertext, 'base64')), d.final()]).toString('utf8');
}

function newestLocal() {
  try {
    const kit = JSON.parse(fs.readFileSync(path.join(dir, LATEST), 'utf8'));
    return { generated: kit.generated_at, stale: new Date() > new Date(kit.stale_after) };
  } catch { return null; }
}

function offline(reason) {
  const local = newestLocal();
  exit(1, `Could not refresh the downtime kit: ${reason}. ${local
    ? `Keeping the kit made ${local.generated}${local.stale ? ' — it is now STALE' : ' (still current)'}.`
    : 'There is NO kit on this machine yet.'}`);
}

async function call(method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { authorization: `Station ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return res;
}

(async () => {
  let res;
  try { res = await call('GET', '/api/downtime/station/kit'); } catch (err) { return offline(`HMS did not answer (${err.cause?.code || err.name})`); }
  if (res.status === 401 || res.status === 403) return exit(1, 'HMS refused this machine\'s token (revoked or unknown). Ask an administrator to register the machine again.');
  if (res.status === 404) return offline('HMS has not made a downtime kit yet');
  if (!res.ok) return offline(`HMS answered ${res.status}`);
  const text = await res.text();
  const expected = res.headers.get('x-kit-sha256');
  const snapshot = res.headers.get('x-kit-snapshot');
  const name = res.headers.get('x-kit-file') || '';
  const actual = crypto.createHash('sha256').update(text).digest('hex');
  if (!expected || actual !== expected) return offline('the kit did not match the server\'s fingerprint (damaged in transit)');
  if (!/^downtime-[0-9TZ-]+\.hmskit\.json$/.test(name)) return offline('the server sent an unexpected file name');
  let kit;
  try { kit = JSON.parse(text); } catch { return offline('the kit is not readable'); }
  if (kit.format !== 'hms-downtime-1') return offline(`unknown kit format ${kit.format}`);
  if (keyHex) {
    try { decrypt(kit, keyHex); } catch { return offline('the kit does not open with this machine\'s key'); }
  }

  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const write = (file) => {
    const tmp = path.join(dir, `.${file}.${process.pid}.tmp`);
    fs.writeFileSync(tmp, text, { mode: 0o600 });
    fs.renameSync(tmp, path.join(dir, file));
  };
  write(name);
  write(LATEST);
  // The opener travels with the kits so the machine can open them without HMS.
  const opener = path.join(__dirname, 'downtime-opener.html');
  if (fs.existsSync(opener)) fs.copyFileSync(opener, path.join(dir, 'downtime-opener.html'));
  const old = fs.readdirSync(dir).filter((f) => /^downtime-\d.*\.hmskit\.json$/.test(f)).sort().slice(0, -keep);
  old.forEach((f) => fs.rmSync(path.join(dir, f), { force: true }));

  // Only a stored kit counts: the server marks this machine current on this answer.
  try {
    const ack = await call('POST', '/api/downtime/station/ack', { snapshot_id: snapshot, sha256: actual, opened: Boolean(keyHex) });
    if (!ack.ok) return exit(1, `Stored the kit made ${kit.generated_at}, but HMS did not record it (${ack.status}); this machine will show as behind.`);
  } catch (err) { return exit(1, `Stored the kit made ${kit.generated_at}, but could not tell HMS (${err.cause?.code || err.name}).`); }
  exit(0, `Stored the kit made ${kit.generated_at} (${kit.key_id}); current until ${kit.stale_after}.`);
})();
