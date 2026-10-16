// ABDM gateway adapter (Phase 6C-6E). Everything that depends on ABDM's wire
// format is here: endpoint paths, headers, session tokens, signature checks
// on incoming calls. The paths follow the ABDM V3 APIs as published by NHA
// and must be confirmed against the sandbox when the hospital is registered
// (plan item O1); they are one table so that check touches one place.
//
//   ABDM_GATEWAY_URL      base of the HIECM gateway (sandbox: https://dev.abdm.gov.in/api/hiecm)
//   ABDM_ABHA_URL         base of the ABHA APIs (sandbox: https://abhasbx.abdm.gov.in/abha/api)
//   ABDM_CLIENT_ID / ABDM_CLIENT_SECRET   facility credentials from ABDM
//   ABDM_CM_ID (sbx), ABDM_HIP_ID, ABDM_HIU_ID   identifiers assigned by ABDM
//   ABDM_GATEWAY_JWKS_URL  keys that sign the gateway's calls to us
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const I = require('./interfaces');
const { storage } = require('../utils/auditContext');
// The log of a synchronous ABHA call is kept even when the staff request
// fails, so it is written outside the request's transaction.
const outside = (fn) => storage.run({ ...(storage.getStore() || {}), command: null }, fn);

const PATHS = {
  session: '/gateway/v3/sessions',
  // M1 (ABHA service)
  abhaLoginOtp: '/v3/profile/login/request/otp',
  abhaLoginVerify: '/v3/profile/login/verify',
  abhaEnrolOtp: '/v3/enrollment/request/otp',
  abhaEnrolByAadhaar: '/v3/enrollment/enrol/byAadhaar',
  abhaPublicKey: '/v3/profile/public/certificate',
  // M1 scan and share (gateway -> HIP callback answered here)
  shareOnShare: '/patient-share/v3/on-share',
  // M2 (HIP)
  linkTokenGenerate: '/v3/token/generate-token',
  linkCareContext: '/hip/v3/link/carecontext',
  discoverOnDiscover: '/user-initiated-linking/v3/patient/care-context/on-discover',
  linkOnInit: '/user-initiated-linking/v3/link/care-context/on-init',
  linkOnConfirm: '/user-initiated-linking/v3/link/care-context/on-confirm',
  consentHipOnNotify: '/consent/v3/request/hip/on-notify',
  hiOnRequest: '/data-flow/v3/health-information/hip/on-request',
  hiNotify: '/data-flow/v3/health-information/notify',
  // M3 (HIU)
  consentInit: '/consent/v3/request/init',
  consentHiuOnNotify: '/consent/v3/request/hiu/on-notify',
  consentFetch: '/consent/v3/fetch',
  hiRequest: '/data-flow/v3/health-information/request',
};
// What the gateway calls on this hospital (mounted under ABDM_BRIDGE_PATH).
const CALLBACKS = {
  share: '/api/v3/hip/patient/share',
  discover: '/api/v3/hip/patient/care-context/discover',
  linkInit: '/api/v3/hip/link/care-context/init',
  linkConfirm: '/api/v3/hip/link/care-context/confirm',
  linkTokenOnGenerate: '/api/v3/hip/token/on-generate-token',
  linkOnCareContext: '/api/v3/link/on_carecontext',
  consentHipNotify: '/api/v3/consent/request/hip/notify',
  hiRequest: '/api/v3/hip/health-information/request',
  consentOnInit: '/api/v3/hiu/consent/request/on-init',
  consentHiuNotify: '/api/v3/hiu/consent/request/notify',
  consentOnFetch: '/api/v3/hiu/consent/on-fetch',
  hiOnRequest: '/api/v3/hiu/health-information/on-request',
  dataPush: '/api/v3/hiu/data/push',
};

const cfg = () => ({
  gateway: process.env.ABDM_GATEWAY_URL, abha: process.env.ABDM_ABHA_URL, clientId: process.env.ABDM_CLIENT_ID, clientSecret: process.env.ABDM_CLIENT_SECRET,
  cmId: process.env.ABDM_CM_ID || 'sbx', hipId: process.env.ABDM_HIP_ID, hiuId: process.env.ABDM_HIU_ID, jwks: process.env.ABDM_GATEWAY_JWKS_URL,
});
const configured = () => Boolean(cfg().gateway && cfg().clientId && cfg().clientSecret);
const notConfigured = () => Object.assign(new Error('ABDM is not configured for this hospital (ABDM_GATEWAY_URL, ABDM_CLIENT_ID, ABDM_CLIENT_SECRET).'), { status: 503, code: 'ABDM_NOT_CONFIGURED', beforeSend: true });

let session = null;
async function token() {
  if (session && session.expires > Date.now() + 30000) return session.token;
  const c = cfg();
  const r = await fetch(c.gateway + PATHS.session, {
    method: 'POST', headers: { 'content-type': 'application/json', 'REQUEST-ID': crypto.randomUUID(), TIMESTAMP: new Date().toISOString(), 'X-CM-ID': c.cmId },
    body: JSON.stringify({ clientId: c.clientId, clientSecret: c.clientSecret, grantType: 'client_credentials' }), signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw Object.assign(new Error(`ABDM session refused: ${r.status}`), { permanent: r.status === 401 || r.status === 403 });
  const body = await r.json();
  session = { token: body.accessToken, expires: Date.now() + (Number(body.expiresIn) || 600) * 1000 };
  return session.token;
}

const headers = async (requestId, extra = {}) => {
  const c = cfg();
  return { 'content-type': 'application/json', Authorization: `Bearer ${await token()}`, 'REQUEST-ID': requestId, TIMESTAMP: new Date().toISOString(), 'X-CM-ID': c.cmId,
    ...(c.hipId ? { 'X-HIP-ID': c.hipId } : {}), ...(c.hiuId ? { 'X-HIU-ID': c.hiuId } : {}), ...extra };
};

async function post(url, body, requestId, extra) {
  await I.assertExternalAllowed();
  const r = await fetch(url, { method: 'POST', headers: await headers(requestId, extra), body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!r.ok) throw Object.assign(new Error(`ABDM request refused with status ${r.status}`), { permanent: r.status >= 400 && r.status < 500 && r.status !== 429, status: r.status, data });
  return data;
}

// Synchronous ABHA call (staff wait for the answer); logged as a delivered
// or failed interface message with the OTP and Aadhaar left out.
async function abha(pathKey, body, { redacted = {}, patientId = null } = {}) {
  if (!configured() || !cfg().abha) throw notConfigured();
  const requestId = crypto.randomUUID();
  // Logged as already attempted, so the delivery worker never resends it.
  const log = await outside(() => I.enqueue({ system: 'abdm-abha', type: pathKey, version: 'v3', externalId: requestId, payload: { path: PATHS[pathKey], body: { ...body, ...redacted } }, patientId, maxAttempts: 1, sentByCaller: true }));
  try {
    const data = await post(cfg().abha + PATHS[pathKey], body, requestId);
    await outside(() => I.settle(log.id, 'Delivered', { response: { ok: true }, leaseToken: log.lease_token }));
    return data;
  } catch (err) {
    await outside(() => I.settle(log.id, 'Failed', { error: err.message, leaseToken: log.lease_token }));
    throw Object.assign(new Error(err.status && err.status < 500 ? 'ABDM refused the request. Check the details and try again.' : 'ABDM did not answer. Try again shortly.'), { status: err.status && err.status < 500 ? 422 : 502, code: 'ABDM_ERROR', detail: err.data });
  }
}

// ABHA APIs take Aadhaar numbers, login IDs and OTPs encrypted with ABDM's
// public key (RSA-OAEP, SHA-1), fetched once from the ABHA service.
let abhaKey = null;
async function abhaEncrypt(value) {
  await I.assertExternalAllowed();
  if (!configured() || !cfg().abha) throw notConfigured();
  if (!abhaKey) {
    const r = await fetch(cfg().abha + PATHS.abhaPublicKey, { headers: await headers(crypto.randomUUID()), signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error('ABDM public key unavailable.'), { status: 502 });
    const body = await r.json();
    abhaKey = crypto.createPublicKey({ key: Buffer.from(body.publicKey, 'base64'), format: 'der', type: 'spki' });
  }
  return crypto.publicEncrypt({ key: abhaKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(String(value))).toString('base64');
}

// Asynchronous gateway call, delivered by the interface worker with retries.
const send = (pathKey, body, { requestId = crypto.randomUUID(), correlationId = null, patientId = null, headers: extra } = {}, t) =>
  I.enqueue({ system: 'abdm-gateway', type: pathKey, version: 'v3', externalId: requestId, correlationId, payload: { path: PATHS[pathKey], body, headers: extra }, patientId }, t);
// Encrypted records to the requester's data push URL (not through the gateway).
const push = (url, body, { requestId = crypto.randomUUID(), correlationId, patientId } = {}, t) =>
  I.enqueue({ system: 'abdm-datapush', type: 'data-push', version: 'v3', externalId: requestId, correlationId, endpoint: url, payload: body, patientId }, t);

I.register('abdm-gateway', async (m) => { if (!configured()) throw notConfigured(); return post(cfg().gateway + m.payload.path, m.payload.body, m.external_id, m.payload.headers); },
  { ownerRole:'super_admin',versions:['v3'],messageTypes:Object.keys(PATHS),idempotency:process.env.HMS_ABDM_IDEMPOTENCY_SUPPORTED==='true'?'PROVIDER_KEY':'RECONCILE' });
async function pushSend(m) {
  await I.assertExternalAllowed();
  const r = await fetch(m.endpoint, { method: 'POST', headers: { 'content-type': 'application/json','Idempotency-Key':m.delivery_key,'REQUEST-ID':m.external_id }, body: JSON.stringify(m.payload), signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw Object.assign(new Error(`data push ${r.status}`), { permanent: r.status >= 400 && r.status < 500 && r.status !== 429 });
  return { status: r.status };
}
I.register('abdm-datapush', pushSend,{ownerRole:'super_admin',versions:['v3'],messageTypes:['data-push'],idempotency:process.env.HMS_ABDM_IDEMPOTENCY_SUPPORTED==='true'?'PROVIDER_KEY':'RECONCILE'});

// Incoming gateway calls carry a token signed by the gateway (RS256).
let jwksCache = { at: 0, keys: [] };
async function gatewayKeys() {
  if (Date.now() - jwksCache.at < 10 * 60000 && jwksCache.keys.length) return jwksCache.keys;
  if (!cfg().jwks) throw notConfigured();
  const r = await fetch(cfg().jwks, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`gateway keys: ${r.status}`);
  jwksCache = { at: Date.now(), keys: (await r.json()).keys || [] };
  return jwksCache.keys;
}
async function verifyGatewayCall(req) {
  const auth = String(req.get('authorization') || '');
  if (!auth.startsWith('Bearer ')) throw Object.assign(new Error('Missing gateway token.'), { status: 401 });
  const raw = auth.slice(7);
  const decoded = jwt.decode(raw, { complete: true });
  if (!decoded) throw Object.assign(new Error('Unreadable gateway token.'), { status: 401 });
  const keys = await gatewayKeys();
  const jwk = keys.find((k) => k.kid === decoded.header.kid) || (keys.length === 1 ? keys[0] : null);
  if (!jwk) throw Object.assign(new Error('Unknown gateway signing key.'), { status: 401 });
  try { return jwt.verify(raw, crypto.createPublicKey({ key: jwk, format: 'jwk' }), { algorithms: ['RS256'] }); } catch (err) {
    throw Object.assign(new Error(`Gateway token refused: ${err.message}`), { status: 401 });
  }
}

module.exports = { PATHS, CALLBACKS, cfg, configured, abha, abhaEncrypt, send, push, pushSend, verifyGatewayCall, _reset: () => { session = null; jwksCache = { at: 0, keys: [] }; abhaKey = null; } };
