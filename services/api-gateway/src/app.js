const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const pinoHttp = require('pino-http');
const { createProxyMiddleware } = require('http-proxy-middleware');

const UNTRUSTED_IDENTITY_HEADERS = [
  'x-user-id',
  'x-user-role',
  'x-user-username',
  'x-user-name',
  'x-user-department-id',
  'x-auth-context',
  'x-auth-context-signature',
  'x-auth-context-timestamp',
  'x-internal-service',
  'x-internal-service-token',
];

function isValidRequestId(value) {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9._:-]+$/.test(value);
}

function resolveToken(req) {
  const authorization = req.headers.authorization;
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7);
  return null;
}

function createSignedAuthContext(req, config) {
  if (!req.auth) return null;
  const timestamp = String(Date.now());
  const context = Buffer.from(JSON.stringify({
    id: req.auth.id,
    username: req.auth.username || '',
    name: req.auth.name || '',
    role: req.auth.role || '',
    departmentId: req.auth.department_id || null,
    firstLogin: req.auth.first_login || 'N',
    permissions: Array.isArray(req.auth.permissions) ? req.auth.permissions : [],
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', config.internalServiceSecret)
    .update(`${req.id}.${timestamp}.${context}`)
    .digest('base64url');
  return { context, signature, timestamp };
}

function isIdentityPath(pathname) {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/')
    || pathname === '/api/users' || pathname.startsWith('/api/users/')
    || /^\/api\/security\/sessions\/[^/]+\/force-logout$/.test(pathname)
    || /^\/api\/security\/users\/[^/]+\/unlock$/.test(pathname)
    || pathname === '/api/admin/staff' || pathname.startsWith('/api/admin/staff/');
}

function isPatientPath(pathname) {
  if (!(pathname === '/api/patients' || pathname.startsWith('/api/patients/'))) return false;
  return !/\/visits(?:\/|$)/.test(pathname);
}

function isOpdPath(pathname) { return /^\/api\/hms\/(appointments|tokens|doctors|departments)(?:\/|$)/.test(pathname); }

function resolveUpstream(req, config) {
  const pathname = req.path || req.url;
  if (isIdentityPath(pathname)) return config.identityUrl;
  if (isPatientPath(pathname)) return config.patientUrl;
  if (isOpdPath(pathname)) return config.opdUrl;
  return config.monolithUrl;
}

function writeProxyError(error, req, res, logger) {
  logger.error({ err: error, requestId: req.id, upstream: req.upstreamUrl }, 'upstream request failed');
  if (typeof res.writeHead !== 'function' || res.headersSent) {
    if (typeof res.destroy === 'function') res.destroy();
    return;
  }
  const payload = JSON.stringify({
    success: false,
    error: {
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'The HMS backend is temporarily unavailable.',
      requestId: req.id,
    },
  });
  res.writeHead(503, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'x-request-id': req.id,
  });
  res.end(payload);
}

function createGateway(config, logger) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use((req, res, next) => {
    for (const header of UNTRUSTED_IDENTITY_HEADERS) delete req.headers[header];
    req.id = isValidRequestId(req.headers['x-request-id'])
      ? req.headers['x-request-id']
      : crypto.randomUUID();
    req.headers['x-request-id'] = req.id;
    req.gatewayConfig = config;
    res.setHeader('x-request-id', req.id);
    next();
  });

  app.use(pinoHttp({
    logger,
    genReqId: (req) => req.id,
    customProps: (req) => ({ requestId: req.id }),
  }));
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({
    credentials: true,
    origin(origin, callback) {
      if (!origin || config.allowedOrigins.length === 0 || config.allowedOrigins.includes('*') || config.allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed by CORS policy'));
    },
  }));

  const authLimiter = rateLimit({
    windowMs: config.authRateLimitWindowMs,
    limit: config.authRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
  });
  app.use(['/api/auth/login', '/api/auth/forgot-password'], authLimiter);

  const apiLimiter = rateLimit({
    windowMs: config.apiRateLimitWindowMs,
    limit: config.apiRateLimitMax,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: (req) => req.path === '/api/health',
  });
  app.use('/api', apiLimiter);

  app.get(['/health', '/api/gateway/health'], (req, res) => {
    res.json({ status: 'ok', service: config.serviceName, requestId: req.id });
  });

  app.get(['/ready', '/api/gateway/ready'], async (req, res) => {
    try {
      const [monolith, identity, patient, opd] = await Promise.all([
        fetch(`${config.monolithUrl}/api/health`, { signal: AbortSignal.timeout(Math.min(config.proxyTimeoutMs, 5000)) }),
        fetch(`${config.identityUrl}/ready`, { signal: AbortSignal.timeout(Math.min(config.proxyTimeoutMs, 5000)) }),
        fetch(`${config.patientUrl}/ready`, { signal: AbortSignal.timeout(Math.min(config.proxyTimeoutMs, 5000)) }),
        fetch(`${config.opdUrl}/ready`, { signal: AbortSignal.timeout(Math.min(config.proxyTimeoutMs, 5000)) }),
      ]);
      if (!monolith.ok || !identity.ok || !patient.ok || !opd.ok) throw new Error(`dependency health returned monolith=${monolith.status} identity=${identity.status} patient=${patient.status} opd=${opd.status}`);
      return res.json({ status: 'ready', service: config.serviceName, dependencies: { monolith: 'ready', identity: 'ready', patient: 'ready', opd: 'ready' }, upstream: 'ready', requestId: req.id });
    } catch (error) {
      req.log.warn({ err: error }, 'gateway readiness check failed');
      return res.status(503).json({ status: 'not_ready', service: config.serviceName, upstream: 'unavailable', requestId: req.id });
    }
  });

  app.use(async (req, res, next) => {
    const token = resolveToken(req);
    if (!token) return next();
    try {
      jwt.verify(token, config.jwtSecret);
    } catch {
      return res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token.', requestId: req.id },
      });
    }
    try {
      const response = await fetch(`${config.identityUrl}/internal/v1/auth/validate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'x-internal-service-token': config.internalServiceSecret,
          'x-request-id': req.id,
        },
        signal: AbortSignal.timeout(Math.min(config.proxyTimeoutMs, 5000)),
      });
      if (!response.ok) {
        return res.status(401).json({ success: false, error: { code: 'INVALID_SESSION', message: 'Session is no longer active.', requestId: req.id } });
      }
      const payload = await response.json();
      req.auth = payload.context;
      return next();
    } catch (error) {
      req.log.error({ err: error }, 'identity validation unavailable');
      return res.status(503).json({ success: false, error: { code: 'IDENTITY_UNAVAILABLE', message: 'Authentication service is temporarily unavailable.', requestId: req.id } });
    }
  });

  const proxy = createProxyMiddleware({
    target: config.monolithUrl,
    router: (req) => {
      req.upstreamUrl = resolveUpstream(req, config);
      return req.upstreamUrl;
    },
    changeOrigin: false,
    xfwd: true,
    ws: true,
    timeout: config.proxyTimeoutMs,
    proxyTimeout: config.proxyTimeoutMs,
    pathFilter(pathname) {
      return pathname.startsWith('/api/')
        || pathname === '/api'
        || pathname.startsWith('/uploads/')
        || pathname.startsWith('/socket.io/');
    },
    on: {
      proxyReq(proxyReq, req) {
        proxyReq.setHeader('x-request-id', req.id);
        const signed = createSignedAuthContext(req, config);
        if (signed) {
          proxyReq.setHeader('x-auth-context', signed.context);
          proxyReq.setHeader('x-auth-context-signature', signed.signature);
          proxyReq.setHeader('x-auth-context-timestamp', signed.timestamp);
          proxyReq.setHeader('x-internal-service', config.serviceName);
        }
        proxyReq.removeHeader('x-internal-service-token');
      },
      proxyReqWs(proxyReq, req) {
        proxyReq.setHeader('x-request-id', req.id || crypto.randomUUID());
      },
      proxyRes(proxyRes, req) {
        proxyRes.headers['x-request-id'] = req.id;
      },
      error(error, req, res) {
        writeProxyError(error, req, res, logger);
      },
    },
  });

  app.use(proxy);
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.', requestId: req.id },
    });
  });
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    req.log.error({ err: error }, 'gateway request failed');
    return res.status(500).json({
      success: false,
      error: { code: 'GATEWAY_ERROR', message: 'Gateway request failed.', requestId: req.id },
    });
  });

  return { app, proxy };
}

module.exports = { createGateway, UNTRUSTED_IDENTITY_HEADERS };
