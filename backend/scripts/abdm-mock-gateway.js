// Local stand-in for the ABDM gateway and ABHA service, for tests only
// (Phase 6C-6E). It is NOT ABDM: it follows this hospital's adapter
// (services/abdmGateway.js) so the hospital-side rules can be tested end to
// end. Real conformance needs the ABDM sandbox (plan item O1).
//
//   PORT (default 9320)
//   Records every call it receives (GET /_mock/received?path=...), signs its
//   own calls to the hospital like the gateway (RS256, JWKS at /certs), holds
//   ABHA profiles (POST /_mock/profiles), decrypts the RSA-encrypted login IDs
//   and OTPs (test OTP 123456), plays a remote HIP (POST /_mock/push) and can
//   fail on purpose (POST /_mock/fail).
const http = require('http');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const AC = require('../services/abdmCrypto');

const PORT = Number(process.env.PORT || 9320);
const signing = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'mock-gateway-1';
const jwk = { ...signing.publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const abhaKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const OTP = '123456';
const received = [];
const profiles = new Map(); // abha number -> profile
const txns = new Map(); // txnId -> abha number
const failures = []; // { prefix, count, status }
const datapushes = [];

const decryptRsa = (b64) => crypto.privateDecrypt({ key: abhaKeys.privateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, Buffer.from(b64, 'base64')).toString();
const send = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(body === undefined ? '' : JSON.stringify(body)); };
const token = (claims = {}) => jwt.sign({ iss: 'mock-gateway', ...claims }, signing.privateKey, { algorithm: 'RS256', keyid: kid, expiresIn: '5m' });

async function callHospital(url, body, { requestId = crypto.randomUUID(), auth = 'valid' } = {}) {
  const headers = { 'content-type': 'application/json', 'REQUEST-ID': requestId, TIMESTAMP: new Date().toISOString(), 'X-CM-ID': 'sbx' };
  if (auth === 'valid') headers.authorization = `Bearer ${token()}`;
  if (auth === 'forged') headers.authorization = `Bearer ${jwt.sign({ iss: 'mock-gateway' }, crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey, { algorithm: 'RS256', keyid: kid })}`;
  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: r.status, data, requestId };
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString();
  let body = null; try { body = raw ? JSON.parse(raw) : null; } catch { body = raw; }
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;
  try {
    // ── test controls ──
    if (path === '/certs') return send(res, 200, { keys: [jwk] });
    if (path === '/_mock/received') return send(res, 200, received.filter((r) => !url.searchParams.get('path') || r.path.includes(url.searchParams.get('path'))));
    if (path === '/_mock/datapushes') return send(res, 200, datapushes);
    if (path === '/_mock/profiles' && req.method === 'POST') { profiles.set(String(body.abhaNumber).replace(/-/g, ''), body); return send(res, 201, {}); }
    if (path === '/_mock/fail' && req.method === 'POST') { failures.push({ prefix: body.prefix, count: body.count ?? 1, status: body.status || 503 }); return send(res, 201, {}); }
    if (path === '/_mock/call' && req.method === 'POST') return send(res, 200, await callHospital(body.url, body.body, { requestId: body.requestId, auth: body.auth || 'valid' }));
    if (path === '/_mock/push' && req.method === 'POST') {
      // Remote HIP: encrypt documents for the hospital's key material and push.
      const texts = body.documents.map((d) => JSON.stringify(d));
      const { keyMaterial, content } = AC.encryptFor(body.keyMaterial, texts);
      const entries = content.map((c, i) => ({ content: body.tamper && i === 0 ? c.slice(0, -4) + 'AAAA' : c, media: 'application/fhir+json', checksum: crypto.createHash('sha256').update(texts[i]).digest('hex'), careContextReference: body.careContextReference || 'REMOTE-CC-1' }));
      return send(res, 200, await callHospital(body.dataPushUrl, { pageNumber: 1, pageCount: 1, transactionId: body.transactionId, entries, keyMaterial }, { auth: 'none' }));
    }
    if (path.startsWith('/_mock/datapush/')) {
      const refused = failNow(path);
      datapushes.push({ name: path.split('/').pop(), body: refused ? null : body, accepted: !refused, at: new Date().toISOString() });
      return refused || send(res, 202, {});
    }

    // ── gateway and ABHA ──
    received.push({ path, method: req.method, headers: req.headers, body, at: new Date().toISOString() });
    const forced = failNow(path); if (forced) return forced;
    if (path === '/gateway/v3/sessions') return send(res, 200, { accessToken: token({ sub: body?.clientId }), expiresIn: 1200 });
    if (path === '/v3/profile/public/certificate') return send(res, 200, { publicKey: abhaKeys.publicKey.export({ format: 'der', type: 'spki' }).toString('base64') });
    if (path === '/v3/profile/login/request/otp') {
      const id = decryptRsa(body.loginId).replace(/-/g, '');
      const match = profiles.get(id) || [...profiles.values()].find((p) => p.mobile === id || p.abhaAddress === id);
      if (!match) return send(res, 400, { code: 'ABDM-1100', message: 'No ABHA found' });
      const txnId = crypto.randomUUID(); txns.set(txnId, String(match.abhaNumber).replace(/-/g, ''));
      return send(res, 200, { txnId, message: 'OTP sent' });
    }
    if (path === '/v3/profile/login/verify') {
      const { txnId, otpValue } = body.authData.otp;
      if (!txns.has(txnId) || decryptRsa(otpValue) !== OTP) return send(res, 400, { code: 'ABDM-1204', message: 'Invalid OTP' });
      return send(res, 200, { profile: profiles.get(txns.get(txnId)) });
    }
    if (path === '/v3/enrollment/request/otp') {
      const aadhaar = decryptRsa(body.loginId);
      if (!/^\d{12}$/.test(aadhaar)) return send(res, 400, { message: 'bad aadhaar' });
      const txnId = crypto.randomUUID(); txns.set(txnId, `enrol:${aadhaar}`);
      return send(res, 200, { txnId });
    }
    if (path === '/v3/enrollment/enrol/byAadhaar') {
      const { txnId, otpValue } = body.authData.otp;
      if (!String(txns.get(txnId) || '').startsWith('enrol:') || decryptRsa(otpValue) !== OTP) return send(res, 400, { message: 'Invalid OTP' });
      const enrolled = [...profiles.values()].find((p) => p.enrolAadhaar === txns.get(txnId).slice(6));
      return enrolled ? send(res, 200, { ABHAProfile: enrolled }) : send(res, 400, { message: 'no profile prepared for this Aadhaar' });
    }
    return send(res, 202, {});
  } catch (err) {
    return send(res, 500, { message: err.message });
  }

  function failNow(p) {
    const f = failures.find((x) => p.startsWith(x.prefix) && x.count > 0);
    if (!f) return null;
    f.count--;
    return send(res, f.status, { message: 'mock failure' }) || true;
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`ABDM mock gateway on ${PORT}`));
