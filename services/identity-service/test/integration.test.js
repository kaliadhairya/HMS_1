const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const pino = require('pino');
const { Sequelize } = require('sequelize');
const { createApplication } = require('../src/app');

const testDatabase = process.env.IDENTITY_TEST_DB_NAME;

function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

test('real PostgreSQL login, current context, and idempotent audit contract', { skip: !testDatabase }, async (t) => {
  const config = {
    serviceName: 'identity-service-integration',
    nodeEnv: 'test',
    db: {
      host: process.env.DB_HOST || '/var/run/postgresql',
      port: Number(process.env.DB_PORT || 5432),
      name: testDatabase,
      user: process.env.DB_USER || process.env.USER,
      password: process.env.DB_PASSWORD || '',
    },
    jwtSecret: 'identity-integration-jwt-secret',
    jwtExpiresIn: '1h',
    internalServiceSecret: 'identity-integration-secret-32-characters',
    monolithUrl: 'http://127.0.0.1:1',
    exposeResetOtp: false,
    requestTimeoutMs: 500,
  };
  const sequelize = new Sequelize(config.db.name, config.db.user, config.db.password, {
    host: config.db.host,
    port: config.db.port,
    dialect: 'postgres',
    quoteIdentifiers: false,
    timezone: '+00:00',
    logging: false,
  });
  const logger = pino({ level: 'silent' });
  const { app } = createApplication(config, logger, { sequelize });
  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => { await close(server); await sequelize.close(); });

  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'receptionist', password: 'Receptionist@123' }),
  });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const me = await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).user.role, 'receptionist');

  const auditBody = JSON.stringify({ action: 'INTEGRATION_TEST', module: 'auth', userId: 103 });
  const headers = {
    'content-type': 'application/json',
    'x-internal-service-token': config.internalServiceSecret,
    'idempotency-key': `identity-integration-${Date.now()}`,
  };
  const first = await fetch(`${base}/internal/v1/audit`, { method: 'POST', headers, body: auditBody });
  const second = await fetch(`${base}/internal/v1/audit`, { method: 'POST', headers, body: auditBody });
  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal((await second.json()).created, false);
});
