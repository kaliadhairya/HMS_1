const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const { createDatabase } = require('./db');
const { defineModels } = require('./models');
const { UserRepository } = require('./repositories/user-repository');
const { PermissionRepository } = require('./repositories/permission-repository');
const { AuditRepository } = require('./repositories/audit-repository');
const { AuditService } = require('./services/audit-service');
const { AuthService } = require('./services/auth-service');
const { createAuthMiddleware } = require('./middleware/auth');
const { AuthController } = require('./controllers/auth-controller');
const { UserController } = require('./controllers/user-controller');
const { createAuthRoutes } = require('./routes/auth-routes');
const { createUserRoutes } = require('./routes/user-routes');
const { createInternalRoutes } = require('./routes/internal-routes');
const { createSecurityCompatibilityRoutes, createAdminCompatibilityRoutes } = require('./routes/compatibility-routes');

function createApplication(config, logger, overrides = {}) {
  const sequelize = overrides.sequelize || createDatabase(config, logger);
  const models = overrides.models || defineModels(sequelize);
  const users = new UserRepository(models.User);
  const permissions = new PermissionRepository(models.Permission);
  const auditRepository = new AuditRepository(models.AuditLog);
  const audit = new AuditService(auditRepository);
  const auth = new AuthService({ userRepository: users, permissionRepository: permissions, auditService: audit, config });
  const middleware = createAuthMiddleware(auth);
  const authController = new AuthController({ authService: auth, userRepository: users, auditService: audit, config });
  const userController = new UserController({ users, permissions, audit, sequelize, config, logger });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use((req, res, next) => {
    req.id = /^[A-Za-z0-9._:-]{1,128}$/.test(req.headers['x-request-id'] || '')
      ? req.headers['x-request-id']
      : crypto.randomUUID();
    res.setHeader('x-request-id', req.id);
    next();
  });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, customProps: (req) => ({ requestId: req.id }) }));
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));
  app.use(['/api/auth/login', '/api/auth/forgot-password'], rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false }));

  app.get('/health', (req, res) => res.json({ status: 'ok', service: config.serviceName, requestId: req.id }));
  app.get('/ready', async (req, res) => {
    try {
      await sequelize.authenticate();
      return res.json({ status: 'ready', service: config.serviceName, database: 'ready', requestId: req.id });
    } catch (error) {
      req.log.warn({ err: error }, 'readiness database check failed');
      return res.status(503).json({ status: 'not_ready', service: config.serviceName, database: 'unavailable', requestId: req.id });
    }
  });
  app.use('/api/auth', createAuthRoutes(authController, middleware));
  app.use('/api/users', createUserRoutes(userController, middleware));
  app.use('/api/security', createSecurityCompatibilityRoutes(userController, middleware));
  app.use('/api/admin', createAdminCompatibilityRoutes(userController, middleware));
  app.use('/internal/v1', createInternalRoutes({ authController, auditService: audit, userRepository: users, requireInternal: middleware.requireInternal }));
  app.use((req, res) => res.status(404).json({ success: false, error: { code: 'ROUTE_NOT_FOUND', message: 'Route not found.', requestId: req.id } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    req.log.error({ err: error }, 'identity request failed');
    if (error.name === 'SequelizeUniqueConstraintError') return res.status(409).json({ success: false, message: 'The value already exists.', requestId: req.id });
    if (error.statusCode) return res.status(error.statusCode).json({ success: false, error: { code: error.code || 'UPSTREAM_ERROR', message: 'A required downstream operation failed.', requestId: req.id } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error.', requestId: req.id } });
  });

  return { app, sequelize, models, services: { auth, audit } };
}

module.exports = { createApplication };
