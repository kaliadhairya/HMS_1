// Phase 2 part 7, signed clinical notes (migration 0016): saves and signing
// state the version they are based on (If-Match); stale or missing versions are
// refused (412 / 428); two simultaneous saves cannot both win; signing freezes a
// digest-bound version; signed content cannot change; a change is a linked,
// reasoned amendment that leaves the original version intact.
const crypto = require('crypto');
const { API, apiLogin, sql, runner, assert, stamp } = require('./helpers');

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: {
      'content-type': 'application/json', authorization: `Bearer ${token}`,
      ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null), etag: res.headers.get('etag') };
}

(async () => {
  const { step, done } = runner('Clinical documents');
  const desk = await apiLogin('receptionist');
  const doctor = await apiLogin('doctor');
  const admin = await apiLogin('admin');
  const tag = stamp();
  const ctx = {};

  await step('Setup: a patient the doctor is not yet caring for; a note needs them in care', async () => {
    const reg = await call('POST', '/patients/hms', desk, {
      patientType: 'other', name: `Note Patient ${tag}`, age: 44, gender: 'Female', opdIndoor: 'OPD',
      testDate: new Date().toISOString().slice(0, 10), phoneNumber: `94${tag}`.slice(0, 10).padEnd(10, '2'),
    });
    assert(reg.status === 201, `register ${reg.status}`);
    ctx.patient = reg.data.data.id;
    const [demo] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
    ctx.doctorUser = demo.id;
    const refused = await call('POST', '/clinical-documents', doctor, { patientId: ctx.patient, content: { chiefComplaint: 'x' } });
    assert(refused.status === 403 && refused.data.code === 'PATIENT_NOT_IN_CARE', `note without care: ${refused.status}`);
    assert((await call('POST', `/patients/hms/${ctx.patient}/care-team`, desk, { practitionerUserId: demo.id, role: 'consulting' })).status === 201, 'add to care team');
  });

  await step('A note starts at version 1 (ETag); a save without If-Match is refused (428)', async () => {
    const r = await call('POST', '/clinical-documents', doctor, { patientId: ctx.patient, content: { chiefComplaint: 'Fever for 3 days' } });
    assert(r.status === 201 && r.etag === '"1"', `create ${r.status} etag=${r.etag}`);
    ctx.doc = r.data.data.id;
    const noMatch = await call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { history: 'x' } });
    assert(noMatch.status === 428, `save without If-Match: ${noMatch.status}`);
  });

  await step('A save with the current version succeeds; a stale version is refused (412) and shows the current one', async () => {
    const ok = await call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { chiefComplaint: 'Fever for 3 days', history: 'Rigors at night' } }, { 'if-match': '"1"' });
    assert(ok.status === 200 && ok.data.data.version === 2, `save ${ok.status} ${JSON.stringify(ok.data)}`);
    const stale = await call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { history: 'older copy' } }, { 'if-match': '"1"' });
    assert(stale.status === 412 && stale.data.code === 'VERSION_STALE' && stale.data.current === 2, `stale: ${stale.status} ${JSON.stringify(stale.data)}`);
  });

  await step('Two saves made from the same version at the same moment: exactly one is accepted', async () => {
    const results = await Promise.all([
      call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { plan: 'Plan A' } }, { 'if-match': '"2"' }),
      call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { plan: 'Plan B' } }, { 'if-match': '"2"' }),
    ]);
    const statuses = results.map((r) => r.status).sort().join(',');
    assert(statuses === '200,412', `statuses ${statuses}`);
    const [row] = await sql('SELECT draft_version FROM hms_clinical_documents WHERE id = $1', [ctx.doc]);
    assert(Number(row.draft_version) === 3, `version ${row.draft_version}`);
  });

  await step('Signing at the current version freezes the note with a 64-character digest', async () => {
    const stale = await call('POST', `/clinical-documents/${ctx.doc}/sign`, doctor, undefined, { 'if-match': '"2"' });
    assert(stale.status === 412, `sign stale: ${stale.status}`);
    const signed = await call('POST', `/clinical-documents/${ctx.doc}/sign`, doctor, undefined, { 'if-match': '"3"' });
    assert(signed.status === 200 && signed.data.data.state === 'signed' && signed.data.digest.length === 64, `sign ${signed.status} ${JSON.stringify(signed.data)}`);
    assert(signed.data.data.signed_version === 1, `signed version ${signed.data.data.signed_version}`);
  });

  await step('A signed note cannot be saved or signed again; the database refuses to change a signature', async () => {
    const save = await call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { plan: 'sneaky' } }, { 'if-match': '"3"' });
    assert(save.status === 409 && save.data.code === 'NOTE_SIGNED', `save after signing: ${save.status}`);
    assert((await call('POST', `/clinical-documents/${ctx.doc}/sign`, doctor, undefined, { 'if-match': '"3"' })).status === 409, 'signed twice');
    let refused = false;
    try { await sql("UPDATE hms_document_signatures SET content = '{}' WHERE document_id = $1", [ctx.doc]); } catch (e) { refused = /immutable/.test(e.message); }
    assert(refused, 'signature content was changed');
  });

  await step('An amendment needs a reason, starts a new version, and is signed as a linked version; the original stays', async () => {
    const noReason = await call('POST', `/clinical-documents/${ctx.doc}/amend`, doctor, { reason: 'x' }, { 'if-match': '"3"' });
    assert(noReason.status === 422, `amend without reason: ${noReason.status}`);
    const signedBefore = (await call('GET', `/clinical-documents/${ctx.doc}`, doctor)).data.data.content;
    const amend = await call('POST', `/clinical-documents/${ctx.doc}/amend`, doctor, { reason: 'Wrong duration of fever, corrected' }, { 'if-match': '"3"' });
    assert(amend.status === 200 && amend.data.data.state === 'draft', `amend ${amend.status} ${JSON.stringify(amend.data)}`);
    const fix = await call('PUT', `/clinical-documents/${ctx.doc}/draft`, doctor, { content: { chiefComplaint: 'Fever for 5 days', history: 'Rigors at night' } }, { 'if-match': amend.etag });
    assert(fix.status === 200, `amended draft ${fix.status}`);
    const signed = await call('POST', `/clinical-documents/${ctx.doc}/sign-amendment`, doctor, { reason: 'Wrong duration of fever, corrected' }, { 'if-match': fix.etag });
    assert(signed.status === 200 && signed.data.data.signed_version === 2, `sign amendment ${signed.status} ${JSON.stringify(signed.data)}`);
    const versions = (await call('GET', `/clinical-documents/${ctx.doc}/versions`, doctor)).data.data;
    assert(versions.length === 2 && versions[0].meaning === 'authored and signed' && versions[1].amends_version === 1 && versions[1].amendment_reason.length > 10, `versions ${JSON.stringify(versions.map((v) => [v.version, v.meaning, v.amends_version]))}`);
    assert(JSON.stringify(versions[0].content) === JSON.stringify(signedBefore), 'the original version changed');
    assert(versions[1].content.chiefComplaint === 'Fever for 5 days', 'the amendment content is missing');
    assert(versions[0].digest !== versions[1].digest, 'amendment has the same digest as the original');
  });

  await step('Only the author writes; administrators can read the note but cannot change it', async () => {
    assert((await call('POST', `/clinical-documents/${ctx.doc}/amend`, admin, { reason: 'An admin trying to amend' }, { 'if-match': '"4"' })).status === 403, 'admin amended');
    assert((await call('GET', `/clinical-documents/${ctx.doc}`, admin)).status === 200, 'admin cannot read');
    assert((await call('POST', '/clinical-documents', desk, { patientId: ctx.patient, content: {} })).status === 403, 'desk created a note');
  });

  done();
  process.exit();
})();
