// Phase 2 part 6, emergency triage (migration 0015): arrivals are always
// recordable; triage is off until a clinician approves a protocol version (the
// test approves one for its own run and restores it); assessments are
// append-only; escalations must be acknowledged by the right role before a
// disposition; overdue reassessments are flagged on the board.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp, inCare } = require('./helpers');

async function call(method, url, token, body) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const { step, done } = runner('Triage');
  const desk = await apiLogin('receptionist');
  const nurse = await apiLogin('nurse');
  const doctor = await apiLogin('doctor');
  const admin = await apiLogin('admin');
  const tag = stamp();
  const ctx = {};

  await step('Recording an arrival needs no triage approval; a second open arrival for the same patient is refused', async () => {
    const reg = await call('POST', '/patients/hms/temporary', nurse, { estimatedAge: 60, arrivalNote: `arrival ${tag}` });
    assert(reg.status === 201, `temporary patient ${reg.status}`);
    ctx.patient = reg.data.data.id;
    const a = await call('POST', '/triage/arrivals', desk, { patientId: ctx.patient, arrivalMode: 'ambulance', chiefComplaint: 'Chest pain' });
    assert(a.status === 201, `arrival ${a.status} ${JSON.stringify(a.data)}`);
    ctx.arrival = a.data.data.id;
    assert((await call('POST', '/triage/arrivals', desk, { patientId: ctx.patient, arrivalMode: 'walk_in' })).status === 409, 'second open arrival accepted');
  });

  await step('With no approved protocol, assessment is refused: triage is switched off', async () => {
    const p = await call('GET', '/triage/protocols', nurse);
    assert(p.data.triage_enabled === false, 'triage reported enabled with nothing approved');
    const r = await call('POST', `/triage/arrivals/${ctx.arrival}/assessments`, nurse, { protocolKey: 'esi', protocolVersion: 5, acuityLevel: 2, reassessMinutes: 15 });
    assert(r.status === 409 && /switched off/.test(r.data.message), `assessment without approval: ${r.status} ${JSON.stringify(r.data)}`);
  });

  // Test fixture only: a clinician approves the protocol version for this run.
  const [adminRow] = await sql("SELECT id FROM hms_users WHERE username = 'admin'");
  await sql("UPDATE hms_triage_protocols SET status = 'approved', approved_by = $1, approved_at = now() WHERE protocol_key = 'esi' AND version = 5", [adminRow.id]);
  try {
    await step('Once a protocol is approved, a nurse records an assessment; receptionists cannot', async () => {
      const bad = await call('POST', `/triage/arrivals/${ctx.arrival}/assessments`, desk, { protocolKey: 'esi', protocolVersion: 5, acuityLevel: 2, reassessMinutes: 15 });
      assert(bad.status === 403, `receptionist assessed: ${bad.status}`);
      const ok = await call('POST', `/triage/arrivals/${ctx.arrival}/assessments`, nurse, { protocolKey: 'esi', protocolVersion: 5, acuityLevel: 3, reassessMinutes: 30, inputs: { heartRate: 110 } });
      assert(ok.status === 201, `assessment ${ok.status} ${JSON.stringify(ok.data)}`);
      const board = (await call('GET', '/triage/board', doctor)).data.data.find((r) => r.id === ctx.arrival);
      assert(board && board.acuity_level === 3 && board.reassessment_overdue === false, `board ${JSON.stringify(board)}`);
    });

    await step('A changed acuity is a new assessment; the earlier one cannot be altered', async () => {
      // A doctor charts only for a patient in their care (A2), so the responsible doctor is assigned first.
      const [arrival] = await sql('SELECT patient_id FROM hms_emergency_arrivals WHERE id = $1', [ctx.arrival]);
      await inCare(arrival.patient_id, 'doctor');
      const again = await call('POST', `/triage/arrivals/${ctx.arrival}/assessments`, doctor, { protocolKey: 'esi', protocolVersion: 5, acuityLevel: 2, reassessMinutes: 10 });
      assert(again.status === 201, `reassessment ${again.status}`);
      const board = (await call('GET', '/triage/board', doctor)).data.data.find((r) => r.id === ctx.arrival);
      assert(board.acuity_level === 2, `board shows ${board.acuity_level}`);
      const [{ n }] = await sql('SELECT count(*)::int AS n FROM hms_triage_assessments WHERE arrival_id = $1', [ctx.arrival]);
      assert(n === 2, `${n} assessments kept`);
      let refused = false;
      try { await sql('UPDATE hms_triage_assessments SET acuity_level = 5 WHERE arrival_id = $1', [ctx.arrival]); } catch (e) { refused = /append-only/.test(e.message); }
      assert(refused, 'an assessment was edited');
    });

    await step('Escalations go to the right role; a disposition waits until the escalation is acknowledged', async () => {
      const esc = await call('POST', `/triage/arrivals/${ctx.arrival}/escalate`, nurse, { reason: 'Deteriorating, needs review', toRole: 'doctor' });
      assert(esc.status === 201, `escalate ${esc.status}`);
      ctx.escalation = esc.data.data.id;
      const early = await call('POST', `/triage/arrivals/${ctx.arrival}/disposition`, doctor, { status: 'discharged', reason: 'Settled' });
      assert(early.status === 409 && /acknowledged/.test(early.data.message), `disposition before acknowledgement: ${early.status}`);
      assert((await call('POST', `/triage/escalations/${ctx.escalation}/acknowledge`, desk, {})).status === 403, 'desk acknowledged a doctor escalation');
      assert((await call('POST', `/triage/escalations/${ctx.escalation}/acknowledge`, doctor, {})).status === 200, 'doctor acknowledgement');
      assert((await call('POST', `/triage/escalations/${ctx.escalation}/acknowledge`, doctor, {})).status === 409, 'acknowledged twice');
    });

    await step('A disposition closes the arrival; it leaves the board and cannot be recorded twice', async () => {
      const d = await call('POST', `/triage/arrivals/${ctx.arrival}/disposition`, doctor, { status: 'admitted', reason: 'Admitted to cardiology ward' });
      assert(d.status === 200, `disposition ${d.status} ${JSON.stringify(d.data)}`);
      const board = (await call('GET', '/triage/board', doctor)).data.data;
      assert(!board.some((r) => r.id === ctx.arrival), 'closed arrival still on the board');
      assert((await call('POST', `/triage/arrivals/${ctx.arrival}/disposition`, doctor, { status: 'discharged', reason: 'again' })).status === 404, 'closed twice');
    });

    await step('An assessment that is past its reassessment time is flagged on the board', async () => {
      const arr = await call('POST', '/triage/arrivals', desk, { patientId: (await sql("SELECT id FROM hms_patients WHERE identity_status = 'registered' AND id NOT IN (SELECT patient_id FROM hms_emergency_arrivals WHERE status IN ('waiting','in_treatment')) ORDER BY id DESC LIMIT 1"))[0].id, arrivalMode: 'walk_in' });
      assert(arr.status === 201, `second arrival ${arr.status}`);
      await sql(`INSERT INTO hms_triage_assessments (arrival_id, protocol_key, protocol_version, acuity_level, inputs, assessed_by, assessed_at, reassess_due_at)
                 VALUES ($1, 'esi', 5, 4, '{}', $2, now() - interval '2 hours', now() - interval '1 hour')`, [arr.data.data.id, adminRow.id]);
      const board = (await call('GET', '/triage/board', doctor)).data.data.find((r) => r.id === arr.data.data.id);
      assert(board && board.reassessment_overdue === true, `overdue not flagged: ${JSON.stringify(board)}`);
    });
  } finally {
    await sql("UPDATE hms_triage_protocols SET status = 'pending_approval', approved_by = NULL, approved_at = NULL WHERE protocol_key = 'esi' AND version = 5");
  }

  done();
  process.exit();
})();
