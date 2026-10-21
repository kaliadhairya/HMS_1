// An outpatient visit with an open billing account, made through the routes the desk uses, and
// optionally an issued invoice made through the v2 billing commands. Test-only synthetic data.
const crypto = require('crypto');
const { API, apiLogin, sql, assert, stamp } = require('../helpers');

async function call(method, url, token, body, headers = {}) {
  const res = await fetch(API + url, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(method !== 'GET' ? { 'idempotency-key': crypto.randomUUID() } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const short = (r) => `${r.status} ${JSON.stringify(r.data).slice(0, 220)}`;

async function outpatientAccount(label = 'V2 billing') {
  const desk = await apiLogin('receptionist');
  const doctor = await apiLogin('doctor');
  const [doc] = await sql("SELECT id FROM hms_users WHERE username = 'doctor'");
  const reg = await call('POST', '/patients/hms', desk, {
    patientType: 'other', name: `${label} ${stamp()}`, age: 40, gender: 'Female', opdIndoor: 'OPD',
    testDate: new Date().toISOString().slice(0, 10), phoneNumber: `9${String(Date.now()).slice(-9)}`,
  });
  assert(reg.status === 201, `register ${short(reg)}`);
  const patientId = reg.data.data.id;
  await call('POST', `/patients/hms/${patientId}/care-team`, desk, { practitionerUserId: doc.id, role: 'consulting' });
  const enc = await call('POST', '/hms/encounters', doctor, { patient_id: patientId });
  assert(enc.status === 201 || enc.status === 200, `encounter ${short(enc)}`);
  const encounterId = enc.data.id ?? enc.data.data?.id;
  const opened = await call('GET', `/finance/accounts/by-episode?encounterId=${encounterId}`, desk);
  assert(opened.status === 200, `account ${short(opened)}`);
  const [{ public_id: patientPublic }] = await sql('SELECT public_id FROM hms_patients WHERE id = $1', [patientId]);
  return { patientId, patientPublic, encounterId, accountId: opened.data.data.id };
}

// An issued invoice of `count` consultation charges (Rs. 200 each on the default price list).
async function issuedInvoice(count = 2, label) {
  const desk = await apiLogin('receptionist');
  const ctx = await outpatientAccount(label);
  for (let i = 0; i < count; i += 1) {
    const c = await call('POST', `/v2/billing-accounts/${ctx.accountId}/charges`, desk, { code: 'CONSULT-DEFAULT' });
    assert(c.status === 201, `charge ${short(c)}`);
  }
  const draft = await call('POST', `/v2/billing-accounts/${ctx.accountId}/draft-invoice`, desk, {});
  assert(draft.status === 200, `draft ${short(draft)}`);
  const inv = await call('POST', `/v2/billing-accounts/${ctx.accountId}/invoices`, desk, {}, { 'if-match': `"${draft.data.data.version}"` });
  assert(inv.status === 201, `issue ${short(inv)}`);
  return { ...ctx, invoice: inv.data.data };
}

module.exports = { outpatientAccount, issuedInvoice };
