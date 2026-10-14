require('dotenv').config();
const { assertSecurityConfig } = require('./utils/authTokens');
try {
  assertSecurityConfig();
  require('./services/dataKeys.cts').assertDataKeys();
} catch (err) {
  console.error(`❌ Refusing to start: ${err.message}`);
  process.exit(1);
}
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { sequelize } = require('./models');
const { schemaProblems } = require('./migrate');
const { requestContext, bindAuditActor } = require('./utils/auditContext');
const { startOutboxDispatcher } = require('./utils/outbox');
const { processRole, startBackgroundWorkers } = require('./workers');
const { startSocketSessionGuard } = require('./utils/socketSessions');
const securitySettings = require('./utils/settings');
const { validateToken } = require('./utils/identityClient');
const { resolveTokenUser, socketToken, identityServiceEnabled } = require('./middleware/auth');
const {
  client,
  httpRequestDurationSeconds,
  httpRequestsTotal,
  activeSocketConnections,
} = require('./utils/metrics');
// Express 4 does not catch a rejected promise from an async handler. Log it
// instead of letting it end the process and every request in flight; handlers
// are expected to answer their own errors.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection:', reason?.original?.message || reason?.message || reason);
});

const app = express();
// Database audit triggers attribute every row change to the request's user (migration 0006).
bindAuditActor(sequelize);
app.use(requestContext);
const trustProxy = process.env.TRUST_PROXY || '1';
const numericTrustProxy = Number(trustProxy);
app.set('trust proxy', Number.isInteger(numericTrustProxy) && numericTrustProxy >= 0 ? numericTrustProxy : (trustProxy === 'true' ? true : trustProxy));

// ── Metrics & Telemetry ─────────────────────────────────────────
app.use((req, res, next) => {
  if (req.path === '/metrics' || req.path === '/api/health' || req.path === '/api/ready') return next();
  const end = httpRequestDurationSeconds.startTimer();
  res.on('finish', () => {
    const route = req.baseUrl + (req.route ? req.route.path : req.path);
    const labels = { method: req.method, route, code: res.statusCode };
    end(labels);
    httpRequestsTotal.inc(labels);
  });
  next();
});

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

const allowedOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin || allowedOrigins.length === 0) {
    return true;
  }

  return allowedOrigins.includes(origin);
}

// ── Security Headers ────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// ── Core Middleware ──────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Rate Limiting ───────────────────────────────────────────────
const authLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_AUTH) || 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX_API) || 600,
  message: { success: false, message: 'Too many requests. Please slow down and try again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  skip: (req) => req.path.startsWith('/api/pdf') || req.path === '/api/health' || req.path === '/api/ready',
});
app.use('/api', apiLimiter);

// ── Static Files ────────────────────────────────────────────────
// Only the hospital logo is public (it appears on pages and printouts).
// Nothing else under uploads/ is served without an authorized route.
app.use('/uploads/logo', express.static(path.join(process.env.HMS_UPLOAD_DIR || path.join(__dirname, 'uploads'), 'logo')));

// -- Global Audit Logger -----------------------------------------
const auditLogger = require('./middleware/auditLogger');
app.use('/api', auditLogger);
// Chart reads and refused requests (row changes are captured by the database).
app.use(require('./middleware/accessAudit'));

// ── Routes ──────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/medication', require('./routes/medication'));
app.use('/api/users', require('./routes/users'));
app.use('/internal/compat', require('./routes/internalCompat'));
// Care teams and break-glass (before the patient-scope guard below, so a doctor
// outside a patient's care can still ask for break-glass access).
app.use('/api/patients', require('./routes/careTeam'));
// Patient scope (migration 0014): a doctor reads a patient's record only when
// the patient is in their care. Desk staff and administrators are not limited.
const { requirePatientInCare } = require('./utils/careTeam');
app.use('/api/patients/hms/:id', require('./middleware/auth').protect, requirePatientInCare);
app.use('/api/patients/:id', require('./middleware/auth').protect, requirePatientInCare);
app.use('/api/hms/vitals/latest/:id', require('./middleware/auth').protect, requirePatientInCare);
app.use('/api/hms/vitals/history/:id', require('./middleware/auth').protect, requirePatientInCare);
app.use('/api/hms/prescriptions/patient/:id', require('./middleware/auth').protect, requirePatientInCare);
app.use('/api/patients', require('./routes/patientIdentity').router);
app.use('/api/patients', require('./routes/patientMerge').router);
// Private documents (A4): after the care-team check above, before the older patient routes.
app.use('/api/patients', require('./routes/patientDocuments'));
app.use('/api/practitioners', require('./routes/practitioners'));
app.use('/api/facilities', require('./routes/facilities'));
app.use('/api/triage', require('./routes/triage'));
app.use('/api/clinical-documents', require('./routes/clinicalDocuments'));
app.use('/api/adt', require('./routes/adt'));
app.use('/api/referrals', require('./routes/referrals'));
app.use('/api/patients', require('./routes/patients'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/security', require('./routes/security'));

// Pharmacy APIs
app.use('/api/medicines', require('./routes/hms/medicines'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/pharmacy', require('./routes/pharmacy'));

// ── HMS Specific Routes ─────────────────────────────────────────
app.use('/api/hms/tokens', require('./routes/hms/tokens'));
app.use('/api/hms/appointments', require('./routes/hms/appointments'));
app.use('/api/hms/vitals', require('./routes/hms/vitals'));
app.use('/api/hms/departments', require('./routes/hms/departments'));
app.use('/api/hms/doctors', require('./routes/hms/doctors'));

// Sprint 3 APIs
app.use('/api/hms/encounters', require('./routes/hms/encounters'));
app.use('/api/hms/diagnoses', require('./routes/hms/diagnoses'));
app.use('/api/hms/prescriptions', require('./routes/hms/prescriptions'));
app.use('/api/hms/rest-forms', require('./routes/hms/restForms'));
app.use('/api/hms/investigation-orders', require('./routes/hms/investigationOrders'));
app.use('/api/hms/medicines', require('./routes/hms/medicines'));
app.use('/api/hms/icd10', require('./routes/hms/icd10'));

// Part B - IPD & Billing APIs
app.use('/api/ipd', require('./routes/ipd'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/finance', require('./routes/finance'));

// Part C - Admin Settings & PDF APIs
app.use('/api/admin', require('./routes/admin'));
app.use('/api/pdf', require('./routes/pdfRoutes'));

// Doctor API
app.use('/api/doctor', require('./middleware/auth').protect, require('./routes/doctor'));

// Receptionist API
app.use('/api/receptionist', require('./middleware/auth').protect, require('./routes/receptionist'));

// LIMS / Lab Tech API
app.use('/api/lab', require('./middleware/auth').protect, require('./routes/lab'));
app.use('/api/laboratory', require('./routes/laboratory'));
app.use('/api/terminology', require('./routes/terminology'));
app.use('/api/fhir', require('./routes/fhir'));
app.use('/api/worklist', require('./routes/worklist'));
app.use('/api/abdm', require('./routes/abdm'));
app.use('/api/devices', require('./routes/devices').contracts);
app.use('/api/device-messages', require('./routes/devices').inbound);
app.use('/api/downtime', require('./routes/downtime'));
// Calls from the ABDM gateway (and data pushes from other facilities).
app.use('/abdm', require('./routes/abdmBridge'));

// Legacy pharmacist namespace retained for frontend compatibility
app.use(
  '/api/pharmacist_lms',
  require('./middleware/auth').protect,
  require('./middleware/auth').restrictTo('pharmacist', 'admin', 'super_admin'),
  require('./routes/pharmacist_lms')
);

// Liveness: the process is running. Use /api/ready to decide whether to send it traffic.
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Readiness: the database answers within two seconds.
app.get('/api/ready', async (req, res) => {
  let timer;
  try {
    await Promise.race([
      sequelize.query('SELECT 1'),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('database did not answer within 2 s')), 2000); }),
    ]);
    res.json({ status: 'ready', timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ status: 'not_ready', reason: err.message });
  } finally {
    clearTimeout(timer);
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ success: false, message: 'Internal server error.' });
});

// ── Database + Start ────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
    credentials: true,
  }
});

// Attach socket.io to app for use in routes
app.set('io', io);

io.use(async (socket, next) => {
  try {
    const token = socketToken(socket.handshake);
    if (!token) return next(new Error('Authentication required'));
    // Same rule as HTTP: a configured Identity Service is the only authority.
    const context = identityServiceEnabled()
      ? await validateToken(token, socket.handshake.headers['x-request-id'])
      : await resolveTokenUser(token);
    if (!context) return next(new Error('Invalid or inactive session'));
    socket.user = context;
    socket.hmsAccessToken = token;
    return next();
  } catch (error) {
    console.warn('Socket authentication failed:', error.message);
    return next(new Error('Authentication service unavailable'));
  }
});

io.on('connection', (socket) => {
  const role = socket.user?.role || 'anonymous';
  socket.join(role);
  // Per-user and per-session rooms let a revoked session be disconnected at once.
  if (socket.user?.id) socket.join(`user:${socket.user.id}`);
  if (socket.user?.sessionId) socket.join(`session:${socket.user.sessionId}`);
  activeSocketConnections.inc({ role });
  console.log(`🔌 Authenticated client ${socket.id} joined ${role}`);
  socket.on('join_role', () => {
    // Compatibility no-op: room membership is derived from authenticated identity.
  });
  socket.on('disconnect', () => {
    activeSocketConnections.dec({ role });
    console.log('🔌 Client disconnected:', socket.id);
  });
});

// Start only against a reachable database whose schema matches migrations/.
// The schema itself is changed by "node migrate.js up", never by the server.
async function start() {
  let role;
  try { role = processRole(); } catch (err) { console.error(`❌ Refusing to start: ${err.message}`); process.exit(1); }
  if (role === 'worker') { console.error('❌ Refusing to start: run the worker role with "node worker.js".'); process.exit(1); }
  try {
    await sequelize.authenticate();
  } catch (err) {
    console.error(`❌ Refusing to start: PostgreSQL is unreachable (${err.message})`);
    process.exit(1);
  }
  const problems = await schemaProblems();
  if (problems.length) {
    console.error(`❌ Refusing to start: the database schema is not current. Run "node migrate.js up".\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('✅ PostgreSQL DB connected; schema is current');
  if (process.env.NODE_ENV === 'production') {
    try { await require('./services/databaseRuntime.cts').verifyRuntime(sequelize); }
    catch (error) { console.error('Refusing unsafe production database identity:', error.message); process.exit(1); }
  }
  // Settings live in hms_app_settings; load them before serving and keep them fresh.
  await securitySettings.loadSettings();
  securitySettings.startSettingsRefresh();
  server.listen(PORT, process.env.BACKEND_HOST || '0.0.0.0', () => {
    console.log(`🚀 Server running on http://${process.env.BACKEND_HOST || '0.0.0.0'}:${PORT}`);
  });
  // Sockets live in this process, so their delivery and session checks run here.
  startOutboxDispatcher(io);
  startSocketSessionGuard(io);
  if (role === 'all') startBackgroundWorkers(sequelize);
  else console.log('⚙️  Background workers run in a separate "node worker.js" process (HMS_PROCESS_ROLE=api)');
}

start();
