// Catch-up of live events through the v2 API (completion A3, blueprint 3.10): a doctor recovers
// missed events only for patients in their care and their facility; events name the patient by
// public identifier; a cursor resumes after the last event received without repeats; a bad
// cursor is a field error. Probe events are inserted directly into the outbox (test-only).
const crypto = require('crypto');
const { API, apiLogin, sql, sleep, inCare, runner, assert, requireThrowawayDb } = require('./helpers');

requireThrowawayDb();
const tag = crypto.randomUUID().slice(0, 8);
const PROBE = `v2_probe_${tag}`;

async function get(url, token) {
  const res = await fetch(API + url, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const probe = (patientId, facility = null) => sql(`INSERT INTO hms_outbox (event_type, audience, payload, patient_id, facility_id)
  VALUES ($1, 'all', CAST($2 AS jsonb), $3, CAST($4 AS uuid)) RETURNING id`, [PROBE, JSON.stringify({ probe: tag }), patientId, facility]).then(([r]) => String(r.id));
async function sequenced(ids) {
  for (let i = 0; i < 50; i += 1) {
    const rows = await sql('SELECT count(*)::int AS n FROM hms_outbox WHERE id = ANY($1::bigint[]) AND delivery_sequence IS NOT NULL', [ids]);
    if (rows[0].n === ids.length) return;
    await sleep(200);
  }
  throw new Error('the dispatcher did not sequence the probe events');
}
async function recover(token, cursor) {
  const seen = [];
  for (let i = 0; i < 50; i += 1) {
    const r = await get(`/v2/events?cursor=${cursor}`, token);
    assert(r.status === 200, `events ${r.status} ${JSON.stringify(r.data).slice(0, 200)}`);
    seen.push(...r.data.data.events.filter((e) => e.type === PROBE));
    cursor = r.data.data.next_cursor;
    if (!r.data.data.has_more) return { seen, cursor };
  }
  throw new Error('event paging did not finish');
}

(async () => {
  const { step, done } = runner('V2 events');
  const doctor = await apiLogin('doctor');
  const nurse = await apiLogin('nurse');
  const [doctorUser] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const [mine, other] = await sql("INSERT INTO hms_patients(name,uhid,patienttype,age,gender,opdindoor,testdate) SELECT 'Synthetic events ' || $1 || '-' || n, 'V2E-' || $1 || '-' || n, 'other', 30, 'Other', 'OPD', CURRENT_DATE FROM generate_series(1,2) n RETURNING id, public_id", [tag]);
  await inCare(mine.id);
  const [{ inside }] = await sql('SELECT patient_in_care($1, $2) AS inside', [doctorUser.id, other.id]);
  assert(!inside, 'the second synthetic patient must not be in the doctor\'s care');
  const [{ facility }] = await sql('SELECT hms_initial_facility()::text AS facility');
  const [{ id: away }] = await sql("INSERT INTO hms_facilities (code, name, timezone) VALUES ($1, 'Synthetic second facility', 'Asia/Kolkata') RETURNING id::text", [`E-${tag}`]);
  let start, ids;

  await step('Without a cursor the feed returns no events and the cursor to start from', async () => {
    const r = await get('/v2/events', doctor);
    assert(r.status === 200 && r.data.data.events.length === 0 && /^\d+$/.test(r.data.data.next_cursor), `start ${JSON.stringify(r.data).slice(0, 160)}`);
    start = r.data.data.next_cursor;
    const bad = await get('/v2/events?cursor=-1', doctor);
    assert(bad.status === 422 && bad.data.code === 'INVALID_CURSOR', `bad cursor ${bad.status}`);
  });

  await step('A doctor recovers only events of a patient in their care and their facility', async () => {
    ids = { mine: await probe(mine.id), other: await probe(other.id), elsewhere: await probe(mine.id, away), facility: await probe(mine.id, facility) };
    await sequenced(Object.values(ids));
    const { seen } = await recover(doctor, start);
    const got = seen.map((e) => e.id).sort();
    assert(JSON.stringify(got) === JSON.stringify([ids.mine, ids.facility].sort()), `doctor recovered ${JSON.stringify(got)} of ${JSON.stringify(ids)}`);
    assert(seen.every((e) => e.patient_id === mine.public_id && e.data.probe === tag && /^\d+$/.test(e.sequence)), `envelope ${JSON.stringify(seen[0]).slice(0, 220)}`);
  });

  await step('A nurse recovers every patient\'s events in the facility, never another facility\'s', async () => {
    const { seen } = await recover(nurse, start);
    const got = seen.map((e) => e.id);
    assert(got.includes(ids.mine) && got.includes(ids.other) && got.includes(ids.facility) && !got.includes(ids.elsewhere), `nurse recovered ${JSON.stringify(got)}`);
  });

  await step('Resuming from the returned cursor repeats nothing and picks up the next event', async () => {
    const first = await recover(doctor, start);
    const again = await recover(doctor, first.cursor);
    assert(again.seen.length === 0, `repeated ${again.seen.length} events`);
    const next = await probe(mine.id);
    await sequenced([next]);
    const later = await recover(doctor, first.cursor);
    assert(later.seen.length === 1 && later.seen[0].id === next, `after the cursor ${JSON.stringify(later.seen.map((e) => e.id))}`);
  });

  done();
  process.exit();
})().catch((e) => { console.error(e.message); process.exit(1); });
