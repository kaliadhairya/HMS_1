const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const pinoHttp = require('pino-http');
const { requireContext, requireInternal } = require('./middleware');
const { createRoutes } = require('./routes');

function createApp(config, logger, models, sequelize) {
  const app = express(); app.disable('x-powered-by'); app.set('trust proxy', 1); app.use(express.json({ limit: '2mb' })); app.use(helmet());
  app.use((req, res, next) => { req.id = req.headers['x-request-id'] || require('crypto').randomUUID(); res.setHeader('x-request-id', req.id); next(); });
  app.use(pinoHttp({ logger, genReqId: (req) => req.id, customProps: (req) => ({ requestId: req.id }) }));
  app.get('/health', (req, res) => res.json({ status: 'ok', service: config.serviceName, requestId: req.id }));
  app.get('/ready', async (req, res) => { try { await sequelize.authenticate(); return res.json({ status: 'ready', service: config.serviceName, database: 'ready', requestId: req.id }); } catch (e) { return res.status(503).json({ status: 'not_ready', service: config.serviceName, database: 'unavailable', requestId: req.id }); } });
  app.use('/internal/v1/patients/:id', requireInternal(config), async (req, res, next) => { try { const patient = await models.Patient.findByPk(req.params.id); if (!patient) return res.status(404).json({ success: false, message: 'Patient not found.' }); return res.json({ success: true, data: { id: patient.id, uhid: patient.uhid, name: patient.name, age: patient.age, gender: patient.gender } }); } catch (error) { return next(error); } });
  app.use('/api/patients', rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api/patients', requireContext(config), createRoutes(models, sequelize, config));
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); req.log?.error({ err: error }, 'patient request failed'); const status = Number(error.status) || (error.name === 'SequelizeUniqueConstraintError' ? 409 : 500); return res.status(status).json({ success: false, message: status === 500 ? 'Patient service request failed.' : error.message, requestId: req.id }); });
  return app;
}
module.exports = { createApp };
