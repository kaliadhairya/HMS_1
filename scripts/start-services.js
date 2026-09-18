const { spawn, spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const children = [];
let stopping = false;

function start(name, cwd, command, args, env) {
  const child = spawn(command, args, {
    cwd: path.join(root, cwd),
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    console.error(`[${name}] failed to start:`, error.message);
    stopAll(1);
  });
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`[${name}] exited unexpectedly (${signal || code})`);
      stopAll(code || 1);
    }
  });
  children.push(child);
}

function stopAll(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM');
  }
  const timer = setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGKILL');
    }
    process.exit(exitCode);
  }, 10000);
  timer.unref();
  Promise.all(children.map((child) => new Promise((resolve) => child.once('exit', resolve))))
    .finally(() => process.exit(exitCode));
}

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is required; use the root services:start script with backend/.env present.');
  process.exit(1);
}
if (!process.env.INTERNAL_SERVICE_SECRET || process.env.INTERNAL_SERVICE_SECRET.length < 32) {
  console.error('INTERNAL_SERVICE_SECRET (32+ characters) is required in backend/.env for local gateway startup.');
  process.exit(1);
}

const migration = spawnSync(process.execPath, ['src/migrate.js'], {
  cwd: path.join(root, 'services/identity-service'),
  env: process.env,
  stdio: 'inherit',
});
if (migration.status !== 0) {
  console.error('[identity-service] migration failed; no services were started.');
  process.exit(migration.status || 1);
}

const monolithPort = process.env.MONOLITH_PORT || '5002';
const gatewayPort = process.env.GATEWAY_PORT || '5001';
const identityPort = process.env.IDENTITY_PORT || '5101';
const patientPort = process.env.PATIENT_PORT || '5102';
const opdPort = process.env.OPD_PORT || '5103';
start('identity-service', 'services/identity-service', process.execPath, ['src/server.js'], {
  PORT: identityPort,
  MONOLITH_URL: process.env.MONOLITH_URL || `http://127.0.0.1:${monolithPort}`,
});
start('patient-service', 'services/patient-service', process.execPath, ['src/server.js'], {
  PATIENT_PORT: patientPort,
  MONOLITH_URL: process.env.MONOLITH_URL || `http://127.0.0.1:${monolithPort}`,
});
start('opd-service', 'services/opd-service', process.execPath, ['src/server.js'], {
  OPD_PORT: opdPort,
});
start('monolith', 'backend', process.execPath, ['server.js'], {
  PORT: monolithPort,
  BACKEND_HOST: process.env.BACKEND_HOST || '127.0.0.1',
  TRUST_PROXY: process.env.TRUST_PROXY || 'loopback',
  IDENTITY_URL: process.env.IDENTITY_URL || `http://127.0.0.1:${identityPort}`,
});
start('api-gateway', 'services/api-gateway', process.execPath, ['src/server.js'], {
  PORT: gatewayPort,
  MONOLITH_URL: process.env.MONOLITH_URL || `http://127.0.0.1:${monolithPort}`,
  IDENTITY_URL: process.env.IDENTITY_URL || `http://127.0.0.1:${identityPort}`,
  PATIENT_URL: process.env.PATIENT_URL || `http://127.0.0.1:${patientPort}`,
  OPD_URL: process.env.OPD_URL || `http://127.0.0.1:${opdPort}`,
});

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
