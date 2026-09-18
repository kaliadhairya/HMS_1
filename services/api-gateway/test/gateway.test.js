const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const pino = require('pino');
const { createGateway, UNTRUSTED_IDENTITY_HEADERS } = require('../src/app');

const jwtSecret = 'gateway-test-jwt-secret';
const internalServiceSecret = 'gateway-test-internal-secret-32-characters-minimum';

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

function address(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function config(monolithUrl, identityUrl = monolithUrl) {
  return {
    serviceName: 'api-gateway-test',
    monolithUrl,
    identityUrl,
    patientUrl: monolithUrl,
    opdUrl: monolithUrl,
    jwtSecret,
    internalServiceSecret,
    allowedOrigins: ['http://localhost:4999'],
    proxyTimeoutMs: 1000,
    shutdownTimeoutMs: 1000,
    authRateLimitWindowMs: 60000,
    authRateLimitMax: 100,
    apiRateLimitWindowMs: 60000,
    apiRateLimitMax: 1000,
  };
}

async function startGateway(monolithUrl, identityUrl = monolithUrl) {
  const logger = pino({ level: 'silent' });
  const { app } = createGateway(config(monolithUrl, identityUrl), logger);
  return listen(app);
}

test('health and readiness distinguish gateway from upstream health', async (t) => {
  const upstream = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ status: 'ok' }));
  });
  const gateway = await startGateway(address(upstream));
  t.after(() => Promise.all([close(gateway), close(upstream)]));

  const health = await fetch(`${address(gateway)}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).service, 'api-gateway-test');
  const ready = await fetch(`${address(gateway)}/ready`);
  assert.equal(ready.status, 200);
  assert.equal((await ready.json()).upstream, 'ready');
});

test('streams JSON, query strings, and multipart bodies unchanged', async (t) => {
  const seen = [];
  const upstream = await listen((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({ url: req.url, type: req.headers['content-type'], body: Buffer.concat(chunks) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  const gateway = await startGateway(address(upstream));
  t.after(() => Promise.all([close(gateway), close(upstream)]));

  const json = '{"patient":"A","value":7}';
  assert.equal((await fetch(`${address(gateway)}/api/patients?q=a%20b`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: json,
  })).status, 200);
  const multipart = '--x\r\nContent-Disposition: form-data; name="logo"; filename="a.txt"\r\n\r\nhello\r\n--x--\r\n';
  assert.equal((await fetch(`${address(gateway)}/api/admin/hospital-profile`, {
    method: 'PUT', headers: { 'content-type': 'multipart/form-data; boundary=x' }, body: multipart,
  })).status, 200);

  assert.equal(seen[0].url, '/api/patients?q=a%20b');
  assert.equal(seen[0].body.toString(), json);
  assert.equal(seen[1].body.toString(), multipart);
});

test('rejects invalid JWT and replaces forgeable identity headers with signed context', async (t) => {
  let headers;
  const upstream = await listen((req, res) => {
    headers = req.headers;
    res.end('ok');
  });
  const identity = await listen((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ context: { id: 7, username: 'doctor', name: 'Doctor', role: 'doctor', permissions: [] } }));
  });
  const gateway = await startGateway(address(upstream), address(identity));
  t.after(() => Promise.all([close(gateway), close(upstream), close(identity)]));

  const invalid = await fetch(`${address(gateway)}/api/patients`, { headers: { authorization: 'Bearer invalid' } });
  assert.equal(invalid.status, 401);

  const token = jwt.sign({ id: 7, username: 'doctor', role: 'doctor' }, jwtSecret);
  const forged = Object.fromEntries(UNTRUSTED_IDENTITY_HEADERS.map((name) => [name, 'forged']));
  const valid = await fetch(`${address(gateway)}/api/patients`, {
    headers: { ...forged, authorization: `Bearer ${token}` },
  });
  assert.equal(valid.status, 200);
  assert.equal(headers['x-user-id'], undefined);
  assert.equal(headers['x-internal-service'], 'api-gateway-test');
  assert.notEqual(headers['x-auth-context'], 'forged');
  assert.notEqual(headers['x-auth-context-signature'], 'forged');
});

test('returns a structured 503 when the monolith is unavailable', async (t) => {
  const gateway = await startGateway('http://127.0.0.1:1');
  t.after(() => close(gateway));
  const response = await fetch(`${address(gateway)}/api/patients`);
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.error.code, 'UPSTREAM_UNAVAILABLE');
  assert.equal(typeof body.error.requestId, 'string');
});


test('routes Identity-owned paths explicitly and does not trust query-string JWTs', async (t) => {
  const seen = [];
  const monolith = await listen((req, res) => {
    seen.push({ upstream: 'monolith', url: req.url, context: req.headers['x-auth-context'] });
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ upstream: 'monolith' }));
  });
  const identity = await listen((req, res) => {
    if (req.url === '/ready') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ status: 'ready' }));
    }
    if (req.url === '/internal/v1/auth/validate') {
      res.setHeader('content-type', 'application/json');
      return res.end(JSON.stringify({ context: { id: 7, username: 'doctor', role: 'doctor', permissions: [] } }));
    }
    seen.push({ upstream: 'identity', url: req.url, context: req.headers['x-auth-context'] });
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ upstream: 'identity' }));
  });
  const gateway = await startGateway(address(monolith), address(identity));
  t.after(() => Promise.all([close(gateway), close(monolith), close(identity)]));

  const login = await fetch(`${address(gateway)}/api/auth/login`, { method: 'POST' });
  assert.equal((await login.json()).upstream, 'identity');
  const token = jwt.sign({ id: 7, username: 'doctor', role: 'doctor' }, jwtSecret);
  const staff = await fetch(`${address(gateway)}/api/admin/staff`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await staff.json()).upstream, 'identity');
  const patient = await fetch(`${address(gateway)}/api/patients`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal((await patient.json()).upstream, 'monolith');
  await fetch(`${address(gateway)}/api/users?token=${encodeURIComponent(token)}`);
  const queryTokenRequest = seen.find((entry) => entry.url.startsWith('/api/users?token='));
  assert.equal(queryTokenRequest.upstream, 'identity');
  assert.equal(queryTokenRequest.context, undefined);
});

test('returns 503 when a valid JWT cannot be revalidated by Identity', async (t) => {
  const monolith = await listen((req, res) => res.end('ok'));
  const gateway = await startGateway(address(monolith), 'http://127.0.0.1:1');
  t.after(() => Promise.all([close(gateway), close(monolith)]));
  const token = jwt.sign({ id: 7, role: 'doctor' }, jwtSecret);
  const response = await fetch(`${address(gateway)}/api/patients`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'IDENTITY_UNAVAILABLE');
});
